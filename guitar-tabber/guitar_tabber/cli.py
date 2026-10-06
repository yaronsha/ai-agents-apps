"""Command-line interface for guitar-tabber."""

from __future__ import annotations

import argparse
import logging
import sys
import tempfile
from pathlib import Path

from . import __version__
from .pipeline import run_pipeline
from .youtube import DEFAULT_DOWNLOAD_DIR, clip_path_for, download_mp3, is_url, parse_time, trim_audio


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="guitar_tabber",
        description=(
            "Convert a full-mix MP3/MP4 (guitar + other instruments/vocals) "
            "into ASCII guitar tablature. Uses Demucs for guitar stem "
            "separation, then librosa.pyin for pitch detection."
        ),
    )
    p.add_argument(
        "input",
        help="Input audio/video file (MP3, MP4, WAV, ...) or a YouTube URL",
    )
    p.add_argument(
        "--start",
        help="Only use audio from this time on, e.g. 30 or 0:30",
    )
    p.add_argument(
        "--end",
        help="Only use audio up to this time, e.g. 75 or 1:15",
    )
    p.add_argument(
        "--download-dir",
        type=Path,
        default=DEFAULT_DOWNLOAD_DIR,
        help="Where YouTube downloads are saved as MP3 (default: ./downloads)",
    )
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output .tab.txt path (default: <input>.tab.txt)",
    )
    p.add_argument(
        "--skip-separation",
        action="store_true",
        help="Skip Demucs stem separation (use for already-isolated guitar tracks)",
    )
    p.add_argument(
        "--keep-stems",
        action="store_true",
        help="Save the separated guitar stem WAV next to the input file",
    )
    p.add_argument(
        "--model",
        default="htdemucs_6s",
        help="Demucs model name (default: htdemucs_6s with dedicated guitar stem)",
    )
    p.add_argument(
        "--device",
        default="cpu",
        choices=("cpu", "cuda"),
        help="Torch device for Demucs (default: cpu)",
    )
    p.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Verbose logging",
    )
    p.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {__version__}",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )
    # Keep third-party DEBUG noise down even with -v
    for noisy in ("numba", "numba.core", "filelock", "urllib3", "httpx", "httpcore", "httpx2", "httpcore2", "huggingface_hub"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    try:
        start, end = parse_time(args.start), parse_time(args.end)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if start is not None and end is not None and end <= start:
        print("error: --end must be after --start", file=sys.stderr)
        return 1

    if is_url(args.input):
        try:
            input_path = download_mp3(args.input, args.download_dir, start=start, end=end)
        except Exception as exc:
            logging.debug("Download failed", exc_info=True)
            print(f"error: download failed: {exc}", file=sys.stderr)
            return 1
        print(f"(downloaded: {input_path})")
    else:
        input_path = Path(args.input)
        if not input_path.exists():
            print(f"error: input not found: {input_path}", file=sys.stderr)
            return 1

    output_tab_path = args.output
    clip_dir = None
    if not is_url(args.input) and (start is not None or end is not None):
        # Trim local files to a lossless WAV in a temp dir (no re-encoding,
        # nothing left next to the source); the tab is named after the clip.
        clip_dir = tempfile.TemporaryDirectory(prefix="guitar_tabber_clip_")
        clip_name = clip_path_for(input_path, start, end)
        if output_tab_path is None:
            output_tab_path = clip_name.with_suffix(".tab.txt")
        try:
            input_path = trim_audio(
                input_path, Path(clip_dir.name) / clip_name.with_suffix(".wav").name, start, end
            )
        except Exception as exc:
            clip_dir.cleanup()
            print(f"error: trim failed: {exc}", file=sys.stderr)
            return 1

    try:
        result = run_pipeline(
            input_path,
            skip_separation=args.skip_separation,
            keep_stems=args.keep_stems,
            output_tab_path=output_tab_path,
            demucs_model=args.model,
            device=args.device,
        )
    except Exception as exc:
        logging.exception("Pipeline failed")
        print(f"error: {exc}", file=sys.stderr)
        return 2
    finally:
        if clip_dir is not None:
            clip_dir.cleanup()

    print(result.tab)
    print()
    print(f"(detected {result.note_count} notes)")
    if result.guitar_stem_path:
        print(f"(guitar stem saved: {result.guitar_stem_path})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
