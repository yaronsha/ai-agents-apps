"""Command-line interface for guitar-tabber."""

from __future__ import annotations

import argparse
import logging
import sys
import webbrowser
from pathlib import Path
from urllib.parse import quote

from . import __version__
from .pipeline import run_pipeline

# Repo root: .../guitar-tabber/ (parent of guitar_tabber package)
_PACKAGE_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _PACKAGE_DIR.parent
_VIEWER_INDEX = _PROJECT_ROOT / "viewer" / "index.html"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="guitar_tabber",
        description=(
            "Convert a full-mix MP3/MP4 (guitar + other instruments/vocals) "
            "into ASCII guitar tablature, structured .tab.json, and MIDI. "
            "Uses Demucs for guitar stem separation, then librosa.pyin "
            "for pitch detection. Open viewer/ for a Guitar Pro–style player."
        ),
    )
    p.add_argument(
        "input",
        type=Path,
        help="Input audio/video file (MP3, MP4, WAV, ...)",
    )
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output .tab.txt path (default: <input>.tab.txt); "
        ".tab.json and .mid are written beside it",
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
        "--open-viewer",
        action="store_true",
        help=(
            "After writing outputs, print how to open the browser viewer "
            "(and try to launch it with a local http.server if possible)"
        ),
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


def _viewer_instructions(json_path: Path | None) -> str:
    viewer = _VIEWER_INDEX
    lines = [
        "",
        "=== Browser tab viewer ===",
        f"Viewer: {viewer}",
        "",
        "Option A — open the demo (no server needed for embedded demo):",
        f"  file://{viewer}",
        "",
        "Option B — serve the viewer folder and pass ?json= (recommended):",
        f"  cd {_PROJECT_ROOT / 'viewer'}",
        "  python -m http.server 8765",
        "  # then open:",
    ]
    if json_path and json_path.exists():
        # Relative URL only works if JSON is under viewer/ or we use absolute file —
        # instruct user to open with file picker OR copy JSON next to viewer.
        lines.append(
            f"  http://127.0.0.1:8765/?json={quote(json_path.name)}"
        )
        lines.append(
            f"  (place or symlink {json_path.name} into the viewer/ folder, "
            "or use the file picker in the UI)"
        )
        lines.append(f"  JSON written to: {json_path}")
    else:
        lines.append("  http://127.0.0.1:8765/")
    lines.append("")
    lines.append("Or open the viewer and use “Load .tab.json”.")
    return "\n".join(lines)


def _try_open_viewer(json_path: Path | None) -> None:
    """Best-effort: open file:// URL (demo works; CORS may block remote JSON)."""
    url = _VIEWER_INDEX.as_uri()
    if json_path and json_path.exists():
        # Query params on file:// are usable by the viewer for relative paths only;
        # still open the page and print the path.
        pass
    try:
        webbrowser.open(url)
    except Exception as exc:
        logging.getLogger(__name__).debug("Could not open browser: %s", exc)


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )
    # Keep third-party DEBUG noise down even with -v
    for noisy in (
        "numba",
        "numba.core",
        "filelock",
        "urllib3",
        "httpx",
        "httpcore",
        "huggingface_hub",
    ):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    if not args.input.exists():
        print(f"error: input not found: {args.input}", file=sys.stderr)
        return 1

    try:
        result = run_pipeline(
            args.input,
            skip_separation=args.skip_separation,
            keep_stems=args.keep_stems,
            output_tab_path=args.output,
            demucs_model=args.model,
            device=args.device,
        )
    except Exception as exc:
        logging.exception("Pipeline failed")
        print(f"error: {exc}", file=sys.stderr)
        return 2

    print(result.tab)
    print()
    print(f"(detected {result.note_count} notes)")
    if result.tab_path:
        print(f"(tab:  {result.tab_path})")
    if result.json_path:
        print(f"(json: {result.json_path})")
    if result.midi_path:
        print(f"(midi: {result.midi_path})")
    if result.guitar_stem_path:
        print(f"(guitar stem saved: {result.guitar_stem_path})")

    if args.open_viewer:
        print(_viewer_instructions(result.json_path))
        _try_open_viewer(result.json_path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
