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
    split_cents: float = 60.0,
    glide_frames: int = 4,
) -> list[DetectedNote]:
    """
    Monophonic pitch tracking via librosa.pyin, segmented into note events.

    A note ends when the track goes unvoiced or when the pitch jumps more than
    ``split_cents`` away from the note's own pitch and holds there for
    ``pitch_change_frames`` frames, so half-step moves (E -> F, chromatic runs)
    become separate notes. The comparison is in cents against the note's
    median frequency (no rounding to semitones), so vibrato on a detuned string does not split it, and a
    change that glides there over ``glide_frames`` or more frames (a bend or
    slide) stays one note.

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

    notes: list[DetectedNote] = []
    i = 0
    n = len(f0)
    while i < n:
        if (
            voiced_flag[i]
            and f0[i] is not None
            and not np.isnan(f0[i])
            and (voiced_probs[i] is None or voiced_probs[i] >= confidence_threshold)
        ):
            start = i
            midi_vals: list[int] = []
            hz_vals: list[float] = []
            conf_vals: list[float] = []
            ref_hz: list[float] = []  # frames at the note's current (possibly bent) pitch
            bent = False
            while i < n and voiced_flag[i] and f0[i] is not None and not np.isnan(f0[i]):
                midi = midi_from_hz(float(f0[i]))
                if midi is None:
                    break
                ref = float(np.median(ref_hz)) if ref_hz else float(f0[i])
                if ref_hz and _holds_away(f0, voiced_flag, i, ref, split_cents, pitch_change_frames):
                    if _glide_len(f0, start, i, ref, split_cents) < glide_frames:
                        break  # a new note
                    # Bend or slide: same note, now tracking the target pitch
                    bent = True
                    ref_hz = []
                    ref = float(f0[i])
                if not bent:  # report a bent note at its fretted pitch
                    midi_vals.append(midi)
                    hz_vals.append(float(f0[i]))
                # Only frames near the reference move it, so a slow drift
                # toward the next note can't drag the reference along.
                if len(ref_hz) < 3 or abs(_cents(float(f0[i]), ref)) <= split_cents / 2:
                    ref_hz.append(float(f0[i]))
                conf_vals.append(float(voiced_probs[i]) if voiced_probs[i] is not None else 0.5)
                i += 1

            if not midi_vals:
                i += 1
                continue

            duration = times[min(i, n - 1)] - times[start]
            if duration < min_note_duration and (i - start) < 3:
                continue

            midi_final = int(np.round(np.median(midi_vals)))
            hz_final = float(np.median(hz_vals))
            conf_final = float(np.mean(conf_vals))
            notes.append(
                DetectedNote(
                    time=float(times[start]),
                    duration=float(duration),
                    hz=hz_final,
                    midi=midi_final,
                    confidence=conf_final,
                )
            )
        else:
            i += 1

    # Also snap notes to onset boundaries when onsets are available
    notes = _refine_with_onsets(y, sr, notes, hop_length=hop_length)
    logger.info("Detected %d note events", len(notes))
    return notes


def _cents(hz: float, ref_hz: float) -> float:
    return 1200.0 * float(np.log2(hz / ref_hz))


def _holds_away(
    f0: np.ndarray,
    voiced_flag: np.ndarray,
    i: int,
    ref_hz: float,
    split_cents: float,
    frames: int,
) -> bool:
    """True if frames i .. i+frames-1 are voiced and all > split_cents away from ref, same side."""
    if i + frames > len(f0):
        return False
    sign = 0.0
    for k in range(i, i + frames):
        if not voiced_flag[k] or np.isnan(f0[k]):
            return False
        c = _cents(float(f0[k]), ref_hz)
        if abs(c) <= split_cents or (sign and np.sign(c) != sign):
            return False
        sign = float(np.sign(c))
    return True


def _glide_len(
    f0: np.ndarray, start: int, i: int, ref_hz: float, split_cents: float
) -> int:
    """Frames just before i spent between the old pitch and the new one (a bend or slide)."""
    side = np.sign(_cents(float(f0[i]), ref_hz))
    k = i - 1
    while k >= start:
        c = _cents(float(f0[k]), ref_hz) * side
        if not (25.0 < c <= split_cents):
            break
        k -= 1
    return i - 1 - k


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
        if note.midi == prev.midi and note.time <= prev.time + prev.duration + gap:
            end = max(prev.time + prev.duration, note.time + note.duration)
            merged[-1] = DetectedNote(
                time=prev.time,
                duration=end - prev.time,
                hz=(prev.hz + note.hz) / 2,
                midi=prev.midi,
                confidence=max(prev.confidence, note.confidence),
            )
        else:
            merged.append(note)
    return merged
