"""Unit tests for basic-pitch artifact filtering (no model or audio needed)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from guitar_tabber.polyphonic import _Event, filter_guitar_artifacts  # noqa: E402


def midis(events):
    return [(round(ev.start, 2), ev.midi) for ev in events]


def test_overtone_starting_with_fundamental_is_dropped():
    bass = _Event(0.0, 2.0, 45, 0.6)
    octave_ghost = _Event(0.01, 0.4, 57, 0.45)
    assert midis(filter_guitar_artifacts([bass, octave_ghost])) == [(0.0, 45)]


def test_note_picked_over_ringing_bass_is_kept():
    bass = _Event(0.0, 2.0, 45, 0.6)
    high_e = _Event(0.5, 0.9, 64, 0.5)  # 19 semitones above the bass
    a3 = _Event(1.0, 1.4, 57, 0.5)  # an octave above the bass
    assert midis(filter_guitar_artifacts([bass, high_e, a3])) == [(0.0, 45), (0.5, 64), (1.0, 57)]


def test_ringing_string_retriggered_by_other_attack_is_dropped():
    first = _Event(0.0, 0.5, 64, 0.8)
    retrigger = _Event(0.5, 1.0, 64, 0.5)
    new_note = _Event(0.5, 1.0, 65, 0.8)
    assert midis(filter_guitar_artifacts([first, retrigger, new_note])) == [(0.0, 64), (0.5, 65)]


def test_strummed_chord_keeps_octaves_and_fifths():
    # Open E major, strummed: E3, B3 and E4 sit 12/19/24 above the low E and ring as long
    chord = [_Event(0.0 + i * 0.01, 0.7, m, a) for i, (m, a) in enumerate(
        [(40, 0.6), (47, 0.6), (52, 0.6), (56, 0.7), (59, 0.45), (64, 0.45)]
    )]
    assert [m for _, m in midis(filter_guitar_artifacts(chord))] == [40, 47, 52, 56, 59, 64]


def test_strummed_chord_still_drops_short_overtone_ghost():
    chord = [_Event(0.0, 0.7, m, 0.6) for m in (45, 52, 57, 60)]
    ghost = _Event(0.02, 0.15, 72, 0.4)  # an octave above C4, dies out quickly
    assert 72 not in [m for _, m in midis(filter_guitar_artifacts(chord + [ghost]))]


def test_restrummed_chord_keeps_all_tones():
    am = [(45, 0.6), (52, 0.75), (57, 0.5), (60, 0.55), (64, 0.45)]
    first = [_Event(0.0, 0.66, m, a) for m, a in am]
    second = [_Event(0.66, 1.3, m, a) for m, a in am]
    kept = midis(filter_guitar_artifacts(first + second))
    assert sorted(m for t, m in kept if t == 0.66) == [45, 52, 57, 60, 64]
