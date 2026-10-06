"""Browser tab viewer: wrap a MIDI file in a self-contained HTML page."""

from __future__ import annotations

import base64
import html
import json
import logging
from importlib import resources
from pathlib import Path

logger = logging.getLogger(__name__)

_DATA_MARKER = "/*__EMBEDDED_SONG__*/null"


def viewer_template() -> str:
    """The viewer page (also usable on its own: open it and drop a .mid file)."""
    return resources.files("guitar_tabber").joinpath("web/viewer.html").read_text(encoding="utf-8")


def write_viewer_html(midi_path: Path, html_path: Path, title: str | None = None) -> Path:
    """Write ``html_path``: the viewer with ``midi_path`` embedded (base64)."""
    midi_path = Path(midi_path)
    html_path = Path(html_path)
    title = title or midi_path.stem
    payload = {
        "title": title,
        "midiBase64": base64.b64encode(midi_path.read_bytes()).decode("ascii"),
    }
    page = viewer_template()
    if _DATA_MARKER not in page:
        raise RuntimeError("viewer.html is missing the embedded-song marker")
    # "</" is escaped so the JSON can never close the <script> tag early
    page = page.replace(_DATA_MARKER, json.dumps(payload).replace("</", "<\\/"), 1)
    page = page.replace("<title>Guitar Tabber</title>", f"<title>{html.escape(title)} – Guitar Tabber</title>", 1)
    html_path.write_text(page, encoding="utf-8")
    logger.info("Wrote browser tab viewer to %s", html_path)
    return html_path
