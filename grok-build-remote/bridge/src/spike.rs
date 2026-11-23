//! `gbr spike`: the Milestone 0 check.
//!
//! Open a session in the Grok Build TUI (started with `grok --leader`), then run
//! `gbr spike --session <id> --cwd <dir>` in another terminal. It attaches to the same session the
//! way the bridge will, prints every update, and lets you answer permission requests from the
//! keyboard. It keeps printing while a request is open, so you can also answer in the TUI and
//! watch the request resolve here. If you see the TUI's history replayed, live updates while you
//! type in the TUI, and the permission prompt in both places, the live attach path works.

use std::path::PathBuf;

use anyhow::Result;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::mpsc;

use crate::agent::Agent;
use crate::allowlist::is_interaction_request;

/// A permission request the spike has shown and nobody has answered yet.
struct OpenRequest {
    id: Value,
    tool_call_id: Option<String>,
    options: Vec<Value>,
}

pub async fn run(grok_bin: PathBuf, sid: String, cwd: String) -> Result<()> {
    println!("Starting `{} agent stdio`…", grok_bin.display());
    let (agent, mut events) = Agent::spawn(&grok_bin)?;
    let init = agent.initialize().await?;
    println!(
        "initialize OK. loadSession={} list={}",
        init.pointer("/agentCapabilities/loadSession")
            .unwrap_or(&Value::Null),
        init.pointer("/agentCapabilities/sessionCapabilities/list")
            .is_some()
    );

    // Keyboard lines arrive on a channel so the event loop never blocks on stdin.
    let (keys_tx, mut keys) = mpsc::unbounded_channel::<String>();
    tokio::spawn(async move {
        let mut stdin = BufReader::new(tokio::io::stdin()).lines();
        while let Ok(Some(line)) = stdin.next_line().await {
            if keys_tx.send(line).is_err() {
                break;
            }
        }
    });

    let printer_agent = agent.clone();
    let printer = tokio::spawn(async move {
        let mut count = 0u64;
        let mut open: Option<OpenRequest> = None;
        let mut keys_open = true;
        loop {
            tokio::select! {
                msg = events.recv() => {
                    let Some(msg) = msg else { break };
                    count += 1;
                    println!("[{count}] {}", summarize(&msg));
                    if is_interaction_request(&msg) {
                        let req = open_request(&msg);
                        for (i, o) in req.options.iter().enumerate() {
                            println!(
                                "    {i}: {} ({})",
                                o.get("name").and_then(Value::as_str).unwrap_or("?"),
                                o.get("kind").and_then(Value::as_str).unwrap_or("?")
                            );
                        }
                        println!("    Answer here (number + Enter), or answer in the TUI.");
                        open = Some(req);
                    } else if let (Some(m), Some(id)) =
                        (msg.get("method").and_then(Value::as_str), msg.get("id"))
                    {
                        printer_agent.reject_request(id, m);
                    } else if let Some(req) = &open {
                        if resolves_elsewhere(&msg, req.tool_call_id.as_deref()) {
                            println!("    >>> permission request answered elsewhere (the TUI): tool call moved on");
                            open = None;
                        }
                    }
                }
                line = keys.recv(), if keys_open => {
                    let Some(line) = line else {
                        keys_open = false; // stdin closed: stop polling it
                        continue;
                    };
                    let Some(req) = open.take() else { continue };
                    match line.trim().parse::<usize>().ok().and_then(|i| req.options.get(i)) {
                        Some(opt) => {
                            let reply = json!({"jsonrpc":"2.0","id":req.id,
                                "result":{"outcome":{"outcome":"selected","optionId":opt["optionId"]}}});
                            let _ = printer_agent.send_raw(reply.to_string());
                            println!("    sent: {}", opt["optionId"]);
                        }
                        None => {
                            println!("    (not an option number; still waiting)");
                            open = Some(req);
                        }
                    }
                }
            }
        }
        println!("grok closed the connection.");
    });

    println!("session/load {sid} …");
    match agent
        .request("session/load", json!({"sessionId": sid, "cwd": cwd, "mcpServers": []}))
        .await
    {
        Ok(_) => println!("session/load OK — history replayed above. Now type in the TUI and watch. Ctrl-C to stop."),
        Err(e) => println!("session/load FAILED: {e:#}"),
    }
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = printer => {}
    }
    agent.kill().await;
    Ok(())
}

fn open_request(msg: &Value) -> OpenRequest {
    OpenRequest {
        id: msg["id"].clone(),
        tool_call_id: msg
            .pointer("/params/toolCall/toolCallId")
            .and_then(Value::as_str)
            .map(str::to_string),
        options: msg
            .pointer("/params/options")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
    }
}

/// True when `msg` shows the tool call behind an open permission request moving past "pending",
/// which is how a client learns that another client (the TUI) answered it.
fn resolves_elsewhere(msg: &Value, tool_call_id: Option<&str>) -> bool {
    let Some(tool_call_id) = tool_call_id else {
        return false;
    };
    let update = &msg["params"]["update"];
    update["toolCallId"].as_str() == Some(tool_call_id)
        && matches!(
            update["status"].as_str(),
            Some("in_progress" | "completed" | "failed")
        )
}

/// One line per message: method, update kind, tool title, status, or a short text preview.
pub fn summarize(msg: &Value) -> String {
    let method = msg
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("(response)");
    if method != "session/update" {
        return method.to_string();
    }
    let update = &msg["params"]["update"];
    let kind = update["sessionUpdate"].as_str().unwrap_or("?");
    let detail = update["content"]["text"]
        .as_str()
        .or_else(|| update["title"].as_str())
        .unwrap_or("");
    let mut detail: String = detail.chars().take(80).collect();
    detail = detail.replace('\n', " ");
    match update["status"].as_str() {
        Some(status) => format!("session/update {kind} {detail} [{status}]"),
        None => format!("session/update {kind} {detail}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarizes_updates() {
        let m = json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s",
            "update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Hello\nworld"}}}});
        assert_eq!(
            summarize(&m),
            "session/update agent_message_chunk Hello world"
        );
        let t = json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s",
            "update":{"sessionUpdate":"tool_call","toolCallId":"t1","title":"Read src/a.rs","kind":"read"}}});
        assert_eq!(summarize(&t), "session/update tool_call Read src/a.rs");
        let u = json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s",
            "update":{"sessionUpdate":"tool_call_update","toolCallId":"t1","status":"completed"}}});
        assert_eq!(
            summarize(&u),
            "session/update tool_call_update  [completed]"
        );
    }

    #[test]
    fn detects_request_answered_elsewhere() {
        let req = json!({"jsonrpc":"2.0","id":7,"method":"session/request_permission","params":{
            "sessionId":"s","toolCall":{"toolCallId":"t1"},"options":[{"optionId":"allow-once"}]}});
        let open = open_request(&req);
        assert_eq!(open.tool_call_id.as_deref(), Some("t1"));
        assert_eq!(open.options.len(), 1);

        let update = |id: &str, status: &str| {
            json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s",
                "update":{"sessionUpdate":"tool_call_update","toolCallId":id,"status":status}}})
        };
        assert!(resolves_elsewhere(&update("t1", "in_progress"), Some("t1")));
        assert!(resolves_elsewhere(&update("t1", "failed"), Some("t1")));
        assert!(!resolves_elsewhere(&update("t1", "pending"), Some("t1")));
        assert!(!resolves_elsewhere(&update("t2", "completed"), Some("t1")));
        assert!(!resolves_elsewhere(&update("t1", "completed"), None));
    }
}
