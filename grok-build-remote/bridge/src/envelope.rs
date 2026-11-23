//! The phone ⇄ bridge envelope (protocol v1). See `docs/protocol.md`.
//!
//! Every WebSocket text frame is one JSON object:
//! `{"v":1,"type":"acp","sid":"…","seq":42,"payload":…}`.
//! For `type = "acp"` the payload is a raw ACP JSON-RPC message as a string, passed through as is.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Envelope {
    pub v: u32,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
}

/// Message types. Phone → bridge: `hello`, `pair`, `sessions.list`, `session.new`, `attach`,
/// `detach`, `acp`, `session.info`, `ping`. Bridge → phone: `welcome`, `pairing`, `paired`,
/// `sessions`, `attached`, `acp`, `session.info`, `bridge.status`, `error`, `pong`.
pub mod kind {
    pub const HELLO: &str = "hello";
    pub const PAIR: &str = "pair";
    pub const SESSIONS_LIST: &str = "sessions.list";
    pub const SESSION_NEW: &str = "session.new";
    pub const ATTACH: &str = "attach";
    pub const DETACH: &str = "detach";
    pub const ACP: &str = "acp";
    /// Context window usage for an attached session (both directions: request and answer).
    pub const SESSION_INFO: &str = "session.info";
    pub const PING: &str = "ping";

    pub const WELCOME: &str = "welcome";
    pub const PAIRING: &str = "pairing";
    pub const PAIRED: &str = "paired";
    pub const SESSIONS: &str = "sessions";
    pub const ATTACHED: &str = "attached";
    pub const STATUS: &str = "bridge.status";
    pub const ERROR: &str = "error";
    pub const PONG: &str = "pong";
}

impl Envelope {
    pub fn new(kind: &str) -> Self {
        Self {
            v: PROTOCOL_VERSION,
            kind: kind.to_string(),
            sid: None,
            seq: None,
            payload: None,
        }
    }

    pub fn with_sid(mut self, sid: impl Into<String>) -> Self {
        self.sid = Some(sid.into());
        self
    }

    pub fn with_seq(mut self, seq: u64) -> Self {
        self.seq = Some(seq);
        self
    }

    pub fn with_payload(mut self, payload: Value) -> Self {
        self.payload = Some(payload);
        self
    }

    pub fn acp(sid: &str, seq: u64, raw: &str) -> Self {
        Self::new(kind::ACP)
            .with_sid(sid)
            .with_seq(seq)
            .with_payload(Value::String(raw.to_string()))
    }

    pub fn error(code: &str, message: &str) -> Self {
        Self::new(kind::ERROR).with_payload(serde_json::json!({"code": code, "message": message}))
    }

    pub fn status(sid: Option<&str>, code: &str, message: &str) -> Self {
        let mut e = Self::new(kind::STATUS)
            .with_payload(serde_json::json!({"code": code, "message": message}));
        e.sid = sid.map(str::to_string);
        e
    }

    pub fn parse(text: &str) -> Result<Self, String> {
        let env: Envelope = serde_json::from_str(text).map_err(|e| format!("bad envelope: {e}"))?;
        if env.v != PROTOCOL_VERSION {
            return Err(format!("unsupported protocol version {}", env.v));
        }
        Ok(env)
    }

    pub fn to_text(&self) -> String {
        serde_json::to_string(self).expect("envelope serializes")
    }

    /// The payload's string field `key`, if present.
    pub fn payload_str(&self, key: &str) -> Option<&str> {
        self.payload.as_ref()?.get(key)?.as_str()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acp_envelope_round_trip() {
        let e = Envelope::acp("s1", 7, r#"{"jsonrpc":"2.0","method":"session/update"}"#);
        let text = e.to_text();
        assert!(text.contains(r#""type":"acp""#));
        assert_eq!(Envelope::parse(&text).unwrap(), e);
    }

    #[test]
    fn rejects_other_versions_and_garbage() {
        assert!(Envelope::parse(r#"{"v":2,"type":"hello"}"#).is_err());
        assert!(Envelope::parse("not json").is_err());
    }

    #[test]
    fn optional_fields_are_omitted() {
        assert_eq!(Envelope::new("ping").to_text(), r#"{"v":1,"type":"ping"}"#);
    }
}
