//! Where the bridge keeps its state.
//!
//! Everything lives under `~/.config/gbr/` (override with `GBR_HOME`, used by tests).
//! The audit log goes to `~/Library/Logs/gbr/audit.log` on macOS.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

#[derive(Debug, Clone)]
pub struct Paths {
    pub home: PathBuf,
    audit: PathBuf,
}

impl Paths {
    pub fn resolve() -> Result<Self> {
        if let Some(dir) = std::env::var_os("GBR_HOME") {
            return Self::at(PathBuf::from(dir));
        }
        let user_home = dirs::home_dir().context("cannot find the home directory")?;
        let home = user_home.join(".config").join("gbr");
        let audit = if cfg!(target_os = "macos") {
            user_home.join("Library/Logs/gbr/audit.log")
        } else {
            home.join("audit.log")
        };
        let paths = Self { home, audit };
        paths.ensure_dirs()?;
        Ok(paths)
    }

    /// State rooted at `home`, audit log inside it. Used by tests and `GBR_HOME`.
    pub fn at(home: PathBuf) -> Result<Self> {
        let audit = home.join("audit.log");
        let paths = Self { home, audit };
        paths.ensure_dirs()?;
        Ok(paths)
    }

    fn ensure_dirs(&self) -> Result<()> {
        create_private_dir(&self.home)?;
        if let Some(parent) = self.audit.parent() {
            fs::create_dir_all(parent).with_context(|| format!("creating {}", parent.display()))?;
        }
        Ok(())
    }

    pub fn cert(&self) -> PathBuf {
        self.home.join("bridge-cert.der")
    }
    pub fn key(&self) -> PathBuf {
        self.home.join("bridge-key.der")
    }
    pub fn devices(&self) -> PathBuf {
        self.home.join("devices.json")
    }
    pub fn pairing(&self) -> PathBuf {
        self.home.join("pairing.json")
    }
    pub fn pid(&self) -> PathBuf {
        self.home.join("gbr.pid")
    }
    pub fn audit(&self) -> &Path {
        &self.audit
    }
}

fn create_private_dir(dir: &Path) -> Result<()> {
    fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Write a file readable only by the current user, atomically (write to a temp file, then rename).
pub fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("tmp");
    {
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts
            .open(&tmp)
            .with_context(|| format!("writing {}", tmp.display()))?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path).with_context(|| format!("renaming to {}", path.display()))?;
    Ok(())
}
