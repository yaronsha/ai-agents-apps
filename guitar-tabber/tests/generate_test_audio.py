#!/usr/bin/env python3
"""Generate synthetic audio for end-to-end pipeline tests.

Creates:
  1) Isolated open-A (110 Hz) guitar-like tone → tests/fixtures/open_a.wav
  2) A short "mixed song": guitar melody + bass + soft noise → tests/fixtures/mixed_demo.wav
  3) Optionally an MP3 of the mixed demo via ffmpeg
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures"


def synth_pluck(freq: float, duration: float, sr: int, amplitude: float = 0.4) -> np.ndarray:
    """Simple decaying harmonic tone approximating a plucked string."""
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    # Fundamental + a few harmonics with faster decay
    wave = (
        1.0 * np.sin(2 * np.pi * freq * t)
        + 0.45 * np.sin(2 * np.pi * 2 * freq * t)
        + 0.2 * np.sin(2 * np.pi * 3 * freq * t)
        + 0.08 * np.sin(2 * np.pi * 4 * freq * t)
    )
    env = np.exp(-2.5 * t) * (1 - np.exp(-80 * t))  # pluck attack + decay
    return (amplitude * wave * env).astype(np.float32)


def make_open_a(sr: int = 44100) -> np.ndarray:
    """Open A string (~110 Hz) held then a second note (A3 = 220 Hz)."""
    silence = np.zeros(int(0.15 * sr), dtype=np.float32)
    n1 = synth_pluck(110.0, 0.7, sr, 0.5)   # open A (A2)
    gap = np.zeros(int(0.2 * sr), dtype=np.float32)
    n2 = synth_pluck(220.0, 0.6, sr, 0.45)  # A3 — 12th fret A or open A octave
    n3 = synth_pluck(146.83, 0.55, sr, 0.45)  # D3 — open D
    return np.concatenate([silence, n1, gap, n2, gap, n3, silence])


def make_mixed_demo(sr: int = 44100) -> np.ndarray:
    """Guitar melody mixed with a bass drone and noise (simulates a full mix)."""
    guitar = make_open_a(sr)
    n = len(guitar)
    t = np.linspace(0, n / sr, n, endpoint=False)
    # Bass: low E-ish drone with slow pulse
    bass = 0.25 * np.sin(2 * np.pi * 41.2 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 2 * t))
    # Soft broadband noise (stand-in for drums/ambience)
    rng = np.random.default_rng(42)
    noise = 0.03 * rng.standard_normal(n)
    # Fake "vocal" mid tone bursts
    vocal = np.zeros(n, dtype=np.float32)
    for start_s, freq in [(0.3, 330.0), (1.5, 392.0)]:
        start = int(start_s * sr)
        dur = int(0.35 * sr)
        end = min(n, start + dur)
        tv = np.linspace(0, (end - start) / sr, end - start, endpoint=False)
        vocal[start:end] += (0.12 * np.sin(2 * np.pi * freq * tv) * np.exp(-3 * tv)).astype(
            np.float32
        )
    mix = guitar.astype(np.float32) + bass.astype(np.float32) + noise.astype(np.float32) + vocal
    peak = np.max(np.abs(mix)) + 1e-9
    return (0.9 * mix / peak).astype(np.float32)


def maybe_write_mp3(wav_path: Path, mp3_path: Path) -> bool:
    try:
        r = subprocess.run(
            ["ffmpeg", "-y", "-i", str(wav_path), "-codec:a", "libmp3lame", "-q:a", "4", str(mp3_path)],
            capture_output=True,
            text=True,
        )
        return r.returncode == 0
    except FileNotFoundError:
        return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sr", type=int, default=44100)
    args = parser.parse_args()

    FIXTURES.mkdir(parents=True, exist_ok=True)

    open_a = make_open_a(args.sr)
    open_a_path = FIXTURES / "open_a.wav"
    sf.write(str(open_a_path), open_a, args.sr)
    print(f"Wrote {open_a_path}")

    mixed = make_mixed_demo(args.sr)
    mixed_path = FIXTURES / "mixed_demo.wav"
    sf.write(str(mixed_path), mixed, args.sr)
    print(f"Wrote {mixed_path}")

    mp3_path = FIXTURES / "mixed_demo.mp3"
    if maybe_write_mp3(mixed_path, mp3_path):
        print(f"Wrote {mp3_path}")
    else:
        print("ffmpeg MP3 encode skipped/failed (WAV still available)", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
