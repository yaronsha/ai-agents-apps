"""Half-step moves must come out as separate notes (issue #4)."""

import numpy as np

from guitar_tabber.pitch import detect_notes

SR = 22050


def _melody(midis: list[int], note_s: float = 0.35) -> np.ndarray:
    """Legato plucked-string-like tones (harmonics + decay), no gaps between notes."""
    t = np.arange(int(note_s * SR)) / SR
    env = np.exp(-3.0 * t)
    out = []
    for m in midis:
        hz = 440.0 * 2 ** ((m - 69) / 12)
        tone = sum(np.sin(2 * np.pi * hz * k * t) / k for k in range(1, 5))
        out.append(env * tone)
    y = np.concatenate(out)
    return (0.3 * y / np.max(np.abs(y))).astype(np.float32)


def _detected(midis: list[int]) -> list[int]:
    return [n.midi for n in detect_notes(_melody(midis), SR)]


def test_half_step_up_and_down():
    # E F G F E (Ode to Joy fragment): the F's used to be swallowed by the E's
    assert _detected([64, 65, 67, 65, 64]) == [64, 65, 67, 65, 64]


def test_chromatic_walk_on_a_string():
    # A0 A1 A2 A3 A4 A5 used to come out as A0 A3
    walk = [45, 46, 47, 48, 49, 50]
    assert _detected(walk) == walk
