//! One `grok agent stdio` child process, spoken to in ACP (JSON-RPC 2.0, one message per line).
//!
//! `grok agent stdio` is Grok Build's documented ACP entry point. It connects to the Grok Build
//! leader process on this Mac, so a session opened here is the same session the terminal shows.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot};

use crate::allowlist::BRIDGE_ID_PREFIX;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(90);

/// Agent options go between `agent` and the mode name. `--leader` makes the shared-session
/// design explicit: the agent joins the leader the TUI uses instead of running a private one.
/// (`--no-auto-update` is a `grok -p` flag only; `agent stdio` rejects it and exits.)
pub const AGENT_ARGS: [&str; 3] = ["agent", "--leader", "stdio"];

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;

pub struct Agent {
    out: mpsc::UnboundedSender<String>,
    pending: Pending,
    /// Set once grok's stdout has closed; no response can arrive after that.
    closed: Arc<AtomicBool>,
    next_id: AtomicU64,
    child: tokio::sync::Mutex<Child>,
}

impl Agent {
    /// Spawn `<grok_bin> agent --leader stdio`. No shell is involved; the argument list is fixed
    /// (`AGENT_ARGS`). Returns the agent and the stream of everything it sends that is not a
    /// response to a bridge request (notifications, agent→client requests, responses to phone
    /// requests).
    pub fn spawn(grok_bin: &PathBuf) -> Result<(Arc<Agent>, mpsc::UnboundedReceiver<Value>)> {
        let mut child = Command::new(grok_bin)
            .args(AGENT_ARGS)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("starting `{} agent stdio`", grok_bin.display()))?;

        let stdin = child.stdin.take().context("no stdin")?;
        let stdout = child.stdout.take().context("no stdout")?;
        let stderr = child.stderr.take().context("no stderr")?;

        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        let (events_tx, events_rx) = mpsc::unbounded_channel::<Value>();
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));

        // Writer: one JSON message per line.
        tokio::spawn(async move {
            let mut stdin = stdin;
            while let Some(line) = out_rx.recv().await {
                if stdin.write_all(line.as_bytes()).await.is_err()
                    || stdin.write_all(b"\n").await.is_err()
                    || stdin.flush().await.is_err()
                {
                    break;
                }
            }
        });

        // Reader: route responses to bridge requests, forward everything else.
        let closed = Arc::new(AtomicBool::new(false));
        let reader_pending = pending.clone();
        let reader_closed = closed.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let msg: Value = match serde_json::from_str(line) {
                    Ok(v) => v,
                    Err(e) => {
                        tracing::warn!("agent sent non-JSON line ({e}): {line:.200}");
                        continue;
                    }
                };
                if msg.get("method").is_none() {
                    if let Some(Value::String(id)) = msg.get("id") {
                        if id.starts_with(BRIDGE_ID_PREFIX) {
                            let waiter = reader_pending.lock().unwrap().remove(id);
                            if let Some(tx) = waiter {
                                let _ = tx.send(msg);
                            }
                            continue;
                        }
                    }
                }
                if events_tx.send(msg).is_err() {
                    break;
                }
            }
            // grok exited (or closed stdout): fail every waiting request now instead of letting
            // each one sit out REQUEST_TIMEOUT. Dropping the senders makes `request` return
            // "grok exited". The flag is set first so a request racing with this sees it.
            reader_closed.store(true, Ordering::SeqCst);
            reader_pending.lock().unwrap().clear();
        });

        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::debug!(target: "grok", "{line}");
            }
        });

        let agent = Arc::new(Agent {
            out: out_tx,
            pending,
            closed,
            next_id: AtomicU64::new(1),
            child: tokio::sync::Mutex::new(child),
        });
        Ok((agent, events_rx))
    }

    /// Send a request and wait for its result.
    pub async fn request(&self, method: &str, params: Value) -> Result<Value> {
        let id = format!(
            "{BRIDGE_ID_PREFIX}{}",
            self.next_id.fetch_add(1, Ordering::Relaxed)
        );
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id.clone(), tx);
        if self.closed.load(Ordering::SeqCst) {
            self.pending.lock().unwrap().remove(&id);
            bail!("{method}: grok exited");
        }
        let msg = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        self.send_raw(msg.to_string())?;
        let resp = tokio::time::timeout(REQUEST_TIMEOUT, rx)
            .await
            .map_err(|_| anyhow!("{method}: no answer from grok within {REQUEST_TIMEOUT:?}"))?
            .map_err(|_| anyhow!("{method}: grok exited"))?;
        if let Some(err) = resp.get("error") {
            bail!("{method} failed: {err}");
        }
        Ok(resp.get("result").cloned().unwrap_or(Value::Null))
    }

    pub fn send_raw(&self, line: String) -> Result<()> {
        self.out.send(line).map_err(|_| anyhow!("grok exited"))
    }

    /// Reply to an agent → client request with "method not found" (used for file-system and
    /// terminal requests: the bridge tells the agent it has neither, so it uses its own tools).
    pub fn reject_request(&self, id: &Value, method: &str) {
        let msg = json!({"jsonrpc":"2.0","id":id,
            "error":{"code":-32601,"message":format!("{method} is not supported by gbr")}});
        let _ = self.send_raw(msg.to_string());
    }

    /// ACP `initialize` with no client file-system or terminal capabilities.
    pub async fn initialize(&self) -> Result<Value> {
        self.request(
            "initialize",
            json!({
                "protocolVersion": 1,
                "clientCapabilities": {
                    "fs": {"readTextFile": false, "writeTextFile": false},
                    "terminal": false
                },
                "clientInfo": {"name": "gbr", "version": env!("CARGO_PKG_VERSION")}
            }),
        )
        .await
    }

    pub async fn kill(&self) {
        let _ = self.child.lock().await.kill().await;
    }
}

/// `grok version`, or "unknown".
pub async fn grok_version(grok_bin: &PathBuf) -> String {
    match Command::new(grok_bin).arg("version").output().await {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).trim().to_string(),
        _ => "unknown".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A grok that exits at once (as real grok does on a bad argument) must fail the pending
    /// request right away, not after REQUEST_TIMEOUT.
    #[tokio::test]
    async fn request_fails_fast_when_grok_exits() {
        let (agent, _events) = Agent::spawn(&PathBuf::from("false")).unwrap();
        let started = std::time::Instant::now();
        let err = agent.initialize().await.unwrap_err();
        assert!(err.to_string().contains("grok exited"), "{err:#}");
        assert!(started.elapsed() < Duration::from_secs(10));
        // A request sent after the exit was noticed fails too.
        assert!(agent.initialize().await.is_err());
    }
}
