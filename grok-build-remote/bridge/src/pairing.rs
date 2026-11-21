//! One-time pairing.
//!
//! `gbr pair` writes a pending pairing (a hash of a one-time token, valid 5 minutes) to
//! `pairing.json` and shows a QR code with the bridge address, the bridge certificate fingerprint
//! and the token. The phone connects with its own new client certificate and sends the token.
//! The running server checks the token, records the phone's certificate fingerprint as a pending
//! device and both sides show the same 6-digit code. Only when you confirm the code on the Mac
//! does `gbr pair` add the phone to `devices.json`. The token works once.

use anyhow::{bail, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::config::{write_private, Paths};

pub const TOKEN_TTL_SECS: i64 = 5 * 60;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PendingDevice {
    pub name: String,
    pub fingerprint: String,
    pub code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingPairing {
    pub token_sha256: String,
    pub expires_at: i64,
    #[serde(default)]
    pub device: Option<PendingDevice>,
}

/// What the QR code holds. The phone parses exactly this JSON.
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct QrPayload {
    pub gbr: u32,
    pub addr: String,
    pub fp: String,
    pub token: String,
}

pub fn new_token() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| anyhow::anyhow!("random: {e}"))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

pub fn hash_token(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The 6-digit code both screens show. Derived from both certificate fingerprints, so a swapped
/// QR code or a different phone using a leaked token shows a different code.
pub fn confirmation_code(server_fp: &str, client_fp: &str) -> String {
    let digest = Sha256::digest(format!("gbr-pair-v1:{server_fp}:{client_fp}").as_bytes());
    let n = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % 1_000_000;
    format!("{n:06}")
}

impl PendingPairing {
    pub fn create(paths: &Paths, now: i64) -> Result<(Self, String)> {
        let token = new_token()?;
        let pending = Self {
            token_sha256: hash_token(&token),
            expires_at: now + TOKEN_TTL_SECS,
            device: None,
        };
        pending.save(paths)?;
        Ok((pending, token))
    }

    pub fn load(paths: &Paths) -> Result<Option<Self>> {
        let path = paths.pairing();
        if !path.exists() {
            return Ok(None);
        }
        Ok(Some(serde_json::from_slice(&std::fs::read(path)?)?))
    }

    pub fn save(&self, paths: &Paths) -> Result<()> {
        write_private(&paths.pairing(), &serde_json::to_vec_pretty(self)?)
    }

    pub fn clear(paths: &Paths) -> Result<()> {
        let path = paths.pairing();
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }

    /// Called by the server when a phone presents a token. Burns the token on success.
    pub fn claim(
        &mut self,
        token: &str,
        name: &str,
        server_fp: &str,
        client_fp: &str,
        now: i64,
    ) -> Result<PendingDevice> {
        if now > self.expires_at {
            bail!("pairing code expired; run `gbr pair` again");
        }
        if self.device.is_some() {
            bail!("pairing code already used");
        }
        if hash_token(token) != self.token_sha256 {
            bail!("wrong pairing token");
        }
        let device = PendingDevice {
            name: name.chars().take(40).collect(),
            fingerprint: client_fp.to_string(),
            code: confirmation_code(server_fp, client_fp),
        };
        self.device = Some(device.clone());
        Ok(device)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths() -> (tempfile::TempDir, Paths) {
        let dir = tempfile::tempdir().unwrap();
        let p = Paths::at(dir.path().to_path_buf()).unwrap();
        (dir, p)
    }

    #[test]
    fn token_works_once() {
        let (_d, p) = paths();
        let (mut pending, token) = PendingPairing::create(&p, 1000).unwrap();
        let dev = pending.claim(&token, "Pixel", "s", "c", 1001).unwrap();
        assert_eq!(dev.code, confirmation_code("s", "c"));
        assert!(pending.claim(&token, "Pixel", "s", "c2", 1002).is_err());
    }

    #[test]
    fn token_expires() {
        let (_d, p) = paths();
        let (mut pending, token) = PendingPairing::create(&p, 1000).unwrap();
        assert!(pending
            .claim(&token, "P", "s", "c", 1000 + TOKEN_TTL_SECS + 1)
            .is_err());
    }

    #[test]
    fn wrong_token_rejected() {
        let (_d, p) = paths();
        let (mut pending, _token) = PendingPairing::create(&p, 1000).unwrap();
        assert!(pending.claim("nope", "P", "s", "c", 1001).is_err());
        assert!(pending.device.is_none());
    }

    #[test]
    fn code_is_six_digits_and_depends_on_both_keys() {
        let a = confirmation_code("server", "phone-a");
        let b = confirmation_code("server", "phone-b");
        assert_eq!(a.len(), 6);
        assert!(a.chars().all(|c| c.is_ascii_digit()));
        assert_ne!(a, b);
        // Fixed vector shared with the Android unit test (PairingCodeTest).
        assert_eq!(confirmation_code("aa", "bb"), "829775");
    }

    #[test]
    fn qr_payload_round_trips() {
        let q = QrPayload {
            gbr: 1,
            addr: "100.64.0.1:7443".into(),
            fp: "ab".into(),
            token: "t".into(),
        };
        let s = serde_json::to_string(&q).unwrap();
        assert_eq!(serde_json::from_str::<QrPayload>(&s).unwrap(), q);
    }
}
