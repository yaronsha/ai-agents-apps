//! The TLS WebSocket server phones connect to.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_rustls::TlsAcceptor;
use tokio_tungstenite::tungstenite::Message;

use crate::agent::Agent;
use crate::allowlist::{check_phone_message, Allowed};
use crate::audit::Audit;
use crate::config::Paths;
use crate::devices::Devices;
use crate::envelope::{kind, Envelope};
use crate::hub::{HubEvent, SessionHub};
use crate::pairing::PendingPairing;
use crate::replay::Since;
use crate::tls;

const PING_EVERY: Duration = Duration::from_secs(20);
const IDLE_LIMIT: Duration = Duration::from_secs(60);
const HANDSHAKE_LIMIT: Duration = Duration::from_secs(10);
const PAIR_CONFIRM_LIMIT: Duration = Duration::from_secs(120);

pub struct State {
    pub paths: Paths,
    pub bridge_fp: String,
    pub grok_bin: PathBuf,
    pub grok_version: String,
    pub log_prompts: bool,
    /// Open the sessions the phone starts in Grok Build's auto-review mode.
    pub auto_review: bool,
    pub audit: Audit,
    hubs: tokio::sync::Mutex<HashMap<String, Arc<SessionHub>>>,
    control: tokio::sync::Mutex<Option<Arc<Agent>>>,
}

impl State {
    pub fn new(
        paths: Paths,
        bridge_fp: String,
        grok_bin: PathBuf,
        grok_version: String,
        log_prompts: bool,
        auto_review: bool,
    ) -> Self {
        let audit = Audit::new(paths.audit().to_path_buf());
        Self {
            paths,
            bridge_fp,
            grok_bin,
            grok_version,
            log_prompts,
            auto_review,
            audit,
            hubs: Default::default(),
            control: Default::default(),
        }
    }

    /// A long-lived agent used only for `session/list`.
    async fn list_sessions(&self, params: Value) -> Result<Value> {
        let mut guard = self.control.lock().await;
        if guard.is_none() {
            let (agent, mut events) = Agent::spawn(&self.grok_bin)?;
            // The control agent has no session; drop anything it says unprompted.
            tokio::spawn(async move { while events.recv().await.is_some() {} });
            agent.initialize().await?;
            *guard = Some(agent);
        }
        let agent = guard.as_ref().expect("set above").clone();
        match agent.request("session/list", params).await {
            Ok(v) => Ok(v),
            Err(e) => {
                agent.kill().await;
                *guard = None;
                Err(e)
            }
        }
    }

    async fn hub_for_attach(&self, sid: &str, cwd: Option<&str>) -> Result<Arc<SessionHub>> {
        let mut hubs = self.hubs.lock().await;
        if let Some(h) = hubs.get(sid) {
            if !h.is_closed() {
                return Ok(h.clone());
            }
            hubs.remove(sid);
        }
        let cwd = cwd.ok_or_else(|| anyhow!("attach needs the session's cwd"))?;
        let hub = SessionHub::load(&self.grok_bin, sid, cwd).await?;
        hubs.insert(sid.to_string(), hub.clone());
        Ok(hub)
    }

    async fn new_session(&self, cwd: &str, model: Option<&str>) -> Result<Arc<SessionHub>> {
        let hub = SessionHub::create(&self.grok_bin, cwd, model, self.auto_review).await?;
        self.hubs.lock().await.insert(hub.sid.clone(), hub.clone());
        Ok(hub)
    }

    pub async fn shutdown(&self) {
        for (_, hub) in self.hubs.lock().await.drain() {
            hub.agent.kill().await;
        }
        if let Some(a) = self.control.lock().await.take() {
            a.kill().await;
        }
    }
}

/// Accept connections until the listener fails or the task is cancelled.
pub async fn serve(
    listener: TcpListener,
    state: Arc<State>,
    tls_config: Arc<rustls::ServerConfig>,
) {
    let acceptor = TlsAcceptor::from(tls_config);
    loop {
        let (stream, peer) = match listener.accept().await {
            Ok(x) => x,
            Err(e) => {
                tracing::warn!("accept: {e}");
                continue;
            }
        };
        let acceptor = acceptor.clone();
        let state = state.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_connection(stream, peer, acceptor, state).await {
                tracing::info!("{peer}: {e:#}");
            }
        });
    }
}

async fn handle_connection(
    stream: TcpStream,
    peer: SocketAddr,
    acceptor: TlsAcceptor,
    state: Arc<State>,
) -> Result<()> {
    let tls_stream = tokio::time::timeout(HANDSHAKE_LIMIT, acceptor.accept(stream))
        .await
        .context("TLS handshake timed out")?
        .context("TLS handshake failed")?;
    let client_fp = tls_stream
        .get_ref()
        .1
        .peer_certificates()
        .and_then(|c| c.first())
        .map(|c| tls::fingerprint(c.as_ref()))
        .context("no client certificate")?;
    let ws = tokio::time::timeout(HANDSHAKE_LIMIT, tokio_tungstenite::accept_async(tls_stream))
        .await
        .context("WebSocket handshake timed out")??;

    let device = Devices::load(&state.paths)?
        .active_name(&client_fp)
        .map(str::to_string);
    match device {
        Some(name) => {
            tracing::info!("{peer}: {name} connected");
            state.audit.log(&name, "connect", &peer.to_string());
            let result = Connection::new(name.clone(), client_fp, state.clone())
                .run(ws)
                .await;
            state.audit.log(&name, "disconnect", "");
            result
        }
        None => {
            state.audit.log("unpaired", "connect", &peer.to_string());
            pair(ws, client_fp, state).await
        }
    }
}

type Ws = tokio_tungstenite::WebSocketStream<tokio_rustls::server::TlsStream<TcpStream>>;

/// An unknown certificate may only pair.
async fn pair(mut ws: Ws, client_fp: String, state: Arc<State>) -> Result<()> {
    let first = tokio::time::timeout(Duration::from_secs(60), ws.next())
        .await
        .context("no pairing message")?;
    let text = match first {
        Some(Ok(Message::Text(t))) => t,
        _ => bail!("closed before pairing"),
    };
    let env = Envelope::parse(&text).map_err(|e| anyhow!(e))?;
    if env.kind != kind::PAIR {
        send(
            &mut ws,
            Envelope::error(
                "not_paired",
                "This phone is not paired. Run `gbr pair` on the Mac.",
            ),
        )
        .await?;
        state.audit.log("unpaired", "refused", &env.kind);
        return Ok(());
    }
    let token = env.payload_str("token").unwrap_or_default().to_string();
    let name = env.payload_str("name").unwrap_or("phone").to_string();

    let claimed = (|| -> Result<_> {
        let mut pending = PendingPairing::load(&state.paths)?
            .ok_or_else(|| anyhow!("no pairing in progress; run `gbr pair` on the Mac"))?;
        let device = pending.claim(&token, &name, &state.bridge_fp, &client_fp, now())?;
        pending.save(&state.paths)?;
        Ok(device)
    })();
    let device = match claimed {
        Ok(d) => d,
        Err(e) => {
            state.audit.log("unpaired", "pair_refused", &e.to_string());
            send(&mut ws, Envelope::error("pair_refused", &e.to_string())).await?;
            return Ok(());
        }
    };
    state.audit.log(
        &device.name,
        "pair_claimed",
        "waiting for confirmation on the Mac",
    );
    send(
        &mut ws,
        Envelope::new(kind::PAIRING).with_payload(json!({"code": device.code})),
    )
    .await?;

    let deadline = Instant::now() + PAIR_CONFIRM_LIMIT;
    while Instant::now() < deadline {
        if let Some(name) = Devices::load(&state.paths)?.active_name(&client_fp) {
            state.audit.log(name, "paired", "");
            send(
                &mut ws,
                Envelope::new(kind::PAIRED).with_payload(json!({"name": name})),
            )
            .await?;
            return Ok(());
        }
        if PendingPairing::load(&state.paths)?.is_none() {
            break; // declined on the Mac
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    send(
        &mut ws,
        Envelope::error("pair_declined", "Pairing was not confirmed on the Mac."),
    )
    .await?;
    Ok(())
}

async fn send(ws: &mut Ws, env: Envelope) -> Result<()> {
    ws.send(Message::Text(env.to_text())).await?;
    Ok(())
}

pub fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

struct Attachment {
    hub: Arc<SessionHub>,
    forwarder: JoinHandle<()>,
}

/// One paired phone's connection.
#[derive(Clone)]
struct Connection {
    device: String,
    fingerprint: String,
    state: Arc<State>,
    out: mpsc::UnboundedSender<Envelope>,
    attached: Arc<Mutex<HashMap<String, Attachment>>>,
    last_seq: Arc<Mutex<HashMap<String, u64>>>,
    out_rx: Arc<Mutex<Option<mpsc::UnboundedReceiver<Envelope>>>>,
}

impl Connection {
    fn new(device: String, fingerprint: String, state: Arc<State>) -> Self {
        let (out, out_rx) = mpsc::unbounded_channel();
        Self {
            device,
            fingerprint,
            state,
            out,
            attached: Default::default(),
            last_seq: Default::default(),
            out_rx: Arc::new(Mutex::new(Some(out_rx))),
        }
    }

    async fn run(self, ws: Ws) -> Result<()> {
        let (mut sink, mut stream) = ws.split();
        let mut out_rx = self.out_rx.lock().unwrap().take().expect("run once");
        let mut ping = tokio::time::interval(PING_EVERY);
        let mut last_rx = Instant::now();
        let result: Result<()> = async {
            loop {
                tokio::select! {
                    incoming = stream.next() => match incoming {
                        Some(Ok(Message::Text(text))) => {
                            last_rx = Instant::now();
                            self.handle(&text);
                        }
                        Some(Ok(Message::Ping(_) | Message::Pong(_))) => last_rx = Instant::now(),
                        Some(Ok(Message::Binary(_))) => {
                            let _ = self.out.send(Envelope::error("bad_frame", "binary frames are not used"));
                        }
                        Some(Ok(Message::Close(_))) | None => return Ok(()),
                        Some(Ok(Message::Frame(_))) => {}
                        Some(Err(e)) => return Err(e.into()),
                    },
                    Some(env) = out_rx.recv() => {
                        sink.send(Message::Text(env.to_text())).await?;
                    }
                    _ = ping.tick() => {
                        if last_rx.elapsed() > IDLE_LIMIT {
                            return Err(anyhow!("idle for {IDLE_LIMIT:?}"));
                        }
                        // `gbr devices revoke` takes effect within one ping interval.
                        let still_paired = Devices::load(&self.state.paths)
                            .map(|d| d.active_name(&self.fingerprint).is_some())
                            .unwrap_or(false);
                        if !still_paired {
                            let _ = sink.send(Message::Text(
                                Envelope::error("revoked", "This phone was unpaired on the Mac.").to_text(),
                            )).await;
                            return Err(anyhow!("device revoked"));
                        }
                        sink.send(Message::Ping(Vec::new())).await?;
                    }
                }
            }
        }
        .await;
        for (_, a) in self.attached.lock().unwrap().drain() {
            a.forwarder.abort();
        }
        result
    }

    fn reply(&self, env: Envelope) {
        let _ = self.out.send(env);
    }

    fn handle(&self, text: &str) {
        let env = match Envelope::parse(text) {
            Ok(e) => e,
            Err(e) => return self.reply(Envelope::error("bad_envelope", &e)),
        };
        match env.kind.as_str() {
            kind::PING => self.reply(Envelope::new(kind::PONG)),
            kind::HELLO => self.hello(&env),
            kind::SESSIONS_LIST => {
                let this = self.clone();
                let params = env
                    .payload
                    .clone()
                    .filter(Value::is_object)
                    .unwrap_or_else(|| json!({}));
                tokio::spawn(async move {
                    match this.state.list_sessions(params).await {
                        Ok(v) => this.reply(Envelope::new(kind::SESSIONS).with_payload(v)),
                        Err(e) => this.reply(Envelope::error("list_failed", &format!("{e:#}"))),
                    }
                });
            }
            kind::ATTACH => {
                let Some(sid) = env.sid.clone() else {
                    return self.reply(Envelope::error("bad_request", "attach needs sid"));
                };
                let cwd = env.payload_str("cwd").map(str::to_string);
                let this = self.clone();
                tokio::spawn(async move {
                    match this.state.hub_for_attach(&sid, cwd.as_deref()).await {
                        Ok(hub) => this.attach(hub),
                        Err(e) => this.reply(
                            Envelope::error("attach_failed", &format!("{e:#}")).with_sid(sid),
                        ),
                    }
                });
            }
            kind::SESSION_NEW => {
                let Some(cwd) = env.payload_str("cwd").map(str::to_string) else {
                    return self.reply(Envelope::error("bad_request", "session.new needs cwd"));
                };
                let model = env.payload_str("modelId").map(str::to_string);
                let this = self.clone();
                tokio::spawn(async move {
                    match this.state.new_session(&cwd, model.as_deref()).await {
                        Ok(hub) => this.attach(hub),
                        Err(e) => this.reply(Envelope::error("new_failed", &format!("{e:#}"))),
                    }
                });
            }
            kind::DETACH => {
                if let Some(sid) = &env.sid {
                    if let Some(a) = self.attached.lock().unwrap().remove(sid) {
                        a.forwarder.abort();
                        self.state.audit.log(&self.device, "detach", sid);
                    }
                }
            }
            kind::ACP => self.acp(&env),
            kind::SESSION_INFO => self.session_info(&env),
            other => self.reply(Envelope::error("unknown_type", other)),
        }
    }

    fn hello(&self, env: &Envelope) {
        if let Some(Value::Object(map)) = env.payload.as_ref().and_then(|p| p.get("lastSeq")) {
            let mut last = self.last_seq.lock().unwrap();
            for (sid, v) in map {
                if let Some(n) = v.as_u64() {
                    last.insert(sid.clone(), n);
                }
            }
        }
        self.reply(Envelope::new(kind::WELCOME).with_payload(json!({
            "bridgeVersion": env!("CARGO_PKG_VERSION"),
            "grokVersion": self.state.grok_version,
            "protocol": crate::envelope::PROTOCOL_VERSION,
            "device": self.device,
        })));
    }

    fn attach(&self, hub: Arc<SessionHub>) {
        let sid = hub.sid.clone();
        let after = self
            .last_seq
            .lock()
            .unwrap()
            .get(&sid)
            .copied()
            .unwrap_or(0);
        // Stop the old forwarder first, so nothing of it lands after the new `attached`.
        if let Some(old) = self.attached.lock().unwrap().remove(&sid) {
            old.forwarder.abort();
        }
        let out = self.out.clone();
        let forward_hub = hub.clone();
        let seen = self.last_seq.clone();
        let forwarder = tokio::spawn(forward(forward_hub, after, out, seen));
        self.attached
            .lock()
            .unwrap()
            .insert(sid.clone(), Attachment { hub, forwarder });
        self.state.audit.log(&self.device, "attach", &sid);
        notify_mac(
            "Grok Build Remote",
            &format!("{} is now following a Grok Build session", self.device),
        );
    }

    /// What Grok's `/context` shows, for an attached session. The bridge makes this one read-only
    /// call itself (the phone can't send it through `acp`) and passes on only the fields below.
    fn session_info(&self, env: &Envelope) {
        let Some(sid) = env.sid.clone() else {
            return self.reply(Envelope::error("bad_request", "session.info needs sid"));
        };
        let hub = match self.attached.lock().unwrap().get(&sid) {
            Some(a) => a.hub.clone(),
            None => return self.reply(Envelope::error("not_attached", &sid).with_sid(sid)),
        };
        let this = self.clone();
        tokio::spawn(async move {
            let params = json!({"sessionId": sid});
            match hub.agent.request(SESSION_INFO_METHOD, params).await {
                Ok(v) => this.reply(
                    Envelope::new(kind::SESSION_INFO)
                        .with_sid(sid)
                        .with_payload(session_info_fields(&v)),
                ),
                Err(e) => {
                    this.reply(Envelope::error("info_failed", &format!("{e:#}")).with_sid(sid))
                }
            }
        });
    }

    fn acp(&self, env: &Envelope) {
        let Some(sid) = env.sid.as_deref() else {
            return self.reply(Envelope::error("bad_request", "acp needs sid"));
        };
        let hub = match self.attached.lock().unwrap().get(sid) {
            Some(a) => a.hub.clone(),
            None => return self.reply(Envelope::error("not_attached", sid).with_sid(sid)),
        };
        let Some(raw) = env.payload.as_ref().and_then(Value::as_str) else {
            return self.reply(Envelope::error(
                "bad_request",
                "acp payload must be a string",
            ));
        };
        let msg: Value = match serde_json::from_str(raw) {
            Ok(v) => v,
            Err(e) => return self.reply(Envelope::error("bad_json", &e.to_string())),
        };
        match check_phone_message(&msg, sid, &hub.pending_interactions()) {
            Ok(Allowed::Call { method }) => {
                let detail = if self.state.log_prompts && method == "session/prompt" {
                    format!("{sid} {method} {raw}")
                } else {
                    format!("{sid} {method}")
                };
                self.state.audit.log(&self.device, "call", &detail);
            }
            Ok(Allowed::InteractionAnswer { id_key }) => {
                hub.forget_interaction(&id_key);
                let choice = msg
                    .pointer("/result/outcome/optionId")
                    .and_then(Value::as_str)
                    .unwrap_or("answer");
                self.state.audit.log(
                    &self.device,
                    "interaction",
                    &format!("{sid} {id_key} {choice}"),
                );
            }
            Err(reason) => {
                self.state
                    .audit
                    .log(&self.device, "refused", &format!("{sid} {reason}"));
                return self.reply(Envelope::error("refused", reason).with_sid(sid));
            }
        }
        if let Err(e) = hub.agent.send_raw(msg.to_string()) {
            self.reply(Envelope::error("agent_gone", &e.to_string()).with_sid(sid));
        }
    }
}

/// Send `attached`, the replay after `after`, then live events, to one phone. Every seq sent is
/// noted in `seen`, so attaching again on this connection (reopening the session) only sends what
/// the phone hasn't had. `attached` says where the replay starts: `from: 0` means the whole history,
/// and the phone starts its transcript over.
async fn forward(
    hub: Arc<SessionHub>,
    after: u64,
    out: mpsc::UnboundedSender<Envelope>,
    seen: Arc<Mutex<HashMap<String, u64>>>,
) {
    let sid = hub.sid.clone();
    // Beyond the buffer's newest seq: this is a new buffer (the bridge restarted), so start over.
    let after = if after > hub.last_seq() { 0 } else { after };
    let _ = out.send(
        Envelope::new(kind::ATTACHED)
            .with_sid(sid.clone())
            .with_payload(json!({ "from": after })),
    );
    let note = |seq: u64| {
        seen.lock().unwrap().insert(sid.clone(), seq);
    };
    let mut last = after;
    let (since, mut rx) = hub.subscribe_since(after);
    let send_items = |since: Since, last: &mut u64| -> bool {
        let items = match since {
            Since::Complete(v) => v,
            Since::Gap(v) => {
                let _ = out.send(Envelope::status(
                    Some(&sid),
                    "replay_gap",
                    "Some earlier events were dropped; showing what the bridge kept.",
                ));
                v
            }
        };
        for (seq, m) in items {
            if out.send(Envelope::acp(&sid, seq, &m)).is_err() {
                return false;
            }
            *last = seq;
            note(seq);
        }
        true
    };
    if !send_items(since, &mut last) {
        return;
    }
    loop {
        match rx.recv().await {
            Ok(HubEvent::Acp(seq, m)) => {
                if seq > last {
                    if out.send(Envelope::acp(&sid, seq, &m)).is_err() {
                        return;
                    }
                    last = seq;
                    note(seq);
                }
            }
            Ok(HubEvent::Closed) => {
                let _ = out.send(Envelope::status(
                    Some(&sid),
                    "agent_exited",
                    "The Grok Build connection for this session ended. Re-attach to continue.",
                ));
                return;
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                let (since, new_rx) = hub.subscribe_since(last);
                rx = new_rx;
                if !send_items(since, &mut last) {
                    return;
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
        }
    }
}

/// A macOS notification, so a connection you didn't make is obvious. No-op elsewhere.
pub fn notify_mac(title: &str, body: &str) {
    if cfg!(target_os = "macos") {
        // Text goes in as arguments, never spliced into the script.
        let _ = std::process::Command::new("osascript")
            .args([
                "-e",
                "on run argv",
                "-e",
                "display notification (item 2 of argv) with title (item 1 of argv)",
                "-e",
                "end run",
                title,
                body,
            ])
            .spawn();
    }
}

/// Grok Build's own read-only call behind `/context` (not part of ACP, so it may change).
const SESSION_INFO_METHOD: &str = "_x.ai/session/info";

/// The parts of Grok's session info the phone shows: model, turns and context usage.
pub fn session_info_fields(result: &Value) -> Value {
    let info = result.get("result").unwrap_or(result);
    let mut out = serde_json::Map::new();
    for key in ["model", "modelDisplayName", "turns", "context"] {
        if let Some(v) = info.get(key) {
            out.insert(key.to_string(), v.clone());
        }
    }
    Value::Object(out)
}
