"""MIDI export (detected notes → .mid) and import (.mid → notes)."""

from __future__ import annotations

import logging
from pathlib import Path

import mido

from .pitch import DetectedNote

logger = logging.getLogger(__name__)

TICKS_PER_BEAT = 480
DEFAULT_TEMPO_BPM = 120.0
GUITAR_PROGRAM = 25  # General MIDI "Acoustic Guitar (steel)" (0-based)
MIDI_EXTENSIONS = {".mid", ".midi"}


def estimate_tempo(y, sr: int) -> tuple[float, float]:
    """
    Estimate (bpm, first_beat_seconds) with librosa's beat tracker.

    Falls back to 120 bpm / 0 s when no beats are found.
    """
    import librosa
    import numpy as np

    try:
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        bpm = float(np.atleast_1d(tempo)[0])
        beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    except Exception as exc:  # pragma: no cover - librosa edge cases
        logger.debug("Tempo estimation failed: %s", exc)
        return DEFAULT_TEMPO_BPM, 0.0
    if not np.isfinite(bpm) or bpm <= 0:
        return DEFAULT_TEMPO_BPM, 0.0
    # Keep tempo in a readable range for notation (fold half/double time)
    while bpm < 60:
        bpm *= 2
    while bpm > 200:
        bpm /= 2
    first_beat = float(beat_times[0]) if len(beat_times) else 0.0
    return bpm, first_beat


def notes_to_midi(
    notes: list[DetectedNote],
    path: Path,
    *,
    tempo_bpm: float = DEFAULT_TEMPO_BPM,
    beat_offset: float = 0.0,
    title: str | None = None,
) -> Path:
    """
    Write detected notes as a single-track guitar MIDI file.

    ``beat_offset`` (seconds) is a known beat position; the grid is shifted so
    it lands on a beat, which makes the browser view's bar lines line up.
    """
    path = Path(path)
    seconds_per_beat = 60.0 / tempo_bpm
    # Shift so a detected beat sits on a whole beat in the file
    shift = beat_offset % seconds_per_beat
    if shift > 1e-3:
        shift = shift - seconds_per_beat  # pad with a short pickup instead of cutting

    def to_tick(seconds: float) -> int:
        return max(0, int(round((seconds - shift) / seconds_per_beat * TICKS_PER_BEAT)))

    events: list[tuple[int, int, mido.Message]] = []
    for n in notes:
        start = to_tick(n.time)
        end = max(start + 1, to_tick(n.time + n.duration))
        velocity = max(40, min(127, int(60 + 60 * n.confidence)))
        # Sort key: note_off before note_on at the same tick
        events.append((start, 1, mido.Message("note_on", note=n.midi, velocity=velocity, channel=0)))
        events.append((end, 0, mido.Message("note_off", note=n.midi, velocity=0, channel=0)))
    events.sort(key=lambda e: (e[0], e[1]))

    track = mido.MidiTrack()
    track.append(mido.MetaMessage("track_name", name=title or "Guitar", time=0))
    track.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(tempo_bpm), time=0))
    track.append(mido.MetaMessage("time_signature", numerator=4, denominator=4, time=0))
    track.append(mido.Message("program_change", program=GUITAR_PROGRAM, channel=0, time=0))
    last = 0
    for tick, _, msg in events:
        track.append(msg.copy(time=tick - last))
        last = tick
    track.append(mido.MetaMessage("end_of_track", time=0))

    mid = mido.MidiFile(type=0, ticks_per_beat=TICKS_PER_BEAT)
    mid.tracks.append(track)
    mid.save(path)
    logger.info("Wrote MIDI to %s (%.1f bpm)", path, tempo_bpm)
    return path


def midi_to_notes(path: Path) -> list[DetectedNote]:
    """
    Read note events from a MIDI file (all tracks, drums excluded).

    Times are in seconds (tempo map applied by mido).
    """
    mid = mido.MidiFile(str(path))
    now = 0.0
    active: dict[tuple[int, int], tuple[float, int]] = {}
    notes: list[DetectedNote] = []
    for msg in mid:  # merged tracks, msg.time in seconds
        now += msg.time
        if msg.type not in ("note_on", "note_off") or msg.channel == 9:
            continue
        key = (msg.channel, msg.note)
        if msg.type == "note_on" and msg.velocity > 0:
            if key in active:  # retrigger: close the previous one
                start, vel = active.pop(key)
                notes.append(_note(start, now, msg.note, vel))
            active[key] = (now, msg.velocity)
        elif key in active:
            start, vel = active.pop(key)
            notes.append(_note(start, now, msg.note, vel))
    for (_, pitch), (start, vel) in active.items():
        notes.append(_note(start, now, pitch, vel))
    notes.sort(key=lambda n: (n.time, n.midi))
    return notes


def _note(start: float, end: float, pitch: int, velocity: int) -> DetectedNote:
    return DetectedNote(
        time=start,
        duration=max(0.0, end - start),
        hz=440.0 * 2 ** ((pitch - 69) / 12),
        midi=pitch,
        confidence=velocity / 127,
    )
