"""Low-register steel-guitar notes (issue #7).

steel_low_register.wav is A2 C3 D3 E3 G3 A3 C4 D4 (eighths at 100 bpm),
rendered with FluidSynth from the FluidR3_GM "Acoustic Guitar (steel)"
preset (MIT licensed). pyin alone marks most of A2-E3 unvoiced on it.

    python -m unittest tests.test_low_register
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from guitar_tabber.audio import load_audio  # noqa: E402
from guitar_tabber.pitch import detect_notes, merge_nearby_same_pitch  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "steel_low_register.wav"
EXPECTED = [45, 48, 50, 52, 55, 57, 60, 62]
ONSETS = [0.1 + 0.3 * k for k in range(len(EXPECTED))]


class LowRegisterSteelTest(unittest.TestCase):
    def test_every_note_found_at_its_onset(self):
        y, sr = load_audio(FIXTURE, sample_rate=22050)
        notes = merge_nearby_same_pitch(detect_notes(y, sr))
        for onset, midi in zip(ONSETS, EXPECTED):
            near = [n.midi for n in notes if abs(n.time - onset) < 0.06]
            self.assertIn(midi, near, f"MIDI {midi} at {onset:.2f}s; got {near}")
        # No sub-octave ghosts near pyin's fmin
        self.assertFalse([n for n in notes if n.midi < 44], notes)


if __name__ == "__main__":
    unittest.main()
