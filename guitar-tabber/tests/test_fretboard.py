"""Unit tests for sequence-level fret choice (no audio needed)."""

import sys
from pathlib import Path
from typing import NamedTuple

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from guitar_tabber.fretboard import OPEN_STRING_MIDI, map_sequence_to_frets  # noqa: E402
from guitar_tabber.tab import format_note_log, tab_fingerings  # noqa: E402

STRINGS = "EADGBe"


class Note(NamedTuple):
    """Stand-in for pitch.DetectedNote, which needs librosa to import."""

    time: float
    duration: float
    hz: float
    midi: int
    confidence: float


def midi(pos: str) -> int:
    """'A7' -> MIDI pitch of the A string at fret 7."""
    return OPEN_STRING_MIDI[STRINGS.index(pos[0])] + int(pos[1:])


def tab(frames, silences=None) -> list[str]:
    out = map_sequence_to_frets(frames, silences=silences)
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
    silences = [1.0 if i == 5 else 0.0 for i in range(len(line))]
    assert tab(melody(*line), silences=silences) == line


def test_slow_legato_run_stays_in_position():
    run = ["E5", "E8", "A5", "A7", "D5", "D7", "G5", "G7", "B5", "B8", "e5", "e8"]
    assert tab(melody(*run), silences=[0.0] * len(run)) == run


def test_stray_unplayable_pitch_does_not_pull_chord_out_of_position():
    def run(chord):
        return melody("D12", "D14", "G12") + [chord] + melody("B13", "B15")

    clean = tab(run([midi("D14"), midi("G14")]))
    with_stray = tab(run([38, midi("D14"), midi("G14")]))  # 38 is below low E
    assert with_stray == clean


def test_unplayable_frame_is_empty_and_does_not_break_the_rest():
    assert tab([[midi("e0")], [20], [midi("e3")]]) == ["e0", "", "e3"]


def test_silences_must_match_frames():
    with pytest.raises(ValueError):
        map_sequence_to_frets(melody("e0", "e3"), silences=[0.0])


def test_open_string_at_start_of_passage_stays_open():
    line = ["A0", "B3", "e0", "e3", "e5"]
    assert tab(melody(*line)) == line


def test_rest_before_open_string_still_frees_the_hand():
    line = ["e5", "e8", "B8", "B5", "G0", "B1", "B3", "G2", "B1"]
    silences = [1.0 if i == 4 else 0.0 for i in range(len(line))]
    assert tab(melody(*line), silences=silences) == line


def _notes(spec):
    return [Note(t, d, 0.0, m, 1.0) for t, d, m in spec]


def _names(positions):
    return [f"{STRINGS[p.string_index]}{p.fret}" for p in positions]


def test_tab_measures_rests_from_note_end_not_onset():
    # Slow legato quarter notes: onsets 0.6 s apart, but each note rings until the next
    run = ["E5", "E8", "A5", "A7", "D5", "D7", "G5", "G7", "B5", "B8", "e5", "e8"]
    notes = _notes([(0.6 * i, 0.6, midi(p)) for i, p in enumerate(run)])
    assert _names(tab_fingerings(notes)[1]) == run


def test_rest_before_several_open_strings_still_frees_the_hand():
    line = ["e12", "e15", "B15", "B12", "B0", "G0", "B1", "D2", "G2", "B3"]
    silences = [1.0 if i == 4 else 0.0 for i in range(len(line))]
    assert tab(melody(*line), silences=silences) == line


def test_held_fretted_note_is_not_a_rest():
    # Open phrase, then a 1 s gap in the melody, then a 5th-position lick.
    line = ["e0", "B3", "B1", "G2", "G0", "e5", "e8", "B8", "B5", "G7", "G5", "e5"]
    onsets = [0.25 + 0.25 * i + (1.0 if i >= 5 else 0.0) for i in range(len(line))]
    melody_notes = [(t, 0.2, midi(p)) for t, p in zip(onsets, line)]
    # Without anything held, the gap is a rest and the hand shifts there
    assert _names(tab_fingerings(_notes(melody_notes))[1]) == line

    # A fretted note held across the gap keeps the hand busy: no rest
    held = _notes(melody_notes[:5] + [(1.4, 1.5, midi("A2"))] + melody_notes[5:])
    expected = map_sequence_to_frets([[n.midi] for n in held], silences=[0.0] * len(held))
    assert tab_fingerings(held)[1] == [f[0] for f in expected]


def test_ringing_open_string_does_not_hide_a_rest():
    high = ["e12", "e15", "B15", "B12"]
    low = ["B1", "B3", "G2", "B1"]
    onsets = [0.25 * i + (1.0 if i >= 4 else 0.0) for i in range(8)]
    melody_notes = [(t + 0.25, 0.2, midi(p)) for t, p in zip(onsets, high + low)]
    notes = _notes([(0.0, 10.0, midi("E0"))] + melody_notes)
    assert _names(tab_fingerings(notes)[1]) == ["E0"] + high + low


def test_note_log_rejects_mismatched_positions():
    with pytest.raises(ValueError):
        format_note_log(_notes([(0.0, 0.5, midi("e0"))]), [])
