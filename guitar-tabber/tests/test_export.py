"""Unit tests for JSON / MIDI export (no audio deps required beyond stdlib)."""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

# Allow importing the package without installing
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from guitar_tabber.export import (  # noqa: E402
    notes_to_midi_bytes,
    notes_to_tab_dict,
    write_midi,
    write_tab_json,
)
from guitar_tabber.pitch import DetectedNote  # noqa: E402


def _sample_notes() -> list[DetectedNote]:
    return [
        DetectedNote(time=0.16, duration=0.74, hz=109.9, midi=45, confidence=0.9),
        DetectedNote(time=1.07, duration=0.66, hz=219.9, midi=57, confidence=0.9),
        DetectedNote(time=1.86, duration=0.59, hz=146.8, midi=50, confidence=0.9),
    ]


def test_notes_to_tab_dict_schema():
    doc = notes_to_tab_dict(_sample_notes())
    assert doc["version"] == 1
    assert doc["tuning"] == ["E", "A", "D", "G", "B", "e"]
    assert len(doc["notes"]) == 3
    n0 = doc["notes"][0]
    assert n0["midi"] == 45
    assert n0["string"] == 1  # open A
    assert n0["fret"] == 0
    assert n0["t"] == 0.16


def test_write_tab_json_roundtrip(tmp_path: Path | None = None):
    out = (tmp_path or Path("/tmp")) / "sample.tab.json"
    if tmp_path is None:
        out = Path("/tmp/guitar_tabber_test_sample.tab.json")
    write_tab_json(_sample_notes(), out)
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["notes"][1]["fret"] == 2  # G string fret 2 = MIDI 57
    assert data["notes"][2]["string"] == 2  # open D


def test_midi_smf_header_and_notes():
    raw = notes_to_midi_bytes(_sample_notes())
    assert raw[:4] == b"MThd"
    # header length 6, format 0, 1 track
    length, fmt, ntrks, division = struct.unpack(">IHHH", raw[4:14])
    assert length == 6
    assert fmt == 0
    assert ntrks == 1
    assert division == 480
    assert b"MTrk" in raw
    # note_on status 0x90 should appear
    assert b"\x90" in raw or any(b in raw for b in (bytes([0x90]),))
    # At least some note data beyond header
    assert len(raw) > 40


def test_write_midi_file(tmp_path: Path | None = None):
    out = Path("/tmp/guitar_tabber_test_sample.mid")
    if tmp_path is not None:
        out = tmp_path / "sample.mid"
    write_midi(_sample_notes(), out)
    assert out.stat().st_size > 40
    assert out.read_bytes()[:4] == b"MThd"


if __name__ == "__main__":
    test_notes_to_tab_dict_schema()
    test_write_tab_json_roundtrip()
    test_midi_smf_header_and_notes()
    test_write_midi_file()
    print("all export tests passed")
