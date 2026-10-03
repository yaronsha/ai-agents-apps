"""Pitch tracking on public-domain melodies with a known standard-tuning tab.

Audio is synthesized here: numpy harmonic plucks (fundamental plus weaker
harmonics and a short pick click), then about 60 ms of rest. It is not a
sampled guitar and not a commercial recording. No network. The pipeline runs
with skip_separation so this scores pitch, not Demucs.

Each melody is monophonic. The tab is one open-position EADGBE spelling of
those pitches. Scoring compares the MIDI sequence, not which string was chosen.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from guitar_tabber.pipeline import run_pipeline  # noqa: E402

SR = 44100

# Open-string MIDI, standard tuning, high e down to low E.
_OPEN = {"e": 64, "B": 59, "G": 55, "D": 50, "A": 45, "E": 40}

# (string, fret) in melody order.
# Ode to Joy, Beethoven, 1824. Public domain. Key of C.
ODE_TO_JOY = [
    ("e", 0), ("e", 0), ("e", 1), ("e", 3), ("e", 3), ("e", 1), ("e", 0), ("B", 3),
    ("B", 1), ("B", 1), ("B", 3), ("e", 0), ("e", 0), ("B", 3), ("B", 3),
    ("e", 0), ("e", 0), ("e", 1), ("e", 3), ("e", 3), ("e", 1), ("e", 0), ("B", 3),
    ("B", 1), ("B", 1), ("B", 3), ("e", 0), ("B", 3), ("B", 1), ("B", 1),
]
# Joy to the World, Lowell Mason, 1839. Public domain. Key of C.
# "Joy to the world, the Lord is come / Let earth receive her King".
JOY_TO_THE_WORLD = [
    ("e", 8), ("e", 7), ("e", 5), ("e", 3), ("e", 1), ("e", 0), ("B", 3), ("B", 1),
    ("e", 3), ("e", 5), ("e", 5), ("e", 7), ("e", 7), ("e", 8),
]
# Twinkle, Twinkle, Little Star / Ah! vous dirai-je, maman. French folk, public domain.
TWINKLE = (
    [("B", 1), ("B", 1), ("e", 3), ("e", 3), ("e", 5), ("e", 5), ("e", 3)]
    + [("e", 1), ("e", 1), ("e", 0), ("e", 0), ("B", 3), ("B", 3), ("B", 1)]
    + [("e", 3), ("e", 3), ("e", 1), ("e", 1), ("e", 0), ("e", 0), ("B", 3)]
    + [("e", 3), ("e", 3), ("e", 1), ("e", 1), ("e", 0), ("e", 0), ("B", 3)]
    + [("B", 1), ("B", 1), ("e", 3), ("e", 3), ("e", 5), ("e", 5), ("e", 3)]
    + [("e", 1), ("e", 1), ("e", 0), ("e", 0), ("B", 3), ("B", 3), ("B", 1)]
)
# Scarborough Fair / The Elfin Knight (Child 2). Traditional, public domain.
# Digital Tradition setting "scarfair", K:G, L:1/8:
#   E2E GAB|ABG F3|EFE GAB|BcA B2e|e2B BAG|ABd FED|E2E GAB|AFG E3
# F is F-sharp. ABC hyphens there are slurs, not extra notes.
SCARBOROUGH_FAIR = [
    ("e", 0), ("e", 0), ("e", 3), ("e", 5), ("e", 7),
    ("e", 5), ("e", 7), ("e", 3), ("e", 2),
    ("e", 0), ("e", 2), ("e", 0), ("e", 3), ("e", 5), ("e", 7),
    ("e", 7), ("e", 8), ("e", 5), ("e", 7), ("e", 12),
    ("e", 12), ("e", 7), ("e", 7), ("e", 5), ("e", 3),
    ("e", 5), ("e", 7), ("e", 10), ("e", 2), ("e", 0), ("B", 3),
    ("e", 0), ("e", 0), ("e", 3), ("e", 5), ("e", 7),
    ("e", 5), ("e", 2), ("e", 3), ("e", 0),
]

SONGS = (
    ("ode_to_joy", ODE_TO_JOY),
    ("joy_to_the_world", JOY_TO_THE_WORLD),
    ("twinkle", TWINKLE),
    ("scarborough_fair", SCARBOROUGH_FAIR),
)


def midi_of(tab: list[tuple[str, int]]) -> list[int]:
    return [_OPEN[string] + fret for string, fret in tab]


def format_tab(tab: list[tuple[str, int]]) -> str:
    """High e on top. One fret token per note, dashes elsewhere."""
    lines = {name: [] for name in ("e", "B", "G", "D", "A", "E")}
    for string, fret in tab:
        width = max(1, len(str(fret)))
        for name in lines:
            if name == string:
                lines[name].append(str(fret).ljust(width, "-"))
            else:
                lines[name].append("-" * width)
    rendered = []
    for name in ("e", "B", "G", "D", "A", "E"):
        rendered.append(f"{name}|--" + "--".join(lines[name]) + "--|")
    return "\n".join(rendered)


def _midi_hz(midi: int) -> float:
    return 440.0 * 2.0 ** ((midi - 69) / 12.0)


def _guitarish_pluck(midi: int, duration: float, amp: float = 0.45) -> np.ndarray:
    """Decaying harmonic pluck. Not a soundfont and not a recorded guitar."""
    n = int(round(duration * SR))
    t = np.arange(n) / SR
    freq = _midi_hz(midi)
    wave = np.zeros(n, dtype=np.float64)
    for k, amp_k in ((1, 1.00), (2, 0.28), (3, 0.12), (4, 0.05), (5, 0.02)):
        wave += amp_k * np.sin(2.0 * np.pi * freq * k * t)
    env = (1.0 - np.exp(-t * 250.0)) * np.exp(-3.0 * t)
    click_n = min(n, int(0.004 * SR))
    click = np.zeros(n, dtype=np.float64)
    rng = np.random.default_rng(midi * 17 + n)
    click[:click_n] = rng.uniform(-1.0, 1.0, click_n) * np.linspace(1.0, 0.0, click_n)
    return (amp * (wave * env + 0.08 * click)).astype(np.float32)


def render_plucked(midis: list[int], note_sec: float = 0.42, gap_sec: float = 0.06) -> np.ndarray:
    """One pluck per note, then a short rest. Re-plucks are separate attacks."""
    chunks: list[np.ndarray] = []
    gap = np.zeros(int(gap_sec * SR), dtype=np.float32)
    for midi in midis:
        chunks.append(_guitarish_pluck(midi, note_sec))
        chunks.append(gap)
    chunks.append(np.zeros(int(0.15 * SR), dtype=np.float32))
    y = np.concatenate(chunks)
    peak = float(np.max(np.abs(y))) or 1.0
    return (0.8 * y / peak).astype(np.float32)


def midi_from_note_log(note_log: str) -> list[int]:
    midis: list[int] = []
    for line in note_log.splitlines():
        if not line or line.startswith("#"):
            continue
        midis.append(int(line.split()[4]))
    return midis


def sequence_score(expected: list[int], detected: list[int]) -> dict[str, float]:
    """Alignment F1. A substitution counts as both a miss and an extra."""
    n, m = len(expected), len(detected)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        dp[i][0] = i
    for j in range(1, m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if expected[i - 1] == detected[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
    i, j = n, m
    matches = subs = deletions = insertions = 0
    while i > 0 or j > 0:
        if i > 0 and j > 0 and expected[i - 1] == detected[j - 1] and dp[i][j] == dp[i - 1][j - 1]:
            matches += 1
            i -= 1
            j -= 1
        elif i > 0 and j > 0 and dp[i][j] == dp[i - 1][j - 1] + 1:
            subs += 1
            i -= 1
            j -= 1
        elif i > 0 and dp[i][j] == dp[i - 1][j] + 1:
            deletions += 1
            i -= 1
        else:
            insertions += 1
            j -= 1
    missed = deletions + subs
    extras = insertions + subs
    precision = matches / len(detected) if detected else 0.0
    recall = matches / len(expected) if expected else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    return {
        "expected": float(len(expected)),
        "detected": float(len(detected)),
        "matches": float(matches),
        "missed": float(missed),
        "extras": float(extras),
        "f1": f1,
    }


class PublicDomainMelodyTest(unittest.TestCase):
    def test_tabs_are_the_melody(self):
        for name, tab in SONGS:
            self.assertGreater(len(tab), 8, name)
            text = format_tab(tab)
            self.assertTrue(text.startswith("e|"), text)
            # Every fret in the tab is on the string we named, and in range.
            for string, fret in tab:
                self.assertIn(string, _OPEN)
                self.assertGreaterEqual(fret, 0)
                self.assertLessEqual(fret, 12)

    def test_pipeline_matches_melody_midi(self):
        with tempfile.TemporaryDirectory(prefix="pd_melody_") as tmp:
            work = Path(tmp)
            for name, tab in SONGS:
                expected = midi_of(tab)
                wav = work / f"{name}.wav"
                sf.write(str(wav), render_plucked(expected), SR)
                result = run_pipeline(
                    wav,
                    skip_separation=True,
                    output_tab_path=work / f"{name}.tab.txt",
                )
                detected = midi_from_note_log(result.note_log)
                score = sequence_score(expected, detected)
                self.assertEqual(
                    detected,
                    expected,
                    f"{name}: score {score}\n{format_tab(tab)}\ndetected {detected}",
                )
                self.assertEqual(score["f1"], 1.0)


if __name__ == "__main__":
    unittest.main()
