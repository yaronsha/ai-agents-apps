//! Test helper: pretends to be `grok agent stdio` closely enough for the bridge's tests.
//! Not part of the shipped tool.

use std::io::{BufRead, Write};

use serde_json::{json, Value};

fn send(out: &mut impl Write, v: Value) {
    writeln!(out, "{v}").unwrap();
    out.flush().unwrap();
}

fn update(sid: &str, update: Value) -> Value {
    json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":sid,"update":update}})
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("version") {
        println!("fake-grok 0.0.0");
        return;
    }
    // Like real grok, refuse an argument list it doesn't know (agent options go between `agent`
    // and the mode name), so the tests catch a wrong command line.
    if args[1..] != gbr::agent::AGENT_ARGS {
        eprintln!("error: unexpected arguments {:?}", &args[1..]);
        std::process::exit(2);
    }
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    let mut waiting_prompt: Option<(Value, String)> = None;

    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let id = msg.get("id").cloned();
        let method = msg
            .get("method")
            .and_then(Value::as_str)
            .map(str::to_string);
        let params = msg.get("params").cloned().unwrap_or(Value::Null);

        match method.as_deref() {
            Some("initialize") => send(
                &mut out,
                json!({"jsonrpc":"2.0","id":id,"result":{"protocolVersion":1,
                    "agentCapabilities":{"loadSession":true,"sessionCapabilities":{"list":{}}}}}),
            ),
            Some("session/list") => send(
                &mut out,
                json!({"jsonrpc":"2.0","id":id,"result":{"sessions":[
                    {"sessionId":"s1","cwd":"/tmp/project","title":"Fix flaky auth tests"}]}}),
            ),
            Some("session/load") => {
                let sid = params["sessionId"].as_str().unwrap_or("s1").to_string();
                send(
                    &mut out,
                    update(
                        &sid,
                        json!({"sessionUpdate":"user_message_chunk",
                    "content":{"type":"text","text":"Add retries"}}),
                    ),
                );
                send(
                    &mut out,
                    update(
                        &sid,
                        json!({"sessionUpdate":"agent_message_chunk",
                    "content":{"type":"text","text":"Looking at the worker."}}),
                    ),
                );
                send(&mut out, json!({"jsonrpc":"2.0","id":id,"result":{}}));
            }
            Some("session/new") => {
                send(
                    &mut out,
                    json!({"jsonrpc":"2.0","id":id,"result":{"sessionId":"new-1"}}),
                );
            }
            Some("session/prompt") => {
                let sid = params["sessionId"].as_str().unwrap_or("s1").to_string();
                send(
                    &mut out,
                    update(
                        &sid,
                        json!({"sessionUpdate":"tool_call","toolCallId":"t1",
                    "title":"git push","kind":"execute","status":"pending"}),
                    ),
                );
                send(
                    &mut out,
                    json!({"jsonrpc":"2.0","id":100,"method":"session/request_permission",
                    "params":{"sessionId":sid,"toolCall":{"toolCallId":"t1","title":"git push"},
                    "options":[{"optionId":"allow","name":"Allow once","kind":"allow_once"},
                               {"optionId":"reject","name":"Reject","kind":"reject_once"}]}}),
                );
                waiting_prompt = Some((id.unwrap_or(Value::Null), sid));
            }
            Some("session/cancel") => {}
            Some(other) => {
                if id.is_some() {
                    send(
                        &mut out,
                        json!({"jsonrpc":"2.0","id":id,
                        "error":{"code":-32601,"message":format!("unknown {other}")}}),
                    );
                }
            }
            None => {
                // A response from the client: the permission answer.
                if id == Some(json!(100)) {
                    if let Some((prompt_id, sid)) = waiting_prompt.take() {
                        let choice = msg
                            .pointer("/result/outcome/optionId")
                            .and_then(Value::as_str)
                            .unwrap_or("none")
                            .to_string();
                        let status = if choice == "allow" {
                            "completed"
                        } else {
                            "failed"
                        };
                        send(
                            &mut out,
                            update(
                                &sid,
                                json!({"sessionUpdate":"tool_call_update",
                            "toolCallId":"t1","status":status}),
                            ),
                        );
                        send(
                            &mut out,
                            update(
                                &sid,
                                json!({"sessionUpdate":"agent_message_chunk",
                            "content":{"type":"text","text":format!("chose {choice}")}}),
                            ),
                        );
                        send(
                            &mut out,
                            json!({"jsonrpc":"2.0","id":prompt_id,
                            "result":{"stopReason":"end_turn"}}),
                        );
                    }
                }
            }
        }
    }
}
