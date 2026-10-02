"""Audio extraction and I/O helpers (ffmpeg-based)."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf


SUPPORTED_EXTENSIONS = {".mp3", ".mp4", ".m4a", ".wav", ".flac", ".ogg", ".webm"}


def require_ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        raise RuntimeError(
            "ffmpeg not found on PATH. Install it (e.g. `sudo apt install ffmpeg`)."
        )
    return path


def extract_mono_wav(
    input_path: Path,
    output_path: Path | None = None,
    sample_rate: int = 44100,
) -> Path:
    """
    Convert MP3/MP4/etc. to mono WAV via ffmpeg.

    Returns path to the WAV file.
    """
    require_ffmpeg()
    input_path = Path(input_path)
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    if output_path is None:
        output_path = input_path.with_suffix(".extracted.wav")
    else:
        output_path = Path(output_path)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-sample_fmt",
        "s16",
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg failed (exit {result.returncode}):\n{result.stderr[-2000:]}"
        )
    return output_path


def load_audio(path: Path, sample_rate: int | None = 22050) -> tuple[np.ndarray, int]:
    """Load audio as float mono waveform. Resamples if sample_rate is set."""
    path = Path(path)
    data, sr = sf.read(str(path), always_2d=False)
    if data.ndim > 1:
        data = np.mean(data, axis=1)
    data = np.asarray(data, dtype=np.float32)
    if sample_rate is not None and sr != sample_rate:
        import librosa

        data = librosa.resample(data, orig_sr=sr, target_sr=sample_rate)
        sr = sample_rate
    return data, sr


def write_wav(path: Path, data: np.ndarray, sample_rate: int) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), data, sample_rate)
    return path


def with_temp_dir():
    return tempfile.TemporaryDirectory(prefix="guitar_tabber_")
