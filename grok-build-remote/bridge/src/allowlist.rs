//! What a phone may send to the agent.
//!
//! The phone can prompt, cancel, switch model, switch to a *safer* mode, and answer the
//! interaction requests the agent already asked (tool permission, ask-user question, plan
//! approval, MCP elicitation). Everything else is rejected and audited. In particular the
//! phone can never send `initialize`, `session/load` or `session/new` itself (the bridge does
//! that, with auto-approve off), never switch to an auto-approve mode, and never touch a session
//! it isn't attached to.

use std::collections::{HashMap, HashSet};

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

/// Permission options the phone may pick: one-off answers only. "Allow for this session",
/// "never allow" and similar remembered choices stay in the terminal.
const PHONE_OPTION_KINDS: &[&str] = &["allow_once", "reject_once"];

/// Options whose id or name contains any of these are refused even with a one-off kind: Grok
/// offers "Yes, and don't ask again for anything (always-approve mode)" with kind `allow_once`.
const UNSAFE_OPTION_WORDS: &[&str] = &[
    "always",
    "auto",
    "yolo",
    "bypass",
    "don't ask",
    "dont ask",
    "don\u{2019}t ask",
    "never ask",
];

/// The only top-level fields an answer may carry.
const ANSWER_FIELDS: &[&str] = &["jsonrpc", "id", "result", "error"];

/// Pending agent → client interaction requests: request id key → option ids the phone may pick
/// (empty for interactions the phone can't answer yet, such as ask-user questions).
pub type PendingInteractions = HashMap<String, HashSet<String>>;

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

/// Whether the phone may pick this permission option (see `PHONE_OPTION_KINDS`).
pub fn is_phone_option(option: &Value) -> bool {
    let field = |k: &str| option.get(k).and_then(Value::as_str).unwrap_or("");
    let text = format!("{} {}", field("optionId"), field("name")).to_lowercase();
    PHONE_OPTION_KINDS.contains(&field("kind"))
        && !UNSAFE_OPTION_WORDS.iter().any(|w| text.contains(w))
}

/// The option ids of an interaction request that the phone may answer with.
pub fn phone_option_ids(request: &Value) -> HashSet<String> {
    if request.get("method").and_then(Value::as_str) != Some("session/request_permission") {
        return HashSet::new();
    }
    request
        .pointer("/params/options")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|o| is_phone_option(o))
        .filter_map(|o| o.get("optionId").and_then(Value::as_str))
        .map(str::to_string)
        .collect()
}

/// An answer's `result` must be exactly `{"outcome":{"outcome":"cancelled"}}` or
/// `{"outcome":{"outcome":"selected","optionId":<allowed>}}`; no extra fields ride along.
fn check_answer(result: &Value, allowed: &HashSet<String>) -> Result<(), &'static str> {
    let result = result.as_object().ok_or("result is not an object")?;
    if result.len() != 1 {
        return Err("unexpected fields in answer");
    }
    let outcome = result
        .get("outcome")
        .and_then(Value::as_object)
        .ok_or("answer has no outcome")?;
    let kind = outcome.get("outcome").and_then(Value::as_str);
    match (kind, outcome.len()) {
        (Some("cancelled"), 1) => Ok(()),
        (Some("selected"), 2) => {
            let option = outcome
                .get("optionId")
                .and_then(Value::as_str)
                .ok_or("answer has no optionId")?;
            if allowed.contains(option) {
                Ok(())
            } else {
                Err("only allow-once and reject answers can be sent from the phone")
            }
        }
        _ => Err("unsupported answer"),
    }
}

pub fn check_phone_message(
    msg: &Value,
    sid: &str,
    pending_interactions: &PendingInteractions,
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
            let Some(allowed) = pending_interactions.get(&key) else {
                return Err("answer to a request the agent didn't ask");
            };
            if !obj.keys().all(|k| ANSWER_FIELDS.contains(&k.as_str())) {
                return Err("unexpected fields in answer");
            }
            if let Some(result) = obj.get("result") {
                check_answer(result, allowed)?;
            }
            return Ok(Allowed::InteractionAnswer { id_key: key });
        }
    }
    Err("malformed message")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn none() -> PendingInteractions {
        PendingInteractions::new()
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

    /// The four options real Grok Build 1.0.89 offered for a file edit.
    fn grok_edit_request() -> Value {
        json!({"jsonrpc":"2.0","id":9,"method":"session/request_permission","params":{
            "sessionId":"s1","toolCall":{"toolCallId":"t1"},"options":[
            {"optionId":"allow-always","name":"Yes, allow edits in ai-agents-apps/ for this session","kind":"allow_always"},
            {"optionId":"allow-once","name":"Yes","kind":"allow_once"},
            {"optionId":"reject-once","name":"No, and tell Grok what to do differently","kind":"reject_once"},
            {"optionId":"yolo","name":"Yes, and don't ask again for anything (always-approve mode)","kind":"allow_once"},
            {"optionId":"reject-always","name":"Never allow: rm x","kind":"reject_always"}]}})
    }

    #[test]
    fn phone_may_pick_only_one_off_options() {
        let ids = phone_option_ids(&grok_edit_request());
        assert_eq!(
            ids,
            HashSet::from(["allow-once".to_string(), "reject-once".to_string()])
        );
        // The always-approve option is refused by name even with a neutral id.
        let sneaky = json!({"optionId":"opt3","kind":"allow_once",
            "name":"Yes, and don\u{2019}t ask again for anything"});
        assert!(!is_phone_option(&sneaky));
        // Other interaction kinds can't be answered from the phone.
        let question = json!({"jsonrpc":"2.0","id":4,"method":"x.ai/ask_user_question",
            "params":{"options":[{"optionId":"a","kind":"allow_once","name":"A"}]}});
        assert!(phone_option_ids(&question).is_empty());
    }

    #[test]
    fn refuses_widening_answers() {
        let mut pending = PendingInteractions::new();
        pending.insert(id_key(&json!(9)), phone_option_ids(&grok_edit_request()));
        let ok = |m: &Value| check_phone_message(m, "s1", &pending).is_ok();
        let pick = |id: &str| {
            let outcome = json!({"outcome":"selected","optionId":id});
            json!({"jsonrpc":"2.0","id":9,"result":{"outcome":outcome}})
        };

        assert!(ok(&pick("allow-once")));
        assert!(ok(&pick("reject-once")));
        let cancel = json!({"jsonrpc":"2.0","id":9,"result":{"outcome":{"outcome":"cancelled"}}});
        assert!(ok(&cancel));
        for id in ["allow-always", "yolo", "reject-always", "made-up"] {
            assert!(!ok(&pick(id)), "{id}");
        }
        let extra = json!({"jsonrpc":"2.0","id":9,"result":{
            "outcome":{"outcome":"selected","optionId":"allow-once"},"_meta":{"yoloMode":true}}});
        assert!(!ok(&extra));
        let extra_top = json!({"jsonrpc":"2.0","id":9,"method_hint":"x",
            "result":{"outcome":{"outcome":"selected","optionId":"allow-once"}}});
        assert!(!ok(&extra_top));
        let error = json!({"jsonrpc":"2.0","id":9,"error":{"code":-32000,"message":"no"}});
        assert!(ok(&error));
    }

    #[test]
    fn answers_only_pending_interactions() {
        let mut pending = PendingInteractions::new();
        pending.insert(id_key(&json!(17)), HashSet::from(["allow".to_string()]));
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
