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
