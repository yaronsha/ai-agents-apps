"""Pitch and onset detection (librosa pyin / yin)."""

from __future__ import annotations

import logging
from dataclasses import dataclass

import librosa
import numpy as np

from .fretboard import midi_from_hz

logger = logging.getLogger(__name__)


@dataclass
class DetectedNote:
    time: float  # seconds (onset / start)
    duration: float
    hz: float
    midi: int
    confidence: float
    from_onset: bool = False  # starts at a detected attack (never merged into the previous note)


def detect_notes(
    y: np.ndarray,
    sr: int,
    fmin_hz: float = 65.0,   # ~C2, below low E
    fmax_hz: float = 1200.0,  # ~D6-ish, covers high frets
    frame_length: int = 2048,
    hop_length: int = 256,
    min_note_duration: float = 0.08,
    confidence_threshold: float = 0.1,
    pitch_change_frames: int = 3,
) -> list[DetectedNote]:
    """
    Monophonic pitch tracking via librosa.pyin, segmented into note events.

    A note ends when the track goes unvoiced, when the rounded pitch moves to a
    different semitone for ``pitch_change_frames`` consecutive frames, or at a
    detected onset (so re-plucked notes of the same pitch stay separate).

    Returns a list of DetectedNote sorted by time.
    """
    logger.info("Running pyin pitch detection (sr=%d, len=%.2fs)...", sr, len(y) / sr)

    f0, voiced_flag, voiced_probs = librosa.pyin(
        y,
        fmin=fmin_hz,
        fmax=fmax_hz,
        sr=sr,
        frame_length=frame_length,
        hop_length=hop_length,
    )
    times = librosa.times_like(f0, sr=sr, hop_length=hop_length)
    n = len(f0)

    frame_midi: list[int | None] = []
    for i in range(n):
        ok = (
            voiced_flag[i]
            and not np.isnan(f0[i])
            and voiced_probs[i] >= confidence_threshold
        )
        frame_midi.append(midi_from_hz(float(f0[i])) if ok else None)

    onset_frames = set(_onset_frames(y, sr, hop_length))

    def emit(start: int, end: int, from_onset: bool) -> None:
        midis = [frame_midi[k] for k in range(start, end)]
        duration = (end - start) * hop_length / sr
        # Keep short notes that still span a few frames (grace notes, fast runs)
        if duration < min_note_duration and end - start < 3:
            return
        hz_vals = [float(f0[k]) for k in range(start, end)]
        notes.append(
            DetectedNote(
                time=float(times[start]),
                duration=float(duration),
                hz=float(np.median(hz_vals)),
                midi=int(np.round(np.median(midis))),
                confidence=float(np.mean(voiced_probs[start:end])),
                from_onset=from_onset,
            )
        )

    notes: list[DetectedNote] = []
    i = 0
    prev_end = 0
    while i < n:
        if frame_midi[i] is None:
            i += 1
            continue
        start = i
        cur = frame_midi[i]
        i += 1
        while i < n and frame_midi[i] is not None:
            if i in onset_frames:
                break
            if frame_midi[i] != cur:
                window = frame_midi[i : i + pitch_change_frames]
                if len(window) == pitch_change_frames and all(m == frame_midi[i] for m in window):
                    break
            i += 1
        # pyin often drops out for a few frames at a re-pluck and the onset lands
        # in that gap, so count any onset since the previous segment ended.
        attacked = any(f in onset_frames for f in range(prev_end, start + 2))
        emit(start, i, from_onset=attacked)
        prev_end = i

    # Also snap notes to onset boundaries when onsets are available
    notes = _refine_with_onsets(y, sr, notes, hop_length=hop_length)
    logger.info("Detected %d note events", len(notes))
    return notes


def _onset_frames(y: np.ndarray, sr: int, hop_length: int) -> np.ndarray:
    try:
        return librosa.onset.onset_detect(
            y=y, sr=sr, hop_length=hop_length, units="frames", backtrack=False
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("Onset detection skipped: %s", exc)
        return np.array([], dtype=int)


def _refine_with_onsets(
    y: np.ndarray,
    sr: int,
    notes: list[DetectedNote],
    hop_length: int = 256,
) -> list[DetectedNote]:
    """Optionally snap note start times toward nearby onsets (helps tab spacing)."""
    if not notes:
        return notes
    try:
        onset_frames = librosa.onset.onset_detect(
            y=y, sr=sr, hop_length=hop_length, units="frames"
        )
        onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop_length)
    except Exception as exc:
        logger.debug("Onset detection skipped: %s", exc)
        return notes

    if len(onset_times) == 0:
        return notes

    refined: list[DetectedNote] = []
    for note in notes:
        # Snap to nearest onset within 50 ms
        diffs = np.abs(onset_times - note.time)
        j = int(np.argmin(diffs))
        if diffs[j] < 0.05:
            note = DetectedNote(
                time=float(onset_times[j]),
                duration=note.duration,
                hz=note.hz,
                midi=note.midi,
                confidence=note.confidence,
                from_onset=note.from_onset,
            )
        refined.append(note)
    return refined


def merge_nearby_same_pitch(
    notes: list[DetectedNote], gap: float = 0.05
) -> list[DetectedNote]:
    """Merge consecutive notes with the same MIDI if the gap is tiny."""
    if not notes:
        return notes
    merged: list[DetectedNote] = [notes[0]]
    for note in notes[1:]:
        prev = merged[-1]
        if (
            note.midi == prev.midi
            and not note.from_onset
            and note.time <= prev.time + prev.duration + gap
        ):
            end = max(prev.time + prev.duration, note.time + note.duration)
            merged[-1] = DetectedNote(
                time=prev.time,
                duration=end - prev.time,
                hz=(prev.hz + note.hz) / 2,
                midi=prev.midi,
                confidence=max(prev.confidence, note.confidence),
                from_onset=prev.from_onset,
            )
        else:
            merged.append(note)
    return merged
