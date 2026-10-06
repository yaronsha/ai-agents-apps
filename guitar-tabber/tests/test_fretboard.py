"""Unit tests for sequence-level fret choice (no audio needed)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from guitar_tabber.fretboard import OPEN_STRING_MIDI, map_sequence_to_frets  # noqa: E402

STRINGS = "EADGBe"


def midi(pos: str) -> int:
    """'A7' -> MIDI pitch of the A string at fret 7."""
    return OPEN_STRING_MIDI[STRINGS.index(pos[0])] + int(pos[1:])


def tab(frames, onsets=None) -> list[str]:
    out = map_sequence_to_frets(frames, onsets=onsets)
    return ["+".join(f"{STRINGS[p.string_index]}{p.fret}" for p in f) for f in out]


def melody(*positions: str):
    return [[midi(p)] for p in positions]


def test_pentatonic_run_stays_in_fifth_position():
    run = ["E5", "E8", "A5", "A7", "D5", "D7", "G5", "G7", "B5", "B8", "e5", "e8"]
    assert tab(melody(*run)) == run


def test_open_position_melody_keeps_open_strings():
    line = ["e0", "e0", "e1", "e3", "e3", "e1", "e0", "B3", "B1", "B1", "B3"]
    assert tab(melody(*line)) == line


def test_fingerpicked_arpeggio_uses_open_strings_under_high_melody():
    # Spanish Romance: melody on e7 over open B and G
    line = ["e7", "B0", "G0"] * 3 + ["e5", "B0", "G0", "e3", "B0", "G0"]
    assert tab(melody(*line)) == line


def test_open_chord_shape():
    c_major = [midi(p) for p in ("A3", "D2", "G0", "B1", "e0")]
    assert tab([c_major]) == ["A3+D2+G0+B1+e0"]


def test_hand_shifts_position_after_a_rest():
    line = ["e0", "B3", "B1", "G2", "G0", "e5", "e8", "B8", "B5", "G7", "G5", "e5"]
    onsets = [0.25 * i + (1.0 if i >= 5 else 0.0) for i in range(len(line))]
    assert tab(melody(*line), onsets=onsets) == line


def test_unplayable_frame_is_empty_and_does_not_break_the_rest():
    assert tab([[midi("e0")], [20], [midi("e3")]]) == ["e0", "", "e3"]
