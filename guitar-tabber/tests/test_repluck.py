"""Re-plucks of the same pitch must stay separate notes (issue #5)."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from generate_test_audio import synth_pluck  # noqa: E402
from guitar_tabber.pitch import detect_notes, merge_nearby_same_pitch  # noqa: E402

SR = 22050


def _melody(freqs: list[float], note_s: float) -> np.ndarray:
    lead = np.zeros(int(0.1 * SR), dtype=np.float32)
    return np.concatenate([lead] + [synth_pluck(f, note_s, SR) for f in freqs] + [lead])


def _midis(y: np.ndarray) -> list[int]:
    return [n.midi for n in merge_nearby_same_pitch(detect_notes(y, SR))]


def test_eighth_note_plucks_of_open_a_stay_separate():
    assert _midis(_melody([110.0] * 8, 0.25)) == [45] * 8


def test_ode_to_joy_repeated_e():
    e4, f4, g4 = 329.63, 349.23, 392.0
    assert _midis(_melody([e4, e4, f4, g4], 0.4)) == [64, 64, 65, 67]


def test_held_note_is_not_split():
    assert _midis(_melody([110.0], 1.2)) == [45]
