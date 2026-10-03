"""Download a song from YouTube (or any yt-dlp site) as MP3, optionally trimmed.

Meant for personal use with content you have the rights to.

Standalone use:
    python -m guitar_tabber.youtube "https://youtu.be/..." --start 0:30 --end 1:00
"""

from __future__ import annotations

import argparse
import logging
import re
import subprocess
import sys
from pathlib import Path

from .audio import require_ffmpeg

logger = logging.getLogger(__name__)

DEFAULT_DOWNLOAD_DIR = Path("downloads")

_URL_RE = re.compile(r"^https?://", re.IGNORECASE)


def is_url(value: str | Path) -> bool:
    return bool(_URL_RE.match(str(value)))


def parse_time(value: str | float | int | None) -> float | None:
    """Parse '83', '83.5', '1:23' or '1:02:03' into seconds."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        seconds = float(value)
    else:
        parts = str(value).strip().split(":")
        if len(parts) > 3:
            raise ValueError(f"bad time: {value!r} (use SS, MM:SS or HH:MM:SS)")
        try:
            nums = [float(p) for p in parts]
        except ValueError:
            raise ValueError(f"bad time: {value!r} (use SS, MM:SS or HH:MM:SS)") from None
        seconds = 0.0
        for n in nums:
            seconds = seconds * 60 + n
    if seconds < 0:
        raise ValueError(f"time must not be negative: {value!r}")
    return seconds


def _fmt_time(seconds: float) -> str:
    return f"{int(seconds // 60)}m{seconds % 60:04.1f}s".replace(".", "_")


def trim_audio(
    input_path: Path,
    output_path: Path,
    start: float | None = None,
    end: float | None = None,
    bitrate: str = "192k",
) -> Path:
    """Cut [start, end) seconds out of input_path via ffmpeg.

    Writes MP3 when output_path ends in .mp3, otherwise lossless 16-bit PCM WAV.
    """
    require_ffmpeg()
    if start is not None and end is not None and end <= start:
        raise ValueError(f"end ({end}s) must be after start ({start}s)")
    cmd = ["ffmpeg", "-y", "-i", str(input_path)]
    if start is not None:
        cmd += ["-ss", f"{start:.3f}"]
    if end is not None:
        cmd += ["-to", f"{end:.3f}"]
    if Path(output_path).suffix.lower() == ".mp3":
        cmd += ["-vn", "-codec:a", "libmp3lame", "-b:a", bitrate, str(output_path)]
    else:
        cmd += ["-vn", "-codec:a", "pcm_s16le", str(output_path)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg trim failed (exit {result.returncode}):\n{result.stderr[-2000:]}"
        )
    return Path(output_path)


def clip_path_for(path: Path, start: float | None, end: float | None) -> Path:
    """Name for a trimmed copy, e.g. song.clip_0m30_0s-1m00_0s.mp3."""
    a = _fmt_time(start or 0.0)
    b = _fmt_time(end) if end is not None else "end"
    return path.with_name(f"{path.stem}.clip_{a}-{b}.mp3")


def download_mp3(
    url: str,
    out_dir: Path = DEFAULT_DOWNLOAD_DIR,
    *,
    start: float | None = None,
    end: float | None = None,
    bitrate: str = "192",
) -> Path:
    """
    Download the audio of `url` with yt-dlp, convert it to MP3, and optionally
    trim it to [start, end). Returns the path of the resulting MP3.
    """
    if start is not None and end is not None and end <= start:
        raise ValueError(f"end ({end}s) must be after start ({start}s)")
    try:
        import yt_dlp
    except ImportError as exc:
        raise RuntimeError(
            "yt-dlp is not installed. Run: pip install yt-dlp"
        ) from exc
    require_ffmpeg()

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    opts = {
        "format": "bestaudio/best",
        "outtmpl": str(out_dir / "%(title).80B [%(id)s].%(ext)s"),
        "noplaylist": True,
        # A pure playlist link would otherwise fetch every entry; take only the first.
        "playlist_items": "1",
        "restrictfilenames": False,
        "quiet": not logger.isEnabledFor(logging.DEBUG),
        "no_warnings": not logger.isEnabledFor(logging.DEBUG),
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": bitrate,
            }
        ],
    }

    logger.info("Downloading audio from %s ...", url)
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        if info is None:
            raise RuntimeError(f"yt-dlp returned no info for {url}")
        if info.get("_type") == "playlist":
            entries = [e for e in (info.get("entries") or []) if e]
            if not entries:
                raise RuntimeError(f"no downloadable entries at {url}")
            info = entries[0]
        mp3 = Path(ydl.prepare_filename(info)).with_suffix(".mp3")

    if not mp3.exists():
        raise RuntimeError(f"download finished but MP3 not found: {mp3}")
    logger.info("Saved %s", mp3)

    if start is None and end is None:
        return mp3

    clip = clip_path_for(mp3, start, end)
    logger.info("Trimming to %s ...", clip.name)
    trim_audio(mp3, clip, start, end)
    return clip


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="guitar_tabber.youtube",
        description="Download a YouTube song as MP3 (optionally trimmed) for guitar_tabber.",
    )
    p.add_argument("url", help="YouTube (or other yt-dlp supported) URL")
    p.add_argument(
        "-d",
        "--download-dir",
        type=Path,
        default=DEFAULT_DOWNLOAD_DIR,
        help="Where to save the MP3 (default: ./downloads)",
    )
    p.add_argument("--start", help="Clip start, e.g. 30 or 0:30")
    p.add_argument("--end", help="Clip end, e.g. 75 or 1:15")
    p.add_argument("-v", "--verbose", action="store_true", help="Verbose logging")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )
    try:
        mp3 = download_mp3(
            args.url,
            args.download_dir,
            start=parse_time(args.start),
            end=parse_time(args.end),
        )
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(mp3)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
