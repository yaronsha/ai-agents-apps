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


def _fake_track(monkeypatch, segments: list[tuple[int, int]], onsets: list[int], n: int = 80):
    """Stub pyin with open A voiced on the given [start, end) frame ranges."""
    from guitar_tabber import pitch

    f0 = np.full(n, np.nan)
    for a, b in segments:
        f0[a:b] = 110.0
    voiced = ~np.isnan(f0)
    monkeypatch.setattr(pitch.librosa, "pyin", lambda *a, **k: (f0, voiced, voiced * 0.9))
    monkeypatch.setattr(pitch, "_onset_frames", lambda *a, **k: np.array(onsets))
    return np.zeros(n * 256, dtype=np.float32)


def test_onset_in_discarded_blip_still_marks_the_next_note(monkeypatch):
    # Re-pluck: a 1-frame voiced blip holds the onset, then pyin drops out briefly.
    y = _fake_track(monkeypatch, [(0, 30), (31, 32), (33, 63)], onsets=[0, 31])
    assert _midis(y) == [45, 45]


def test_onset_long_before_a_note_does_not_mark_it(monkeypatch):
    y = _fake_track(monkeypatch, [(0, 20), (40, 70)], onsets=[0, 22])
    notes = detect_notes(y, SR)
    assert [n.from_onset for n in notes] == [True, False]
