"""Tests for the YouTube -> MP3 downloader. yt-dlp is mocked; ffmpeg runs for real.

Run: python -m unittest tests/test_youtube.py  (from guitar-tabber/)
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from guitar_tabber import youtube  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "mixed_demo.mp3"


def duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


class FakeYDL:
    """Stands in for yt_dlp.YoutubeDL: 'downloads' by copying the fixture."""

    last_opts: dict | None = None

    def __init__(self, opts):
        FakeYDL.last_opts = opts
        self.opts = opts

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def extract_info(self, url, download=True):
        info = {"id": "abc123", "title": "Some Song", "ext": "webm"}
        # What FFmpegExtractAudio would leave behind.
        mp3 = Path(self.prepare_filename(info)).with_suffix(".mp3")
        mp3.write_bytes(FIXTURE.read_bytes())
        return info

    def prepare_filename(self, info):
        tmpl = self.opts["outtmpl"]
        return (tmpl.replace("%(title).80B", info["title"])
                    .replace("%(id)s", info["id"])
                    .replace("%(ext)s", info["ext"]))


def fake_yt_dlp():
    return types.SimpleNamespace(YoutubeDL=FakeYDL)


class ParseTimeTests(unittest.TestCase):
    def test_formats(self):
        self.assertEqual(youtube.parse_time("83"), 83)
        self.assertEqual(youtube.parse_time("1:23"), 83)
        self.assertEqual(youtube.parse_time("1:02:03"), 3723)
        self.assertEqual(youtube.parse_time("0:30.5"), 30.5)
        self.assertIsNone(youtube.parse_time(None))

    def test_bad(self):
        for bad in ("abc", "1:2:3:4", "-5"):
            with self.assertRaises(ValueError):
                youtube.parse_time(bad)

    def test_is_url(self):
        self.assertTrue(youtube.is_url("https://www.youtube.com/watch?v=x"))
        self.assertTrue(youtube.is_url("http://youtu.be/x"))
        self.assertFalse(youtube.is_url("song.mp3"))
        self.assertFalse(youtube.is_url(Path("/tmp/https/song.mp3")))


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        patcher = mock.patch.dict(sys.modules, {"yt_dlp": fake_yt_dlp()})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)

    def test_full_download(self):
        mp3 = youtube.download_mp3("https://youtu.be/abc123", self.dir)
        self.assertEqual(mp3.name, "Some Song [abc123].mp3")
        self.assertTrue(mp3.exists())
        pp = FakeYDL.last_opts["postprocessors"][0]
        self.assertEqual(pp["key"], "FFmpegExtractAudio")
        self.assertEqual(pp["preferredcodec"], "mp3")
        self.assertTrue(FakeYDL.last_opts["noplaylist"])

    def test_trimmed_download(self):
        full = duration(FIXTURE)
        clip = youtube.download_mp3("https://youtu.be/abc123", self.dir, start=0.5, end=1.5)
        self.assertIn(".clip_", clip.name)
        self.assertTrue(clip.exists())
        self.assertLess(duration(clip), full)
        self.assertAlmostEqual(duration(clip), 1.0, delta=0.15)

    def test_end_before_start_fails_before_downloading(self):
        FakeYDL.last_opts = None
        with self.assertRaises(ValueError):
            youtube.download_mp3("https://youtu.be/abc123", self.dir, start=3, end=1)
        self.assertIsNone(FakeYDL.last_opts)
        self.assertEqual(list(self.dir.iterdir()), [])

    def test_playlist_limited_to_first_item(self):
        youtube.download_mp3("https://www.youtube.com/playlist?list=PL1", self.dir)
        self.assertEqual(FakeYDL.last_opts["playlist_items"], "1")


class CliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        patcher = mock.patch.dict(sys.modules, {"yt_dlp": fake_yt_dlp()})
        patcher.start()
        self.addCleanup(patcher.stop)

    def _run_cli(self, argv):
        try:
            from guitar_tabber import cli
        except ImportError as exc:  # heavy deps (librosa/demucs) not installed
            self.skipTest(f"tabber deps missing: {exc}")
        result = types.SimpleNamespace(tab="TAB", note_count=0, guitar_stem_path=None)
        with mock.patch.object(cli, "run_pipeline", return_value=result) as run:
            code = cli.main(argv)
        return code, run

    def test_url_input_is_downloaded_then_tabbed(self):
        code, run = self._run_cli(
            ["https://youtu.be/abc123", "--download-dir", str(self.dir),
             "--start", "0:00.5", "--end", "0:01.5"]
        )
        self.assertEqual(code, 0)
        fed = run.call_args.args[0]
        self.assertEqual(fed.parent, self.dir)
        self.assertIn(".clip_", fed.name)

    def test_bad_time(self):
        code, run = self._run_cli(["song.mp3", "--start", "abc"])
        self.assertEqual(code, 1)
        run.assert_not_called()


class StandaloneMainTests(unittest.TestCase):
    def test_prints_path(self):
        with tempfile.TemporaryDirectory() as d, \
                mock.patch.dict(sys.modules, {"yt_dlp": fake_yt_dlp()}), \
                mock.patch("builtins.print") as pr:
            code = youtube.main(["https://youtu.be/abc123", "-d", d])
        self.assertEqual(code, 0)
        self.assertTrue(str(pr.call_args.args[0]).endswith("Some Song [abc123].mp3"))


if __name__ == "__main__":
    unittest.main()
