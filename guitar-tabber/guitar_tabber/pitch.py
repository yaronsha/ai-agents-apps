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
    pitch_change_s: float = 0.035,
    split_cents: float = 60.0,
    glide_s: float = 0.045,
    jump_cents: float = 150.0,
) -> list[DetectedNote]:
    """
    Monophonic pitch tracking via librosa.pyin, segmented into note events.

    A note ends when the track goes unvoiced or when the pitch moves more than
    ``split_cents`` from the note's own pitch and stays there for
    ``pitch_change_s``, so half-step moves (E -> F, chromatic runs) become
    separate notes. Pitch is compared in cents, not rounded to semitones, so
    vibrato on a detuned string does not split a note. A change that glides
    through the in-between pitches for ``glide_s`` or longer is a bend or slide
    and stays one note. A jump past ``jump_cents`` splits after two frames, so
    short grace notes are kept.

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

    # Pitch in cents (MIDI * 100), NaN where unvoiced
    cents = 100.0 * librosa.hz_to_midi(np.where(voiced_flag, f0, np.nan))
    hold_frames = max(1, int(round(pitch_change_s * sr / hop_length)))
    glide_frames = max(1, int(round(glide_s * sr / hop_length)))

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
            ref_vals: list[float] = []  # cents of frames at the note's current (maybe bent) pitch
            bent = False
            while i < n and voiced_flag[i] and f0[i] is not None and not np.isnan(f0[i]):
                midi = midi_from_hz(float(f0[i]))
                if midi is None:
                    break
                ref = float(np.median(ref_vals)) if ref_vals else float(cents[i])
                if ref_vals and _holds_away(cents, i, ref, jump_cents, 2):
                    break  # big jump: a new note even if it is short
                if ref_vals and _holds_away(cents, i, ref, split_cents, hold_frames):
                    if _glide_len(cents, start, i, ref, split_cents) < glide_frames:
                        break  # a new note
                    # Bend or slide: same note, now tracking the target pitch
                    bent = True
                    ref_vals = []
                    ref = float(cents[i])
                if not bent:  # report a bent note at its fretted pitch
                    midi_vals.append(midi)
                    hz_vals.append(float(f0[i]))
                # Only frames near the reference move it, so a slow drift
                # toward the next note can't drag the reference along.
                if len(ref_vals) < 3 or abs(cents[i] - ref) <= split_cents / 2:
                    ref_vals.append(float(cents[i]))
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


def _holds_away(cents: np.ndarray, i: int, ref: float, min_cents: float, frames: int) -> bool:
    """True if frames i .. i+frames-1 are all more than min_cents from ref, on the same side.

    Near the end of the track a shorter run counts, so a last-moment change isn't lost.
    """
    window = cents[i : i + frames] - ref
    if np.isnan(window).any():
        return False
    return bool(np.all(window > min_cents) or np.all(window < -min_cents))


def _glide_len(cents: np.ndarray, start: int, i: int, ref: float, split_cents: float) -> int:
    """Frames just before i spent between the old pitch and the new one (a bend or slide)."""
    side = np.sign(cents[i] - ref)
    k = i - 1
    while k >= start and 25.0 < (cents[k] - ref) * side <= split_cents:
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
