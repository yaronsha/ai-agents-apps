"""MIDI round-trip and browser-viewer generation (no audio models needed)."""

import base64
import json
import re

from guitar_tabber.midi_io import midi_to_notes, notes_to_midi
from guitar_tabber.pitch import DetectedNote
from guitar_tabber.pipeline import run_pipeline
from guitar_tabber.viewer import write_viewer_html


def _notes():
    return [
        DetectedNote(time=0.5 * i, duration=0.4, hz=0.0, midi=m, confidence=0.8)
        for i, m in enumerate([45, 48, 50, 52, 55])
    ]


def test_midi_round_trip(tmp_path):
    mid = notes_to_midi(_notes(), tmp_path / "x.mid", tempo_bpm=120)
    back = midi_to_notes(mid)
    assert [n.midi for n in back] == [45, 48, 50, 52, 55]
    assert abs(back[1].time - 0.5) < 0.01
    assert abs(back[1].duration - 0.4) < 0.01


def test_viewer_embeds_midi(tmp_path):
    mid = notes_to_midi(_notes(), tmp_path / "x.mid")
    html = write_viewer_html(mid, tmp_path / "x.tab.html", title="My </script> song").read_text()
    m = re.search(r"const EMBEDDED_SONG = (.*);\n", html)
    payload = json.loads(m.group(1).replace("<\\/", "</"))
    assert base64.b64decode(payload["midiBase64"]) == mid.read_bytes()
    assert payload["title"] == "My </script> song"
    assert "</script> song" not in m.group(1)


def test_pipeline_from_midi(tmp_path):
    mid = notes_to_midi(_notes(), tmp_path / "riff.mid")
    result = run_pipeline(mid)
    assert result.note_count == 5
    assert result.html_path == tmp_path / "riff.tab.html"
    assert result.html_path.exists()
    assert (tmp_path / "riff.tab.txt").exists()
