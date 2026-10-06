"""End-to-end: mix → (optional) stem separation → pitch → tablature."""

from __future__ import annotations

import logging
import tempfile
from dataclasses import dataclass
from pathlib import Path

from .audio import extract_mono_wav, load_audio, write_wav
from .pitch import DetectedNote, detect_notes, merge_nearby_same_pitch
from .polyphonic import basic_pitch_available, detect_notes_polyphonic
from .separation import separate_guitar_stem
from .tab import format_ascii_tab, format_note_log, notes_to_tab_frames

logger = logging.getLogger(__name__)

ENGINES = ("basic-pitch", "pyin")


@dataclass
class PipelineResult:
    tab: str
    note_log: str
    note_count: int
    guitar_stem_path: Path | None
    extracted_wav_path: Path | None


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
) -> PipelineResult:
    """
    Convert an MP3/MP4 (full mix or isolated guitar) into ASCII guitar tablature.
    """
    if engine not in ENGINES:
        raise ValueError(f"Unknown engine {engine!r}; expected one of {ENGINES}")
    input_path = Path(input_path)
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
        extract_mono_wav(input_path, extracted, sample_rate=44100)

        # 2. Stem separation (unless skipped)
        guitar_wav: Path
        kept_stem: Path | None = None
        if skip_separation:
            logger.info("Skipping stem separation (--skip-separation)")
            guitar_wav = extracted
        else:
            stems_dir = work_dir / "stems"
            guitar_wav = separate_guitar_stem(
                extracted, stems_dir, model_name=demucs_model, device=device
            )
            if keep_stems:
                dest = input_path.with_name(f"{input_path.stem}_guitar_stem.wav")
                dest.write_bytes(guitar_wav.read_bytes())
                kept_stem = dest
                logger.info("Saved guitar stem to %s", dest)

        # 3. Note detection: polyphonic (chords, fingerpicking) or monophonic pyin
        notes = detect_notes_for_engine(guitar_wav, engine, analysis_sr=analysis_sr)

        # 4. Map to frets and format tab
        frames = notes_to_tab_frames(notes)
        tab = format_ascii_tab(frames)
        note_log = format_note_log(notes)

        if output_tab_path is None:
            output_tab_path = input_path.with_suffix(".tab.txt")
        output_tab_path = Path(output_tab_path)
        output_tab_path.write_text(tab + "\n\n" + note_log + "\n", encoding="utf-8")
        logger.info("Wrote tablature to %s", output_tab_path)

        return PipelineResult(
            tab=tab,
            note_log=note_log,
            note_count=len(notes),
            guitar_stem_path=kept_stem,
            extracted_wav_path=extracted if keep_stems else None,
        )
    finally:
        if own_tmpdir is not None:
            own_tmpdir.cleanup()


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
