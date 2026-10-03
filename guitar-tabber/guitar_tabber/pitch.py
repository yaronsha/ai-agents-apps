"""Pitch and onset detection (librosa pyin / yin).

Notes are cut when the quantized pitch actually changes, and again when the
same pitch is plucked after the energy has fallen off and come back. A second
simultaneous pitch is not inferred here: pyin is monophonic, and a harmonic
peak is too easy to mistake for another fretted note.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import librosa
import numpy as np

from .fretboard import midi_from_hz

logger = logging.getLogger(__name__)

# A new MIDI value must hold this many frames before it closes the current
# note. One or two odd frames are tracker jitter, not a new fret.
_PITCH_HOLD_FRAMES = 3
# Ignore a re-attack this close to the start of the note (the note's own pick).
_MIN_FRAMES_BEFORE_REATTACK = 4


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
) -> list[DetectedNote]:
    """
    Monophonic pitch tracking via librosa.pyin, segmented into note events.

    A note stays on one MIDI pitch. Moving by a single semitone starts a new
    note once that pitch has held for a few frames, instead of being absorbed
    into a running median. The same pitch played again is also a new note when
    the level dips and a fresh onset arrives.

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
    midi, hz, conf = _frame_pitches(
        f0, voiced_flag, voiced_probs, confidence_threshold
    )
    rms = _aligned_rms(y, len(midi), frame_length=frame_length, hop_length=hop_length)
    onset_env = _aligned_onset(y, sr, len(midi), hop_length=hop_length)
    reattack = _reattack_candidates(rms, onset_env)

    hop_sec = float(hop_length) / float(sr) if sr else 0.0
    notes: list[DetectedNote] = []
    i = 0
    n = len(midi)
    while i < n:
        if midi[i] < 0:
            i += 1
            continue

        start = i
        locked = int(midi[i])
        end, next_i = _consume_note(
            midi, rms, reattack, start, locked
        )
        if end <= start:
            i = max(next_i, start + 1)
            continue

        if end < n:
            end_time = float(times[end])
        elif n >= 2:
            end_time = float(times[-1] + (times[-1] - times[-2]))
        else:
            end_time = float(times[start]) + hop_sec
        duration = end_time - float(times[start])
        nframes = end - start
        if duration < min_note_duration and nframes < 3:
            i = max(next_i, start + 1)
            continue

        chosen = midi[start:end] == locked
        if not np.any(chosen):
            i = max(next_i, start + 1)
            continue
        hz_final = float(np.median(hz[start:end][chosen]))
        conf_slice = conf[start:end][chosen]
        conf_final = float(np.mean(conf_slice)) if len(conf_slice) else 0.5
        notes.append(
            DetectedNote(
                time=float(times[start]),
                duration=float(max(duration, hop_sec)),
                hz=hz_final,
                midi=locked,
                confidence=conf_final,
            )
        )
        i = max(next_i, end)

    notes = _refine_with_onsets(y, sr, notes, hop_length=hop_length)
    notes = _shorten_same_pitch_overlaps(notes)
    logger.info("Detected %d note events", len(notes))
    return notes


def _frame_pitches(f0, voiced_flag, voiced_probs, confidence_threshold: float):
    """Per-frame MIDI, Hz, and confidence. MIDI is -1 when the frame is unvoiced."""
    n = len(f0)
    midi = np.full(n, -1, dtype=int)
    hz = np.zeros(n, dtype=float)
    conf = np.zeros(n, dtype=float)
    for i in range(n):
        if not bool(voiced_flag[i]):
            continue
        freq = f0[i]
        if freq is None or not np.isfinite(freq) or float(freq) <= 0:
            continue
        prob = voiced_probs[i]
        if prob is not None and np.isfinite(prob) and float(prob) < confidence_threshold:
            continue
        m = midi_from_hz(float(freq))
        if m is None:
            continue
        midi[i] = int(m)
        hz[i] = float(freq)
        conf[i] = float(prob) if prob is not None and np.isfinite(prob) else 0.5
    return midi, hz, conf


def _aligned_rms(y: np.ndarray, n_frames: int, frame_length: int, hop_length: int) -> np.ndarray:
    if n_frames <= 0 or len(y) == 0:
        return np.zeros(n_frames, dtype=float)
    rms = librosa.feature.rms(
        y=y, frame_length=frame_length, hop_length=hop_length, center=True
    )[0]
    return _fit_length(rms.astype(float), n_frames)


def _aligned_onset(y: np.ndarray, sr: int, n_frames: int, hop_length: int) -> np.ndarray:
    if n_frames <= 0 or len(y) == 0:
        return np.zeros(n_frames, dtype=float)
    try:
        onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length, center=True)
    except Exception as exc:
        logger.debug("Onset strength unavailable: %s", exc)
        return np.zeros(n_frames, dtype=float)
    return _fit_length(np.asarray(onset, dtype=float), n_frames)


def _fit_length(values: np.ndarray, n_frames: int) -> np.ndarray:
    if len(values) == n_frames:
        return values
    if len(values) > n_frames:
        return values[:n_frames]
    out = np.zeros(n_frames, dtype=float)
    out[: len(values)] = values
    return out


def _reattack_candidates(rms: np.ndarray, onset_env: np.ndarray) -> np.ndarray:
    """Frames where onset strength peaks hard enough to maybe be a new pluck."""
    n = min(len(rms), len(onset_env))
    mask = np.zeros(len(rms), dtype=bool)
    if n < 3:
        return mask
    peak = float(np.max(onset_env[:n])) if n else 0.0
    if peak <= 0:
        return mask
    # Relative to this clip so a quiet take and a hot take both work, with a
    # floor so a flat sustain's tiny flux ripples are not peaks.
    thresh = max(0.75, 0.28 * peak)
    for i in range(1, n - 1):
        if onset_env[i] < thresh:
            continue
        if onset_env[i] >= onset_env[i - 1] and onset_env[i] > onset_env[i + 1]:
            mask[i] = True
    return mask


def _consume_note(
    midi: np.ndarray,
    rms: np.ndarray,
    reattack: np.ndarray,
    start: int,
    locked: int,
) -> tuple[int, int]:
    """Return (end_frame_exclusive, index_to_resume_from)."""
    n = len(midi)
    j = start
    end = start
    pending_midi = -1
    pending_start = start
    pending_count = 0

    while j < n:
        if (
            j >= start + _MIN_FRAMES_BEFORE_REATTACK
            and reattack[j]
            and _energy_fell_then_rose(rms, start, j)
        ):
            return j, j

        m = int(midi[j])
        if m == locked:
            pending_midi = -1
            pending_count = 0
            end = j + 1
            j += 1
            continue

        if m < 0:
            # Bridge a single dead frame inside a still-loud note. A real rest
            # (or a run of unvoiced frames) ends the note.
            if (
                j + 1 < n
                and int(midi[j + 1]) == locked
                and _rms_still_present(rms, start, j)
            ):
                j += 1
                continue
            return j, j + 1

        if m != pending_midi:
            pending_midi = m
            pending_start = j
            pending_count = 1
        else:
            pending_count += 1
        if pending_count >= _PITCH_HOLD_FRAMES:
            # The new pitch has settled. Close this note where it began.
            return pending_start, pending_start
        j += 1

    return end, n


def _rms_still_present(rms: np.ndarray, start: int, j: int) -> bool:
    body = rms[start : j + 1]
    if len(body) == 0:
        return False
    peak = float(np.max(body))
    if peak <= 1e-8:
        return False
    return float(rms[j]) >= 0.40 * peak


def _energy_fell_then_rose(rms: np.ndarray, start: int, j: int) -> bool:
    """True when this onset follows a decay of the current note, not its own attack.

    The valley has to sit after the note's loudest earlier frame. A second hump
    during the same pick (onset strength often double-fires) never decays, so
    it does not count.
    """
    if j <= start + 1:
        return False
    body = rms[start:j]
    if len(body) < _MIN_FRAMES_BEFORE_REATTACK:
        return False
    peak_i = start + int(np.argmax(body))
    if peak_i >= j - 2:
        return False
    after_peak = rms[peak_i + 1 : j]
    if len(after_peak) == 0:
        return False
    valley = float(np.min(after_peak))
    peak = float(rms[peak_i])
    if peak <= 1e-8:
        return False
    # Must actually have gotten quieter, not just wiggled.
    if valley > 0.72 * peak:
        return False
    rise = float(np.max(rms[j : min(len(rms), j + 4)]))
    return rise >= 1.45 * max(valley, 1e-8)


def _shorten_same_pitch_overlaps(notes: list[DetectedNote]) -> list[DetectedNote]:
    """Keep two plucks of one pitch from overlapping after onset snapping.

    Overlap is what makes a later merge treat them as one held note.
    """
    if len(notes) < 2:
        return notes
    out = list(notes)
    for i in range(len(out) - 1):
        note = out[i]
        nxt = out[i + 1]
        if note.midi != nxt.midi:
            continue
        if nxt.time <= note.time:
            continue
        if note.time + note.duration > nxt.time:
            out[i] = DetectedNote(
                time=note.time,
                duration=float(nxt.time - note.time),
                hz=note.hz,
                midi=note.midi,
                confidence=note.confidence,
            )
    return out


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
    prev_midi: int | None = None
    prev_end = -1.0
    for note in notes:
        new_time = note.time
        diffs = np.abs(onset_times - note.time)
        j = int(np.argmin(diffs))
        if diffs[j] < 0.05:
            candidate = float(onset_times[j])
            # Don't drag a repeated pitch back into the note we just ended.
            pulled_into_prev = (
                prev_midi == note.midi and candidate < prev_end - 1e-3
            )
            if not pulled_into_prev:
                new_time = candidate
        refined.append(
            DetectedNote(
                time=new_time,
                duration=note.duration,
                hz=note.hz,
                midi=note.midi,
                confidence=note.confidence,
            )
        )
        prev_midi = note.midi
        prev_end = new_time + note.duration
    return refined


def merge_nearby_same_pitch(
    notes: list[DetectedNote], gap: float = 0.0
) -> list[DetectedNote]:
    """Merge consecutive same-MIDI notes only when they are the same sounding event.

    ``gap`` is extra silence (seconds) that may still be glued on. The default
    is 0, so a note that starts as the previous one ends — a fresh pluck of
    the same pitch — stays separate. Pass a positive gap to restore the old
    "join anything closer than this" behavior. Overlaps still merge, because
    those are two descriptions of one held note rather than a rest.
    """
    if not notes:
        return notes
    merged: list[DetectedNote] = [notes[0]]
    for note in notes[1:]:
        prev = merged[-1]
        touches_inside = note.time < (prev.time + prev.duration + gap) - 1e-4
        if note.midi == prev.midi and touches_inside:
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
