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
    # A-string frets 0..5 (A2..D3) used to come out as two notes
    walk = [45, 46, 47, 48, 49, 50]
    assert _detected(walk) == walk


def _glide_tone(hz_curve: np.ndarray) -> np.ndarray:
    """One plucked tone whose frequency follows hz_curve (per sample)."""
    t = np.arange(len(hz_curve)) / SR
    phase = 2 * np.pi * np.cumsum(hz_curve) / SR
    y = np.exp(-1.5 * t) * sum(np.sin(k * phase) / k for k in range(1, 5))
    return (0.3 * y / np.max(np.abs(y))).astype(np.float32)


def test_vibrato_on_detuned_string_stays_one_note():
    # E4 tuned 45 cents sharp with +-20 cent vibrato straddles the E/F rounding boundary
    t = np.arange(SR) / SR
    cents = 45 + 20 * np.sin(2 * np.pi * 5.5 * t)
    y = _glide_tone(329.63 * 2 ** (cents / 1200))
    assert [n.midi for n in detect_notes(y, SR)] == [64]


def test_half_step_bend_stays_one_note():
    # Pick E4, bend up to F4 over 150 ms, hold the bend
    t = np.arange(SR) / SR
    cents = np.clip((t - 0.25) / 0.15, 0, 1) * 100
    y = _glide_tone(329.63 * 2 ** (cents / 1200))
    assert [n.midi for n in detect_notes(y, SR)] == [64]
