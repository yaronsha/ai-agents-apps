//! End to end over a real TLS WebSocket, with `fake-grok` standing in for `grok agent stdio`.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use gbr::config::Paths;
use gbr::devices::Devices;
use gbr::envelope::Envelope;
use gbr::pairing::{confirmation_code, PendingPairing};
use gbr::server::{self, State};
use gbr::tls::{self, Identity};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

type Ws = WebSocketStream<tokio_rustls::client::TlsStream<TcpStream>>;

/// The phone side: trust exactly one bridge certificate fingerprint.
#[derive(Debug)]
struct Pinned {
    fp: String,
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for Pinned {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        if tls::fingerprint(end_entity.as_ref()) == self.fp {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General("bridge fingerprint mismatch".into()))
        }
    }
    fn verify_tls12_signature(
        &self,
        m: &[u8],
        c: &CertificateDer<'_>,
        d: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(m, c, d, &self.provider.signature_verification_algorithms)
    }
    fn verify_tls13_signature(
        &self,
        m: &[u8],
        c: &CertificateDer<'_>,
        d: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(m, c, d, &self.provider.signature_verification_algorithms)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

struct Bridge {
    _dir: tempfile::TempDir,
    paths: Paths,
    addr: std::net::SocketAddr,
    bridge_fp: String,
}

async fn start_bridge() -> Bridge {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::at(dir.path().to_path_buf()).unwrap();
    let id = tls::load_or_create(&paths).unwrap();
    let state = Arc::new(State::new(
        paths.clone(),
        id.fingerprint(),
        PathBuf::from(env!("CARGO_BIN_EXE_fake-grok")),
        "fake".into(),
        false,
        false,
    ));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(server::serve(
        listener,
        state,
        tls::server_config(&id).unwrap(),
    ));
    Bridge {
        _dir: dir,
        paths,
        addr,
        bridge_fp: id.fingerprint(),
    }
}

async fn connect(bridge: &Bridge, phone: &Identity, pin: &str) -> Result<Ws, String> {
    let provider = tls::provider();
    let config = rustls::ClientConfig::builder_with_provider(provider.clone())
        .with_protocol_versions(&[&rustls::version::TLS13])
        .unwrap()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(Pinned {
            fp: pin.to_string(),
            provider,
        }))
        .with_client_auth_cert(
            vec![CertificateDer::from(phone.cert_der.clone())],
            PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(phone.key_der.clone())),
        )
        .unwrap();
    let tcp = TcpStream::connect(bridge.addr).await.unwrap();
    let tls = tokio_rustls::TlsConnector::from(Arc::new(config))
        .connect(ServerName::try_from("gbr-bridge").unwrap(), tcp)
        .await
        .map_err(|e| e.to_string())?;
    let (ws, _) = tokio_tungstenite::client_async("wss://gbr-bridge/v1", tls)
        .await
        .map_err(|e| e.to_string())?;
    Ok(ws)
}

async fn send(ws: &mut Ws, env: Envelope) {
    ws.send(Message::Text(env.to_text())).await.unwrap();
}

async fn recv(ws: &mut Ws) -> Envelope {
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(10), ws.next())
            .await
            .expect("timed out waiting for the bridge")
            .expect("closed")
            .expect("ws error");
        if let Message::Text(t) = msg {
            return Envelope::parse(&t).unwrap();
        }
    }
}

fn acp_body(env: &Envelope) -> Value {
    serde_json::from_str(env.payload.as_ref().unwrap().as_str().unwrap()).unwrap()
}

fn paired_phone(bridge: &Bridge) -> Identity {
    let phone = tls::generate("phone").unwrap();
    let mut d = Devices::load(&bridge.paths).unwrap();
    d.add("Test phone", &tls::fingerprint(&phone.cert_der))
        .unwrap();
    d.save(&bridge.paths).unwrap();
    phone
}

#[tokio::test]
async fn attach_prompt_approve_and_replay() {
    let bridge = start_bridge().await;
    let phone = paired_phone(&bridge);
    let mut ws = connect(&bridge, &phone, &bridge.bridge_fp).await.unwrap();

    send(
        &mut ws,
        Envelope::new("hello").with_payload(json!({"device":"t"})),
    )
    .await;
    let welcome = recv(&mut ws).await;
    assert_eq!(welcome.kind, "welcome");
    assert_eq!(welcome.payload.unwrap()["device"], "Test phone");

    send(&mut ws, Envelope::new("sessions.list")).await;
    let sessions = recv(&mut ws).await;
    assert_eq!(sessions.kind, "sessions");
    assert_eq!(sessions.payload.unwrap()["sessions"][0]["sessionId"], "s1");

    send(
        &mut ws,
        Envelope::new("attach")
            .with_sid("s1")
            .with_payload(json!({"cwd":"/tmp/project"})),
    )
    .await;
    let attached = recv(&mut ws).await;
    assert_eq!(attached.kind, "attached");
    assert_eq!(attached.payload.unwrap()["from"], 0);
    let first = recv(&mut ws).await;
    assert_eq!((first.kind.as_str(), first.seq), ("acp", Some(1)));
    assert_eq!(
        acp_body(&first)["params"]["update"]["sessionUpdate"],
        "user_message_chunk"
    );
    assert_eq!(recv(&mut ws).await.seq, Some(2));

    // A refused method never reaches the agent.
    let init = json!({"jsonrpc":"2.0","id":9,"method":"initialize","params":{"sessionId":"s1"}});
    send(
        &mut ws,
        Envelope::new("acp")
            .with_sid("s1")
            .with_payload(Value::String(init.to_string())),
    )
    .await;
    let refused = recv(&mut ws).await;
    assert_eq!(refused.kind, "error");
    assert_eq!(refused.payload.unwrap()["code"], "refused");

    // Prompt → permission request → approve → result.
    let prompt = json!({"jsonrpc":"2.0","id":1,"method":"session/prompt",
        "params":{"sessionId":"s1","prompt":[{"type":"text","text":"push it"}]}});
    send(
        &mut ws,
        Envelope::new("acp")
            .with_sid("s1")
            .with_payload(Value::String(prompt.to_string())),
    )
    .await;
    assert_eq!(
        acp_body(&recv(&mut ws).await)["params"]["update"]["sessionUpdate"],
        "tool_call"
    );
    let perm = recv(&mut ws).await;
    let perm_body = acp_body(&perm);
    assert_eq!(perm_body["method"], "session/request_permission");
    assert_eq!(perm.seq, Some(4));

    // Remembered or always-approve answers, and extra fields, are refused; the request stays
    // pending, so the allow-once answer below still goes through.
    for refused in [
        json!({"jsonrpc":"2.0","id":perm_body["id"],
            "result":{"outcome":{"outcome":"selected","optionId":"allow-session"}}}),
        json!({"jsonrpc":"2.0","id":perm_body["id"],
            "result":{"outcome":{"outcome":"selected","optionId":"yolo-on"}}}),
        json!({"jsonrpc":"2.0","id":perm_body["id"],
            "result":{"outcome":{"outcome":"selected","optionId":"allow"},"_meta":{"yoloMode":true}}}),
    ] {
        send(
            &mut ws,
            Envelope::new("acp")
                .with_sid("s1")
                .with_payload(Value::String(refused.to_string())),
        )
        .await;
        assert_eq!(recv(&mut ws).await.kind, "error", "{refused}");
    }

    let answer = json!({"jsonrpc":"2.0","id":perm_body["id"],
        "result":{"outcome":{"outcome":"selected","optionId":"allow"}}});
    send(
        &mut ws,
        Envelope::new("acp")
            .with_sid("s1")
            .with_payload(Value::String(answer.to_string())),
    )
    .await;
    let done = acp_body(&recv(&mut ws).await);
    assert_eq!(done["params"]["update"]["status"], "completed");
    let said = acp_body(&recv(&mut ws).await);
    assert_eq!(said["params"]["update"]["content"]["text"], "chose allow");
    let result = acp_body(&recv(&mut ws).await);
    assert_eq!(result["id"], 1);
    assert_eq!(result["result"]["stopReason"], "end_turn");

    // Answering the same request twice is refused (it is no longer pending).
    send(
        &mut ws,
        Envelope::new("acp")
            .with_sid("s1")
            .with_payload(Value::String(answer.to_string())),
    )
    .await;
    assert_eq!(recv(&mut ws).await.kind, "error");
    drop(ws);

    // Reconnect having seen up to seq 2: get 3.. only, from the bridge's buffer.
    let mut ws = connect(&bridge, &phone, &bridge.bridge_fp).await.unwrap();
    send(
        &mut ws,
        Envelope::new("hello").with_payload(json!({"lastSeq":{"s1":2}})),
    )
    .await;
    assert_eq!(recv(&mut ws).await.kind, "welcome");
    send(&mut ws, Envelope::new("attach").with_sid("s1")).await;
    let attached = recv(&mut ws).await;
    assert_eq!(attached.kind, "attached");
    assert_eq!(attached.payload.unwrap()["from"], 2);
    let mut last = recv(&mut ws).await;
    assert_eq!(last.seq, Some(3));
    while acp_body(&last)["id"] != 1 {
        last = recv(&mut ws).await;
    }

    // Reopening the session on the same connection sends nothing it already sent.
    send(&mut ws, Envelope::new("attach").with_sid("s1")).await;
    let attached = recv(&mut ws).await;
    assert_eq!(attached.kind, "attached");
    assert_eq!(attached.payload.unwrap()["from"], last.seq.unwrap());
    send(&mut ws, Envelope::new("ping")).await;
    assert_eq!(recv(&mut ws).await.kind, "pong");

    // Context usage, as Grok's /context shows it; only the fields the phone needs.
    send(&mut ws, Envelope::new("session.info").with_sid("s1")).await;
    let info = recv(&mut ws).await;
    assert_eq!(info.kind, "session.info");
    assert_eq!(info.sid.as_deref(), Some("s1"));
    let info = info.payload.unwrap();
    assert_eq!(info["context"]["used"], 1200);
    assert_eq!(info["turns"], 3);
    assert!(info.get("cwd").is_none());

    // Not for a session this phone hasn't opened.
    send(&mut ws, Envelope::new("session.info").with_sid("other")).await;
    assert_eq!(recv(&mut ws).await.kind, "error");
}

#[tokio::test]
async fn unpaired_phone_can_only_pair() {
    let bridge = start_bridge().await;
    let stranger = tls::generate("stranger").unwrap();
    let mut ws = connect(&bridge, &stranger, &bridge.bridge_fp)
        .await
        .unwrap();
    send(&mut ws, Envelope::new("hello")).await;
    let e = recv(&mut ws).await;
    assert_eq!(e.kind, "error");
    assert_eq!(e.payload.unwrap()["code"], "not_paired");
}

#[tokio::test]
async fn wrong_bridge_fingerprint_fails_the_handshake() {
    let bridge = start_bridge().await;
    let phone = paired_phone(&bridge);
    assert!(connect(&bridge, &phone, &"00".repeat(32)).await.is_err());
}

#[tokio::test]
async fn pairing_flow_needs_confirmation_on_the_mac() {
    let bridge = start_bridge().await;
    let (_pending, token) = PendingPairing::create(&bridge.paths, server::now()).unwrap();
    let phone = tls::generate("new phone").unwrap();
    let phone_fp = tls::fingerprint(&phone.cert_der);
    let mut ws = connect(&bridge, &phone, &bridge.bridge_fp).await.unwrap();

    send(
        &mut ws,
        Envelope::new("pair").with_payload(json!({"token": token, "name": "Pixel"})),
    )
    .await;
    let pairing = recv(&mut ws).await;
    assert_eq!(pairing.kind, "pairing");
    let code = pairing.payload.unwrap()["code"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(code, confirmation_code(&bridge.bridge_fp, &phone_fp));

    // What `gbr pair` does when you answer "y".
    let claimed = PendingPairing::load(&bridge.paths)
        .unwrap()
        .unwrap()
        .device
        .unwrap();
    assert_eq!(claimed.fingerprint, phone_fp);
    let mut d = Devices::load(&bridge.paths).unwrap();
    d.add(&claimed.name, &claimed.fingerprint).unwrap();
    d.save(&bridge.paths).unwrap();
    PendingPairing::clear(&bridge.paths).unwrap();

    assert_eq!(recv(&mut ws).await.kind, "paired");

    // The token is gone: a second phone can't reuse it.
    let other = tls::generate("other").unwrap();
    let mut ws2 = connect(&bridge, &other, &bridge.bridge_fp).await.unwrap();
    send(
        &mut ws2,
        Envelope::new("pair").with_payload(json!({"token": token, "name": "Thief"})),
    )
    .await;
    assert_eq!(recv(&mut ws2).await.kind, "error");
}
