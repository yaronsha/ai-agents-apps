//! Per-session replay buffer. Every message the bridge sends to phones for a session gets the next
//! sequence number; a phone that reconnects says the last one it saw and gets only what it missed.

use std::collections::VecDeque;
use std::sync::Arc;

pub const DEFAULT_CAPACITY: usize = 5000;

#[derive(Debug)]
pub struct Replay {
    next_seq: u64,
    buf: VecDeque<(u64, Arc<str>)>,
    capacity: usize,
}

#[derive(Debug, PartialEq)]
pub enum Since {
    /// Everything after the given seq, in order (possibly empty).
    Complete(Vec<(u64, Arc<str>)>),
    /// Some messages after the given seq were already dropped; here is what is still kept.
    Gap(Vec<(u64, Arc<str>)>),
}

impl Replay {
    pub fn new(capacity: usize) -> Self {
        Self {
            next_seq: 1,
            buf: VecDeque::with_capacity(capacity.min(1024)),
            capacity: capacity.max(1),
        }
    }

    pub fn push(&mut self, msg: Arc<str>) -> u64 {
        let seq = self.next_seq;
        self.next_seq += 1;
        if self.buf.len() == self.capacity {
            self.buf.pop_front();
        }
        self.buf.push_back((seq, msg));
        seq
    }

    pub fn last_seq(&self) -> u64 {
        self.next_seq - 1
    }

    /// Messages with seq > `after`. `after = 0` means "from the start".
    pub fn since(&self, after: u64) -> Since {
        let items: Vec<_> = self
            .buf
            .iter()
            .filter(|(s, _)| *s > after)
            .cloned()
            .collect();
        let oldest = self.buf.front().map(|(s, _)| *s).unwrap_or(self.next_seq);
        if after + 1 < oldest {
            Since::Gap(items)
        } else {
            Since::Complete(items)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(s: &str) -> Arc<str> {
        Arc::from(s)
    }

    #[test]
    fn numbers_and_replays_from_a_cursor() {
        let mut r = Replay::new(10);
        for i in 0..5 {
            r.push(msg(&i.to_string()));
        }
        assert_eq!(r.last_seq(), 5);
        match r.since(3) {
            Since::Complete(v) => assert_eq!(v.iter().map(|(s, _)| *s).collect::<Vec<_>>(), [4, 5]),
            other => panic!("{other:?}"),
        }
        assert_eq!(r.since(5), Since::Complete(vec![]));
    }

    #[test]
    fn reports_a_gap_after_overflow() {
        let mut r = Replay::new(3);
        for i in 0..6 {
            r.push(msg(&i.to_string()));
        }
        // Kept: 4, 5, 6. A phone that saw 2 missed 3.
        match r.since(2) {
            Since::Gap(v) => assert_eq!(v.len(), 3),
            other => panic!("{other:?}"),
        }
        assert!(matches!(r.since(3), Since::Complete(v) if v.len() == 3));
        assert!(matches!(r.since(0), Since::Gap(_)));
    }

    #[test]
    fn empty_buffer_is_complete() {
        let r = Replay::new(3);
        assert_eq!(r.since(0), Since::Complete(vec![]));
    }
}
