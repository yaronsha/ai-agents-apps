"""Export detected notes to structured JSON and standard MIDI (SMF)."""

from __future__ import annotations

import json
import struct
from pathlib import Path
from typing import Any

from .fretboard import STRING_NAMES, map_midi_to_fret
from .pitch import DetectedNote

SCHEMA_VERSION = 1
# MIDI ticks per quarter note; we treat 1 second = 2 beats at 120 BPM → 960 ticks/sec
TICKS_PER_QUARTER = 480
DEFAULT_TEMPO_BPM = 120.0  # 500_000 µs per quarter → 960 ticks/sec


def notes_to_tab_dict(notes: list[DetectedNote]) -> dict[str, Any]:
    """Build the viewer JSON document from detected notes."""
    out_notes: list[dict[str, Any]] = []
    for n in notes:
        pos = map_midi_to_fret(n.midi)
        if pos is None:
            continue
        out_notes.append(
            {
                "t": round(n.time, 4),
                "dur": round(max(n.duration, 0.05), 4),
                "midi": int(n.midi),
                "string": int(pos.string_index),
                "fret": int(pos.fret),
                "hz": round(float(n.hz), 1),
            }
        )
    return {
        "version": SCHEMA_VERSION,
        "tuning": list(STRING_NAMES),
        "notes": out_notes,
    }


def write_tab_json(notes: list[DetectedNote], path: Path) -> Path:
    """Write ``<stem>.tab.json`` for the browser viewer."""
    path = Path(path)
    path.write_text(
        json.dumps(notes_to_tab_dict(notes), indent=2) + "\n",
        encoding="utf-8",
    )
    return path


def _encode_vlq(value: int) -> bytes:
    """MIDI variable-length quantity."""
    value = max(0, int(value))
    buffer = value & 0x7F
    out = bytearray()
    while value >> 7:
        value >>= 7
        buffer <<= 8
        buffer |= (value & 0x7F) | 0x80
    while True:
        out.append(buffer & 0xFF)
        if buffer & 0x80:
            buffer >>= 8
        else:
            break
    return bytes(out)


def _seconds_to_ticks(seconds: float, tempo_bpm: float = DEFAULT_TEMPO_BPM) -> int:
    """Convert seconds to MIDI ticks at the given tempo."""
    ticks_per_second = (TICKS_PER_QUARTER * tempo_bpm) / 60.0
    return max(0, int(round(seconds * ticks_per_second)))


def notes_to_midi_bytes(
    notes: list[DetectedNote],
    *,
    tempo_bpm: float = DEFAULT_TEMPO_BPM,
    velocity: int = 80,
    channel: int = 0,
) -> bytes:
    """
    Build a Type-0 Standard MIDI File (one track) from detected notes.

    Pure Python — no external MIDI library required.
    """
    # Collect note_on / note_off events as (tick, priority, status, data...)
    # priority: note_off (0) before note_on (1) at the same tick
    events: list[tuple[int, int, int, bytes]] = []
    for n in notes:
        start = _seconds_to_ticks(n.time, tempo_bpm)
        end = _seconds_to_ticks(n.time + max(n.duration, 0.05), tempo_bpm)
        if end <= start:
            end = start + 1
        midi = max(0, min(127, int(n.midi)))
        vel = max(1, min(127, velocity))
        events.append((start, 1, 0x90 | (channel & 0x0F), bytes([midi, vel])))
        events.append((end, 0, 0x80 | (channel & 0x0F), bytes([midi, 0])))

    events.sort(key=lambda e: (e[0], e[1]))

    # Tempo meta: microseconds per quarter note
    us_per_quarter = int(round(60_000_000 / tempo_bpm))
    track = bytearray()
    # delta 0, meta tempo
    track += _encode_vlq(0)
    track += bytes([0xFF, 0x51, 0x03])
    track += struct.pack(">I", us_per_quarter)[1:]  # 3 bytes
    # Program change → Acoustic Guitar (nylon) = 24
    track += _encode_vlq(0)
    track += bytes([0xC0 | (channel & 0x0F), 24])

    last_tick = 0
    for tick, _prio, status, data in events:
        delta = tick - last_tick
        last_tick = tick
        track += _encode_vlq(delta)
        track += bytes([status]) + data

    # End of track
    track += _encode_vlq(0)
    track += bytes([0xFF, 0x2F, 0x00])

    header = b"MThd" + struct.pack(">IHHH", 6, 0, 1, TICKS_PER_QUARTER)
    track_chunk = b"MTrk" + struct.pack(">I", len(track)) + bytes(track)
    return header + track_chunk


def write_midi(notes: list[DetectedNote], path: Path) -> Path:
    """Write ``<stem>.mid`` Standard MIDI File."""
    path = Path(path)
    path.write_bytes(notes_to_midi_bytes(notes))
    return path
