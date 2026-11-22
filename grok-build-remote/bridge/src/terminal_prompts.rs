//! Prompts typed in a Grok window, for the phone.
//!
//! The Grok Build leader streams a turn's output to every client following the session, but not
//! the prompt that started it: a prompt typed in the terminal never reaches the phone live. Grok
//! does save each prompt in the session's `chat_history.jsonl`, so the bridge reads new prompts
//! from there and sends them on as ACP `user_message_chunk` updates.
//!
//! That file is internal to Grok Build and may change in an update. If it can't be found or
//! read, nothing is sent and the phone simply doesn't show the terminal's prompts.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

/// Where Grok Build keeps its data: `$GROK_HOME`, or `~/.grok`.
pub fn grok_home() -> Option<PathBuf> {
    std::env::var_os("GROK_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".grok")))
}

/// `<grok home>/sessions/<encoded cwd>/<sid>/chat_history.jsonl`, found without having to know
/// how Grok encodes the folder name.
pub fn history_file(grok_home: &Path, sid: &str) -> Option<PathBuf> {
    std::fs::read_dir(grok_home.join("sessions"))
        .ok()?
        .flatten()
        .map(|dir| dir.path().join(sid).join("chat_history.jsonl"))
        .find(|p| p.is_file())
}

/// The text of a prompt someone typed, from one line of `chat_history.jsonl`. `None` for
/// everything else: Grok's own reminders (`synthetic_reason`), replies, tool results.
pub fn prompt_text(line: &str) -> Option<String> {
    let entry: Value = serde_json::from_str(line).ok()?;
    if entry.get("type").and_then(Value::as_str) != Some("user")
        || entry.get("prompt_index").is_none()
        || entry.get("synthetic_reason").is_some()
    {
        return None;
    }
    let text: String = entry
        .get("content")?
        .as_array()?
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n");
    let inner = match (text.find("<user_query>"), text.rfind("</user_query>")) {
        (Some(start), Some(end)) if start < end => &text[start + "<user_query>".len()..end],
        _ => text.as_str(),
    };
    let inner = inner.trim();
    (!inner.is_empty()).then(|| inner.to_string())
}

/// The ACP update the phone shows as a user message.
pub fn user_message(sid: &str, text: &str) -> Value {
    let content = json!({"type": "text", "text": text});
    let update = json!({"sessionUpdate": "user_message_chunk", "content": content});
    json!({"jsonrpc": "2.0", "method": "session/update",
        "params": {"sessionId": sid, "update": update}})
}

/// Follows one session's `chat_history.jsonl` and turns new prompts into ACP updates.
pub struct PromptWatcher {
    grok_home: PathBuf,
    sid: String,
    /// Skip what's already in the file when it's first found (its history was already replayed).
    skip_existing: bool,
    path: Option<PathBuf>,
    offset: u64,
    partial: Vec<u8>,
}

impl PromptWatcher {
    pub fn new(grok_home: PathBuf, sid: &str, skip_existing: bool) -> Self {
        let mut w = Self {
            grok_home,
            sid: sid.to_string(),
            skip_existing,
            path: None,
            offset: 0,
            partial: Vec::new(),
        };
        w.find();
        w
    }

    fn find(&mut self) {
        if self.path.is_some() {
            return;
        }
        if let Some(p) = history_file(&self.grok_home, &self.sid) {
            self.offset = if self.skip_existing {
                std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0)
            } else {
                0
            };
            self.path = Some(p);
        }
    }

    /// New prompts since the last call, as ACP `user_message_chunk` updates.
    pub fn poll(&mut self) -> Vec<Value> {
        self.find();
        let Some(path) = &self.path else {
            return Vec::new();
        };
        let Ok(mut file) = File::open(path) else {
            return Vec::new();
        };
        let len = file.metadata().map(|m| m.len()).unwrap_or(0);
        if len < self.offset {
            // Rewritten (rewind or compaction): start following from its new end.
            self.offset = len;
            self.partial.clear();
            return Vec::new();
        }
        if len == self.offset || file.seek(SeekFrom::Start(self.offset)).is_err() {
            return Vec::new();
        }
        let mut added = Vec::new();
        if file.read_to_end(&mut added).is_err() {
            return Vec::new();
        }
        self.offset += added.len() as u64;
        self.partial.extend_from_slice(&added);
        // Only complete lines; a line still being written waits for the next poll.
        let Some(last_newline) = self.partial.iter().rposition(|&b| b == b'\n') else {
            return Vec::new();
        };
        let complete: Vec<u8> = self.partial.drain(..=last_newline).collect();
        String::from_utf8_lossy(&complete)
            .lines()
            .filter_map(prompt_text)
            .map(|text| user_message(&self.sid, &text))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const PROMPT: &str = r#"{"type":"user","content":[{"type":"text","text":"<user_query>\nShow me the shelf\n</user_query>"}],"prompt_index":1}"#;
    const REMINDER: &str = r#"{"type":"user","content":[{"type":"text","text":"<system-reminder>\nMCP servers connected\n</system-reminder>"}],"synthetic_reason":"system_reminder"}"#;
    const REPLY: &str = r#"{"type":"assistant","content":"Sure"}"#;

    #[test]
    fn reads_only_typed_prompts() {
        assert_eq!(prompt_text(PROMPT).as_deref(), Some("Show me the shelf"));
        assert_eq!(prompt_text(REMINDER), None);
        assert_eq!(prompt_text(REPLY), None);
        assert_eq!(prompt_text("not json"), None);
    }

    fn session_dir(home: &Path, sid: &str) -> PathBuf {
        let dir = home.join("sessions").join("%2Fproject").join(sid);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("chat_history.jsonl")
    }

    fn append(path: &Path, text: &str) {
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .unwrap();
        f.write_all(text.as_bytes()).unwrap();
    }

    fn texts(updates: Vec<Value>) -> Vec<Value> {
        updates
            .into_iter()
            .map(|u| u["params"]["update"]["content"]["text"].clone())
            .collect()
    }

    #[test]
    fn follows_new_prompts_only() {
        let home = tempfile::tempdir().unwrap();
        let file = session_dir(home.path(), "s1");
        append(&file, &format!("{PROMPT}\n{REPLY}\n"));

        // Attached to an existing session: its history was replayed already.
        let mut w = PromptWatcher::new(home.path().to_path_buf(), "s1", true);
        assert!(w.poll().is_empty());

        append(&file, &format!("{REMINDER}\n"));
        assert!(w.poll().is_empty());

        // A line still being written waits until it's complete.
        let next = PROMPT.replace("Show me the shelf", "Now the poster");
        let (head, tail) = next.split_at(20);
        append(&file, head);
        assert!(w.poll().is_empty());
        append(&file, &format!("{tail}\n"));
        let updates = w.poll();
        assert_eq!(updates[0]["params"]["sessionId"], "s1");
        assert_eq!(
            updates[0]["params"]["update"]["sessionUpdate"],
            "user_message_chunk"
        );
        assert_eq!(texts(updates), ["Now the poster"]);
        assert!(w.poll().is_empty());
    }

    #[test]
    fn new_session_reads_from_the_start_once_the_file_exists() {
        let home = tempfile::tempdir().unwrap();
        let mut w = PromptWatcher::new(home.path().to_path_buf(), "s2", false);
        assert!(w.poll().is_empty());
        let file = session_dir(home.path(), "s2");
        append(&file, &format!("{PROMPT}\n"));
        assert_eq!(texts(w.poll()), ["Show me the shelf"]);
    }

    #[test]
    fn a_rewritten_file_is_followed_from_its_new_end() {
        let home = tempfile::tempdir().unwrap();
        let file = session_dir(home.path(), "s3");
        append(&file, &format!("{PROMPT}\n{PROMPT}\n"));
        let mut w = PromptWatcher::new(home.path().to_path_buf(), "s3", true);
        std::fs::write(&file, format!("{REPLY}\n")).unwrap();
        assert!(w.poll().is_empty());
        append(&file, &format!("{PROMPT}\n"));
        assert_eq!(texts(w.poll()), ["Show me the shelf"]);
    }
}
