//! What a phone may send to the agent.
//!
//! The phone can prompt, cancel, switch model, switch to a *safer* mode, and answer the
//! interaction requests the agent already asked (tool permission, ask-user question, plan
//! approval, MCP elicitation). Everything else is rejected and audited. In particular the
//! phone can never send `initialize`, `session/load` or `session/new` itself (the bridge does
//! that, with auto-approve off), never switch to an auto-approve mode, and never touch a session
//! it isn't attached to.

use std::collections::HashSet;

use serde_json::Value;

/// Agent → client requests that every attached client may answer (first answer wins).
pub const INTERACTION_METHODS: &[&str] = &[
    "session/request_permission",
    "x.ai/ask_user_question",
    "x.ai/exit_plan_mode",
    "x.ai/mcp/elicit",
];

const PHONE_METHODS: &[&str] = &[
    "session/prompt",
    "session/cancel",
    "session/set_mode",
    "session/set_model",
];

/// Mode ids containing any of these are treated as auto-approve modes and refused.
const UNSAFE_MODE_WORDS: &[&str] = &["yolo", "auto", "always", "bypass", "dangerous", "skip"];

/// Bridge-originated request ids use this prefix; the phone may not reuse it.
pub const BRIDGE_ID_PREFIX: &str = "gbr-";

#[derive(Debug, PartialEq, Eq)]
pub enum Allowed {
    /// A request or notification for the agent.
    Call { method: String },
    /// An answer to an interaction request; the caller should forget `id_key` once forwarded.
    InteractionAnswer { id_key: String },
}

/// JSON-RPC ids can be numbers or strings; use their JSON text as a key.
pub fn id_key(id: &Value) -> String {
    id.to_string()
}

pub fn is_interaction_request(msg: &Value) -> bool {
    msg.get("id").is_some()
        && msg
            .get("method")
            .and_then(Value::as_str)
            .is_some_and(|m| INTERACTION_METHODS.contains(&m))
}

pub fn check_phone_message(
    msg: &Value,
    sid: &str,
    pending_interactions: &HashSet<String>,
) -> Result<Allowed, &'static str> {
    let obj = msg.as_object().ok_or("not a JSON object")?;
    if obj.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Err("not JSON-RPC 2.0");
    }

    if let Some(method) = obj.get("method") {
        let method = method.as_str().ok_or("method is not a string")?;
        if !PHONE_METHODS.contains(&method) {
            return Err("method not allowed from the phone");
        }
        if let Some(Value::String(id)) = obj.get("id") {
            if id.starts_with(BRIDGE_ID_PREFIX) {
                return Err("reserved request id");
            }
        }
        let params = obj.get("params").ok_or("missing params")?;
        if params.get("sessionId").and_then(Value::as_str) != Some(sid) {
            return Err("sessionId does not match the attached session");
        }
        if method == "session/set_mode" {
            let mode = params
                .get("modeId")
                .and_then(Value::as_str)
                .ok_or("missing modeId")?
                .to_ascii_lowercase();
            if UNSAFE_MODE_WORDS.iter().any(|w| mode.contains(w)) {
                return Err("auto-approve modes can't be enabled from the phone");
            }
        }
        return Ok(Allowed::Call {
            method: method.to_string(),
        });
    }

    if let Some(id) = obj.get("id") {
        if obj.contains_key("result") || obj.contains_key("error") {
            let key = id_key(id);
            if pending_interactions.contains(&key) {
                return Ok(Allowed::InteractionAnswer { id_key: key });
            }
            return Err("answer to a request the agent didn't ask");
        }
    }
    Err("malformed message")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn none() -> HashSet<String> {
        HashSet::new()
    }

    #[test]
    fn allows_prompt_and_cancel_for_own_session() {
        let p = json!({"jsonrpc":"2.0","id":1,"method":"session/prompt",
                       "params":{"sessionId":"s1","prompt":[{"type":"text","text":"hi"}]}});
        assert_eq!(
            check_phone_message(&p, "s1", &none()),
            Ok(Allowed::Call {
                method: "session/prompt".into()
            })
        );
        let c = json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"s1"}});
        assert!(check_phone_message(&c, "s1", &none()).is_ok());
    }

    #[test]
    fn rejects_other_sessions_and_methods() {
        let p = json!({"jsonrpc":"2.0","id":1,"method":"session/prompt","params":{"sessionId":"other"}});
        assert!(check_phone_message(&p, "s1", &none()).is_err());
        for m in [
            "initialize",
            "session/load",
            "session/new",
            "fs/write_text_file",
            "terminal/create",
        ] {
            let msg = json!({"jsonrpc":"2.0","id":2,"method":m,"params":{"sessionId":"s1"}});
            assert!(check_phone_message(&msg, "s1", &none()).is_err(), "{m}");
        }
    }

    #[test]
    fn refuses_auto_approve_modes() {
        for mode in ["yolo", "always-approve", "AutoMode", "bypassPermissions"] {
            let m = json!({"jsonrpc":"2.0","id":3,"method":"session/set_mode",
                           "params":{"sessionId":"s1","modeId":mode}});
            assert!(check_phone_message(&m, "s1", &none()).is_err(), "{mode}");
        }
        let ok = json!({"jsonrpc":"2.0","id":3,"method":"session/set_mode",
                        "params":{"sessionId":"s1","modeId":"plan"}});
        assert!(check_phone_message(&ok, "s1", &none()).is_ok());
    }

    #[test]
    fn answers_only_pending_interactions() {
        let mut pending = HashSet::new();
        pending.insert(id_key(&json!(17)));
        let ans = json!({"jsonrpc":"2.0","id":17,"result":{"outcome":{"outcome":"selected","optionId":"allow"}}});
        assert_eq!(
            check_phone_message(&ans, "s1", &pending),
            Ok(Allowed::InteractionAnswer {
                id_key: "17".into()
            })
        );
        let stray = json!({"jsonrpc":"2.0","id":18,"result":{}});
        assert!(check_phone_message(&stray, "s1", &pending).is_err());
    }

    #[test]
    fn rejects_reserved_ids_and_garbage() {
        let m = json!({"jsonrpc":"2.0","id":"gbr-1","method":"session/prompt","params":{"sessionId":"s1"}});
        assert!(check_phone_message(&m, "s1", &none()).is_err());
        assert!(check_phone_message(&json!([1, 2]), "s1", &none()).is_err());
        assert!(
            check_phone_message(&json!({"id":1,"method":"session/prompt"}), "s1", &none()).is_err()
        );
    }

    #[test]
    fn recognises_interaction_requests() {
        assert!(is_interaction_request(
            &json!({"jsonrpc":"2.0","id":5,"method":"session/request_permission","params":{}})
        ));
        assert!(!is_interaction_request(
            &json!({"jsonrpc":"2.0","method":"session/update","params":{}})
        ));
        assert!(!is_interaction_request(
            &json!({"jsonrpc":"2.0","id":6,"method":"fs/read_text_file","params":{}})
        ));
    }
}
