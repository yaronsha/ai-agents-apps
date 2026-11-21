//! Append-only audit log: who connected, attached, prompted, approved or was refused, and when.
//! It records events, not prompt text, unless the bridge runs with `--log-prompts`.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Audit {
    path: PathBuf,
    lock: Mutex<()>,
}

impl Audit {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
        }
    }

    pub fn log(&self, device: &str, event: &str, detail: &str) {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let line = format!(
            "{}\t{}\t{}\t{}\n",
            chrono::Utc::now().to_rfc3339(),
            sanitize(device),
            event,
            sanitize(detail)
        );
        let mut opts = OpenOptions::new();
        opts.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        match opts.open(&self.path) {
            Ok(mut f) => {
                let _ = f.write_all(line.as_bytes());
            }
            Err(e) => tracing::warn!("audit log {}: {e}", self.path.display()),
        }
    }
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c == '\t' || c == '\n' || c == '\r' {
                ' '
            } else {
                c
            }
        })
        .take(300)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_one_tab_separated_line_per_event() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("audit.log");
        let a = Audit::new(path.clone());
        a.log("Pixel", "attach", "session\tone\nline");
        a.log("Pixel", "detach", "x");
        let text = std::fs::read_to_string(path).unwrap();
        let lines: Vec<_> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].split('\t').count(), 4);
        assert!(lines[0].ends_with("session one line"));
    }
}
