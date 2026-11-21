//! A session the bridge is following: one agent child, its replay buffer, and the live broadcast
//! that attached phones subscribe to.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc};

use crate::agent::Agent;
use crate::allowlist::{id_key, is_interaction_request};
use crate::replay::{Replay, Since, DEFAULT_CAPACITY};

#[derive(Debug, Clone)]
pub enum HubEvent {
    Acp(u64, Arc<str>),
    /// The agent process exited; the session must be re-attached.
    Closed,
}

pub struct SessionHub {
    pub sid: String,
    pub agent: Arc<Agent>,
    replay: Mutex<Replay>,
    tx: broadcast::Sender<HubEvent>,
    interactions: Mutex<HashSet<String>>,
    closed: Mutex<bool>,
}

impl SessionHub {
    /// Start an agent and attach it to an existing session with `session/load`.
    pub async fn load(grok_bin: &PathBuf, sid: &str, cwd: &str) -> Result<Arc<Self>> {
        let (agent, events) = Agent::spawn(grok_bin)?;
        agent.initialize().await?;
        let hub = Self::start(sid.to_string(), agent.clone(), events);
        // The agent replays the history as session/update notifications before answering.
        agent
            .request(
                "session/load",
                json!({"sessionId": sid, "cwd": cwd, "mcpServers": []}),
            )
            .await
            .context("session/load")?;
        Ok(hub)
    }

    /// Start an agent and create a new session in `cwd`.
    pub async fn create(grok_bin: &PathBuf, cwd: &str, model: Option<&str>) -> Result<Arc<Self>> {
        let (agent, events) = Agent::spawn(grok_bin)?;
        agent.initialize().await?;
        let mut params = json!({"cwd": cwd, "mcpServers": []});
        if let Some(m) = model {
            params["modelId"] = Value::String(m.to_string());
        }
        // Notifications that arrive before we know the session id are buffered by the channel.
        let result = agent.request("session/new", params).await?;
        let sid = result
            .get("sessionId")
            .and_then(Value::as_str)
            .context("session/new returned no sessionId")?
            .to_string();
        Ok(Self::start(sid, agent, events))
    }

    fn start(
        sid: String,
        agent: Arc<Agent>,
        mut events: mpsc::UnboundedReceiver<Value>,
    ) -> Arc<Self> {
        let (tx, _) = broadcast::channel(1024);
        let hub = Arc::new(Self {
            sid,
            agent,
            replay: Mutex::new(Replay::new(DEFAULT_CAPACITY)),
            tx,
            interactions: Mutex::new(HashSet::new()),
            closed: Mutex::new(false),
        });
        let pump = hub.clone();
        tokio::spawn(async move {
            while let Some(msg) = events.recv().await {
                pump.on_agent_message(msg);
            }
            *pump.closed.lock().unwrap() = true;
            let _ = pump.tx.send(HubEvent::Closed);
        });
        hub
    }

    fn on_agent_message(&self, msg: Value) {
        if let (Some(method), Some(id)) = (msg.get("method").and_then(Value::as_str), msg.get("id"))
        {
            if is_interaction_request(&msg) {
                self.interactions.lock().unwrap().insert(id_key(id));
            } else {
                // fs/*, terminal/* and anything else: we advertised no such capability.
                tracing::warn!("rejecting agent request {method}");
                self.agent.reject_request(id, method);
                return;
            }
        }
        let text: Arc<str> = Arc::from(msg.to_string());
        // Push and broadcast under the same lock so subscribers see a gapless sequence.
        let mut replay = self.replay.lock().unwrap();
        let seq = replay.push(text.clone());
        let _ = self.tx.send(HubEvent::Acp(seq, text));
    }

    pub fn is_closed(&self) -> bool {
        *self.closed.lock().unwrap()
    }

    /// Subscribe and get everything after `after` in one consistent step.
    pub fn subscribe_since(&self, after: u64) -> (Since, broadcast::Receiver<HubEvent>) {
        let replay = self.replay.lock().unwrap();
        let rx = self.tx.subscribe();
        (replay.since(after), rx)
    }

    pub fn pending_interactions(&self) -> HashSet<String> {
        self.interactions.lock().unwrap().clone()
    }

    pub fn forget_interaction(&self, key: &str) {
        self.interactions.lock().unwrap().remove(key);
    }
}
