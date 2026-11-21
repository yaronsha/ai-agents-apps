//! Grok Build Remote bridge (`gbr`).
//!
//! Runs on the Mac next to Grok Build. A paired Android phone connects over TLS (inside a VPN such
//! as Tailscale), and the bridge joins Grok Build sessions through `grok agent stdio` (ACP) on
//! the phone's behalf. See the README for the security model.

pub mod agent;
pub mod allowlist;
pub mod audit;
pub mod config;
pub mod devices;
pub mod envelope;
pub mod hub;
pub mod pairing;
pub mod replay;
pub mod server;
pub mod spike;
pub mod tls;
