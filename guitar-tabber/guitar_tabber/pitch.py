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
) -> list[DetectedNote]:
    """
    Monophonic pitch tracking via librosa.pyin, segmented into note events.

    Voiced runs are also split at detected onsets, so re-plucked notes of the
    same pitch stay separate even when pyin stays voiced across the attack.

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
    onsets = _onset_frames(y, sr, hop_length)
    onset_frames = set(int(f) for f in onsets)
    # Only split at an onset when both sides last at least this long: pyin can
    # turn voiced a frame or two before the onset detector fires, and a note's
    # release can register as a weak onset just before it goes unvoiced.
    min_note_frames = max(3, int(np.ceil(min_note_duration * sr / hop_length)))

    notes: list[DetectedNote] = []
    i = 0
    n = len(f0)
    voiced = ~np.isnan(f0) & np.asarray(voiced_flag, dtype=bool)
    confident = voiced & (np.nan_to_num(voiced_probs) >= confidence_threshold)
    prev_end = 0
    while i < n:
        if confident[i]:
            start = i
            midi_vals: list[int] = []
            hz_vals: list[float] = []
            conf_vals: list[float] = []
            while i < n and voiced[i]:
                # A new attack ends the current note (re-pluck of the same pitch)
                if (
                    i in onset_frames
                    and i - start >= min_note_frames
                    and i + min_note_frames <= n
                    and confident[i : i + min_note_frames].all()
                ):
                    break
                midi = midi_from_hz(float(f0[i]))
                if midi is None:
                    break
                # Continue segment while pitch stays within ~1 semitone of median so far
                if midi_vals:
                    med = int(np.median(midi_vals))
                    if abs(midi - med) > 1:
                        break
                midi_vals.append(midi)
                hz_vals.append(float(f0[i]))
                conf_vals.append(float(voiced_probs[i]))
                i += 1

            if not midi_vals:
                i += 1
                continue

            # pyin often drops out for a few frames at a re-pluck and the onset
            # lands in that gap, so count an onset shortly before the start too,
            # but not one before the previous kept note ended.
            lookback = max(prev_end, start - min_note_frames)
            attacked = any(f in onset_frames for f in range(lookback, start + min_note_frames))

            duration = times[min(i, n - 1)] - times[start]
            if duration < min_note_duration and (i - start) < 3:
                continue
            prev_end = i

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
                    from_onset=attacked,
                )
            )
        else:
            i += 1

    # Also snap notes to onset boundaries when onsets are available
    notes = _refine_with_onsets(
        notes, librosa.frames_to_time(onsets, sr=sr, hop_length=hop_length)
    )
    logger.info("Detected %d note events", len(notes))
    return notes


def _onset_frames(y: np.ndarray, sr: int, hop_length: int) -> np.ndarray:
    try:
        return librosa.onset.onset_detect(
            y=y, sr=sr, hop_length=hop_length, units="frames", backtrack=False
        )
    except Exception as exc:
        logger.debug("Onset detection skipped: %s", exc)
        return np.array([], dtype=int)


def _refine_with_onsets(
    notes: list[DetectedNote], onset_times: np.ndarray
) -> list[DetectedNote]:
    """Snap note start times toward nearby onsets (helps tab spacing)."""
    if not notes or len(onset_times) == 0:
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
    """Merge consecutive notes with the same MIDI if the gap is tiny.

    A note that starts at a detected onset is a re-pluck and is never merged.
    """
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
