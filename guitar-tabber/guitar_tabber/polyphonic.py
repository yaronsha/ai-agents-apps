"""Polyphonic note detection with Spotify's basic-pitch.

pyin (pitch.py) follows one pitch at a time, so chords and fingerpicked
patterns, where earlier strings keep ringing under new ones, come out mostly
missing. basic-pitch is a small neural transcriber that reports every note
sounding at once. Its raw output on guitar also contains overtone "ghost"
notes and re-triggers of strings that are still ringing; the filters below
remove those.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from .pitch import DetectedNote

logger = logging.getLogger(__name__)

# Overtones of a plucked string, in semitones above the fundamental
# (octave, octave + fifth, two octaves, two octaves + major third).
OVERTONE_INTERVALS = (12, 19, 24, 28)


@dataclass
class _Event:
    start: float
    end: float
    midi: int
    amp: float


def basic_pitch_available() -> bool:
    try:
        import basic_pitch  # noqa: F401
    except ImportError:
        return False
    return True


def detect_notes_polyphonic(
    wav_path: Path,
    *,
    onset_threshold: float = 0.5,
    frame_threshold: float = 0.3,
    min_note_ms: float = 58.0,
    fmin_hz: float = 75.0,
    fmax_hz: float = 1400.0,
) -> list[DetectedNote]:
    """Transcribe all simultaneous notes in ``wav_path``, sorted by time."""
    from basic_pitch.inference import predict

    logger.info("Running basic-pitch polyphonic transcription...")
    _, _, raw = predict(
        str(wav_path),
        onset_threshold=onset_threshold,
        frame_threshold=frame_threshold,
        minimum_note_length=min_note_ms,
        minimum_frequency=fmin_hz,
        maximum_frequency=fmax_hz,
    )
    events = [_Event(float(s), float(e), int(p), float(a)) for s, e, p, a, *_ in raw]
    kept = filter_guitar_artifacts(events)
    logger.info("basic-pitch: %d raw notes, %d after artifact filtering", len(events), len(kept))
    return [
        DetectedNote(
            time=ev.start,
            duration=ev.end - ev.start,
            hz=440.0 * 2 ** ((ev.midi - 69) / 12),
            midi=ev.midi,
            confidence=ev.amp,
            from_onset=True,
        )
        for ev in kept
    ]


def filter_guitar_artifacts(
    events: list[_Event],
    *,
    tol: float = 0.05,
    overtone_ratio: float = 1.1,
    sub_octave_ratio: float = 0.8,
    ringing_ratio: float = 0.9,
    min_amp: float = 0.4,
    short_note: float = 0.2,
) -> list[_Event]:
    """Drop overtone ghosts, re-triggered ringing strings and faint blips.

    Overtones are judged loudest-first against notes already accepted, so one
    ghost can't knock out a real note; ringing re-triggers are then judged
    against the surviving notes.
    """
    accepted: list[_Event] = []
    for ev in sorted(events, key=lambda ev: -ev.amp):
        if not _is_overtone(ev, accepted, tol, overtone_ratio, sub_octave_ratio):
            accepted.append(ev)
    accepted.sort(key=lambda ev: (ev.start, ev.midi))
    return [
        ev
        for ev in accepted
        if not _is_ringing_retrigger(ev, accepted, tol, ringing_ratio)
        and not (ev.amp < min_amp and ev.end - ev.start < short_note)
    ]


def _is_overtone(ev, events, tol, overtone_ratio, sub_octave_ratio) -> bool:
    for other in events:
        # Only notes already sounding when ``ev`` starts
        if other is ev or other.start > ev.start + tol or other.end <= ev.start:
            continue
        diff = ev.midi - other.midi
        if diff in OVERTONE_INTERVALS and ev.amp < overtone_ratio * other.amp:
            return True
        # Sub-octave ghost of a note attacked at the same moment
        if diff == -12 and abs(ev.start - other.start) <= tol and ev.amp < sub_octave_ratio * other.amp:
            return True
    return False


def _is_ringing_retrigger(ev, events, tol, ringing_ratio) -> bool:
    """A same-pitch note that just ended, restarted only because another string was plucked."""
    continues = any(
        o.midi == ev.midi and o.start < ev.start and abs(o.end - ev.start) <= tol for o in events
    )
    if not continues:
        return False
    return any(
        o.midi != ev.midi and abs(o.start - ev.start) <= tol and ev.amp < ringing_ratio * o.amp
        for o in events
    )
