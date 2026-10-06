"""End-to-end: mix → (optional) stem separation → pitch → tablature."""

from __future__ import annotations

import logging
import tempfile
from dataclasses import dataclass
from pathlib import Path

from .audio import extract_mono_wav, load_audio
from .midi_io import MIDI_EXTENSIONS, estimate_tempo, midi_to_notes, notes_to_midi
from .pitch import DetectedNote, detect_notes, merge_nearby_same_pitch
from .polyphonic import basic_pitch_available, detect_notes_polyphonic
from .timing import StageTimer
from .tab import format_ascii_tab, format_note_log, tab_fingerings
from .viewer import write_viewer_html

logger = logging.getLogger(__name__)

ENGINES = ("basic-pitch", "pyin")


@dataclass
class PipelineResult:
    tab: str
    note_log: str
    note_count: int
    guitar_stem_path: Path | None
    extracted_wav_path: Path | None
    midi_path: Path | None = None
    html_path: Path | None = None
    tempo_bpm: float | None = None
    timer: StageTimer | None = None


def run_pipeline(
    input_path: Path,
    *,
    skip_separation: bool = False,
    keep_stems: bool = False,
    output_tab_path: Path | None = None,
    demucs_model: str = "htdemucs_6s",
    device: str = "cpu",
    analysis_sr: int = 22050,
    engine: str = "basic-pitch",
    work_dir: Path | None = None,
    write_midi: bool = True,
    write_html: bool = True,
    tempo_bpm: float | None = None,
) -> PipelineResult:
    """
    Convert an MP3/MP4 (full mix or isolated guitar) into guitar tablature.

    Writes ``<input>.tab.txt`` (ASCII), ``<input>.mid`` and ``<input>.tab.html``
    (browser viewer with playback). A ``.mid`` input skips audio analysis.
    """
    if tempo_bpm is not None and not 0 < tempo_bpm < float("inf"):
        raise ValueError(f"tempo_bpm must be > 0, got {tempo_bpm}")
    if engine not in ENGINES:
        raise ValueError(f"Unknown engine {engine!r}; expected one of {ENGINES}")
    input_path = Path(input_path)
    if output_tab_path is None:
        output_tab_path = input_path.with_suffix(".tab.txt")
    output_tab_path = Path(output_tab_path)
    html_path = _sibling(output_tab_path, ".tab.html") if write_html else None

    timer = StageTimer()
    if input_path.suffix.lower() in MIDI_EXTENSIONS:
        return _run_from_midi(input_path, output_tab_path, html_path, timer)

    own_tmpdir = None
    if work_dir is None:
        own_tmpdir = tempfile.TemporaryDirectory(prefix="guitar_tabber_")
        work_dir = Path(own_tmpdir.name)
    else:
        work_dir = Path(work_dir)
        work_dir.mkdir(parents=True, exist_ok=True)

    try:
        # 1. Extract to mono WAV
        extracted = work_dir / f"{input_path.stem}_mix.wav"
        logger.info("Extracting audio from %s ...", input_path)
        with timer.stage("extract audio (ffmpeg)"):
            extract_mono_wav(input_path, extracted, sample_rate=44100)

        # 2. Stem separation (unless skipped)
        guitar_wav: Path
        kept_stem: Path | None = None
        if skip_separation:
            logger.info("Skipping stem separation (--skip-separation)")
            guitar_wav = extracted
        else:
            stems_dir = work_dir / "stems"
            with timer.stage("import torch/demucs"):
                from .separation import separate_guitar_stem  # heavy (torch); import lazily

            guitar_wav = separate_guitar_stem(
                extracted, stems_dir, model_name=demucs_model, device=device, timer=timer
            )
            if keep_stems:
                dest = input_path.with_name(f"{input_path.stem}_guitar_stem.wav")
                dest.write_bytes(guitar_wav.read_bytes())
                kept_stem = dest
                logger.info("Saved guitar stem to %s", dest)

        # 3. Note detection (+ tempo from the full mix, for the bar grid):
        #    polyphonic basic-pitch (chords, fingerpicking) or monophonic pyin
        if tempo_bpm is not None:
            first_beat = 0.0
            logger.info("Tempo: %.1f bpm (--bpm)", tempo_bpm)
        else:
            with timer.stage("tempo estimate"):
                tempo_bpm, first_beat = estimate_tempo(*load_audio(extracted, sample_rate=analysis_sr))
            logger.info("Estimated tempo: %.1f bpm", tempo_bpm)
        with timer.stage(f"note detection ({engine})"):
            notes = detect_notes_for_engine(guitar_wav, engine, analysis_sr=analysis_sr)

        # 4. Map to frets, write tab + MIDI + browser viewer
        with timer.stage("tabs, MIDI, viewer"):
            frames, positions = tab_fingerings(notes)
            tab = format_ascii_tab(frames)
            note_log = format_note_log(notes, positions)

            output_tab_path.write_text(tab + "\n\n" + note_log + "\n", encoding="utf-8")
            logger.info("Wrote tablature to %s", output_tab_path)

            midi_path = None
            if write_midi or html_path:
                midi_path = _sibling(output_tab_path, ".mid") if write_midi else work_dir / "song.mid"
                notes_to_midi(
                    notes, midi_path, tempo_bpm=tempo_bpm, beat_offset=first_beat, title=input_path.stem
                )
                if html_path:
                    write_viewer_html(midi_path, html_path, title=input_path.stem)

        return PipelineResult(
            tab=tab,
            note_log=note_log,
            note_count=len(notes),
            guitar_stem_path=kept_stem,
            extracted_wav_path=extracted if keep_stems else None,
            midi_path=midi_path if write_midi else None,
            html_path=html_path,
            tempo_bpm=tempo_bpm,
            timer=timer,
        )
    finally:
        if own_tmpdir is not None:
            own_tmpdir.cleanup()


def _sibling(tab_path: Path, suffix: str) -> Path:
    """``song.tab.txt`` → ``song<suffix>`` in the same folder."""
    name = tab_path.name
    stem = name[: -len(".tab.txt")] if name.endswith(".tab.txt") else tab_path.stem
    return tab_path.with_name(stem + suffix)


def _run_from_midi(
    midi_path: Path, output_tab_path: Path, html_path: Path | None, timer: StageTimer
) -> PipelineResult:
    """MIDI input: no audio analysis, just tabs + viewer."""
    with timer.stage("tabs, viewer"):
        notes = midi_to_notes(midi_path)
        frames, positions = tab_fingerings(notes)
        tab = format_ascii_tab(frames)
        note_log = format_note_log(notes, positions)
        output_tab_path.write_text(tab + "\n\n" + note_log + "\n", encoding="utf-8")
        logger.info("Wrote tablature to %s", output_tab_path)
        if html_path:
            write_viewer_html(midi_path, html_path, title=midi_path.stem)
    return PipelineResult(
        tab=tab,
        note_log=note_log,
        note_count=len(notes),
        guitar_stem_path=None,
        extracted_wav_path=None,
        midi_path=midi_path,
        html_path=html_path,
        timer=timer,
    )


def detect_notes_for_engine(
    wav_path: Path, engine: str = "basic-pitch", *, analysis_sr: int = 22050
) -> list[DetectedNote]:
    """Run the chosen note detector on a WAV file, falling back to pyin if needed."""
    if engine not in ENGINES:
        raise ValueError(f"Unknown engine {engine!r}; expected one of {ENGINES}")
    if engine == "basic-pitch" and not basic_pitch_available():
        logger.warning(
            "basic-pitch (or an inference backend for it) is not installed; "
            "falling back to monophonic pyin"
        )
        engine = "pyin"
    if engine == "basic-pitch":
        return detect_notes_polyphonic(wav_path)
    y, sr = load_audio(wav_path, sample_rate=analysis_sr)
    return merge_nearby_same_pitch(detect_notes(y, sr))
