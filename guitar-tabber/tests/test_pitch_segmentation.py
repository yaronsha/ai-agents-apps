"""Segmentation tests on synthetic waveforms. No FluidSynth or soundfont."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from guitar_tabber.pitch import detect_notes, merge_nearby_same_pitch  # noqa: E402


SR = 22050


def _midi_hz(midi: int) -> float:
    return 440.0 * 2.0 ** ((midi - 69) / 12.0)


def _steady_tone(midi: int, duration: float, amp: float = 0.35) -> np.ndarray:
    """Flat sine with a short fade so the splice is a pitch change, not a click-only event."""
    n = int(round(duration * SR))
    t = np.arange(n) / SR
    env = np.ones(n, dtype=np.float64)
    fade = min(int(0.008 * SR), n // 4)
    if fade > 0:
        env[:fade] = np.linspace(0.0, 1.0, fade)
        env[-fade:] = np.linspace(1.0, 0.0, fade)
    wave = amp * env * np.sin(2.0 * np.pi * _midi_hz(midi) * t)
    return wave.astype(np.float32)


def _pluck(midi: int, duration: float, amp: float = 0.5) -> np.ndarray:
    n = int(round(duration * SR))
    t = np.arange(n) / SR
    env = np.exp(-6.0 * t)
    wave = amp * env * np.sin(2.0 * np.pi * _midi_hz(midi) * t)
    return wave.astype(np.float32)


def _notes_after_merge(y: np.ndarray):
    # Same order the pipeline uses.
    return merge_nearby_same_pitch(detect_notes(y, SR))


class PitchSegmentationTest(unittest.TestCase):
    def test_semitone_and_repluck_stay_separate(self):
        # E4 then F4, legato. One semitone must not collapse to a single E.
        legato = np.concatenate([_steady_tone(64, 0.30), _steady_tone(65, 0.30)])
        stepped = _notes_after_merge(legato)
        self.assertGreaterEqual(len(stepped), 2, [n.midi for n in stepped])
        self.assertEqual([n.midi for n in stepped], [64, 65])
        self.assertLess(stepped[0].time, stepped[1].time)

        # Two plucks of A3 with a short rest. Must not become one long note.
        gap = np.zeros(int(0.05 * SR), dtype=np.float32)
        plucked = np.concatenate([_pluck(57, 0.28), gap, _pluck(57, 0.28)])
        repeated = _notes_after_merge(plucked)
        self.assertGreaterEqual(len(repeated), 2, [(n.time, n.midi, n.duration) for n in repeated])
        self.assertTrue(all(n.midi == 57 for n in repeated))
        self.assertGreater(repeated[1].time, repeated[0].time + 0.12)

    def test_chromatic_walk_keeps_each_fret(self):
        # E F F# G. The old median window kept only every other pitch.
        walk = np.concatenate([_steady_tone(m, 0.22) for m in (64, 65, 66, 67)])
        notes = _notes_after_merge(walk)
        self.assertEqual([n.midi for n in notes], [64, 65, 66, 67])

    def test_merge_does_not_glue_a_rest_of_zero_length(self):
        from guitar_tabber.pitch import DetectedNote

        a = DetectedNote(time=0.0, duration=0.25, hz=220.0, midi=57, confidence=0.9)
        b = DetectedNote(time=0.25, duration=0.25, hz=220.0, midi=57, confidence=0.8)
        merged = merge_nearby_same_pitch([a, b])
        self.assertEqual(len(merged), 2)

        # A real overlap is still one note.
        c = DetectedNote(time=0.20, duration=0.25, hz=220.0, midi=57, confidence=0.8)
        overlapped = merge_nearby_same_pitch([a, c])
        self.assertEqual(len(overlapped), 1)
        self.assertAlmostEqual(overlapped[0].duration, 0.45, places=2)


if __name__ == "__main__":
    unittest.main()
