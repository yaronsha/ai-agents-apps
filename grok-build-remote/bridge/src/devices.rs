//! Paired phones, stored in `devices.json` as pinned client-certificate fingerprints.

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

use crate::config::{write_private, Paths};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Device {
    pub name: String,
    pub fingerprint: String,
    pub added_at: String,
    #[serde(default)]
    pub revoked: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Devices {
    pub devices: Vec<Device>,
}

impl Devices {
    pub fn load(paths: &Paths) -> Result<Self> {
        let path = paths.devices();
        if !path.exists() {
            return Ok(Self::default());
        }
        Ok(serde_json::from_slice(&std::fs::read(path)?)?)
    }

    pub fn save(&self, paths: &Paths) -> Result<()> {
        write_private(&paths.devices(), &serde_json::to_vec_pretty(self)?)
    }

    /// The name of the active (paired, not revoked) device with this fingerprint.
    pub fn active_name(&self, fingerprint: &str) -> Option<&str> {
        self.devices
            .iter()
            .find(|d| !d.revoked && d.fingerprint == fingerprint)
            .map(|d| d.name.as_str())
    }

    pub fn add(&mut self, name: &str, fingerprint: &str) -> Result<()> {
        if self.active_name(fingerprint).is_some() {
            bail!("this phone is already paired");
        }
        let mut unique = name.trim().to_string();
        if unique.is_empty() {
            unique = "phone".into();
        }
        let base = unique.clone();
        let mut n = 2;
        while self.devices.iter().any(|d| !d.revoked && d.name == unique) {
            unique = format!("{base}-{n}");
            n += 1;
        }
        self.devices.push(Device {
            name: unique,
            fingerprint: fingerprint.to_string(),
            added_at: chrono::Utc::now().to_rfc3339(),
            revoked: false,
        });
        Ok(())
    }

    /// Revoke by name. Returns false if no active device has that name.
    pub fn revoke(&mut self, name: &str) -> bool {
        let mut found = false;
        for d in self
            .devices
            .iter_mut()
            .filter(|d| d.name == name && !d.revoked)
        {
            d.revoked = true;
            found = true;
        }
        found
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_revoke_and_lookup() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let mut d = Devices::load(&paths).unwrap();
        d.add("Pixel", "aa").unwrap();
        d.add("Pixel", "bb").unwrap();
        assert!(d.add("Again", "aa").is_err());
        d.save(&paths).unwrap();

        let mut d = Devices::load(&paths).unwrap();
        assert_eq!(d.active_name("aa"), Some("Pixel"));
        assert_eq!(d.active_name("bb"), Some("Pixel-2"));
        assert!(d.revoke("Pixel"));
        assert_eq!(d.active_name("aa"), None);
        assert!(!d.revoke("nobody"));
    }
}
