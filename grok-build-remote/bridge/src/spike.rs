//! `gbr spike`: the Milestone 0 check.
//!
//! Open a session in the Grok Build TUI, then run `gbr spike --session <id> --cwd <dir>` in another
//! terminal. It attaches to the same session the way the bridge will, prints every update, and
//! lets you answer one permission request from the keyboard. If you see the TUI's history replayed,
//! live updates while you type in the TUI, and the permission prompt in both places, the live
//! attach path works.

use std::path::PathBuf;

use anyhow::Result;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::agent::Agent;
use crate::allowlist::is_interaction_request;

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

    let printer_agent = agent.clone();
    let printer = tokio::spawn(async move {
        let mut stdin = BufReader::new(tokio::io::stdin()).lines();
        let mut count = 0u64;
        while let Some(msg) = events.recv().await {
            count += 1;
            println!("[{count}] {}", summarize(&msg));
            if is_interaction_request(&msg) {
                let options = msg
                    .pointer("/params/options")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                for (i, o) in options.iter().enumerate() {
                    println!(
                        "    {i}: {} ({})",
                        o.get("name").and_then(Value::as_str).unwrap_or("?"),
                        o.get("kind").and_then(Value::as_str).unwrap_or("?")
                    );
                }
                println!("    Answer here (number), or answer in the TUI and press Enter to skip:");
                let choice = stdin.next_line().await.ok().flatten().unwrap_or_default();
                if let Some(opt) = choice
                    .trim()
                    .parse::<usize>()
                    .ok()
                    .and_then(|i| options.get(i))
                {
                    let reply = json!({"jsonrpc":"2.0","id":msg["id"],
                        "result":{"outcome":{"outcome":"selected","optionId":opt["optionId"]}}});
                    let _ = printer_agent.send_raw(reply.to_string());
                    println!("    sent: {}", opt["optionId"]);
                }
            } else if let (Some(m), Some(id)) =
                (msg.get("method").and_then(Value::as_str), msg.get("id"))
            {
                printer_agent.reject_request(id, m);
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

/// One line per message: method, update kind, tool title, or a short text preview.
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
    format!("session/update {kind} {detail}")
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
    }
}
