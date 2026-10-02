"""Guitar stem separation using Demucs."""

from __future__ import annotations

import logging
from contextlib import nullcontext
from pathlib import Path

logger = logging.getLogger(__name__)

# Preferred model: 6-stem htdemucs includes a dedicated "guitar" stem.
DEFAULT_MODEL = "htdemucs_6s"
# Fallback 4-stem model: guitar usually lives in "other".
FALLBACK_MODEL = "htdemucs"
GUITAR_STEM_CANDIDATES = ("guitar", "other")


def separate_guitar_stem(
    wav_path: Path,
    output_dir: Path,
    model_name: str = DEFAULT_MODEL,
    device: str = "cpu",
    timer=None,
) -> Path:
    """
    Run Demucs and return the path to the isolated guitar (or best-effort) stem WAV.

    Tries the requested model first; on failure falls back to ``htdemucs``.
    Prefers a stem named ``guitar``, else ``other``.
    """
    wav_path = Path(wav_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        return _run_demucs(wav_path, output_dir, model_name=model_name, device=device, timer=timer)
    except Exception as exc:
        if model_name != FALLBACK_MODEL:
            logger.warning(
                "Demucs model %s failed (%s); falling back to %s",
                model_name,
                exc,
                FALLBACK_MODEL,
            )
            return _run_demucs(
                wav_path, output_dir, model_name=FALLBACK_MODEL, device=device, timer=timer
            )
        raise


def _run_demucs(
    wav_path: Path,
    output_dir: Path,
    model_name: str,
    device: str,
    timer=None,
) -> Path:
    from demucs.audio import save_audio
    from demucs.separate import Separator

    stage = timer.stage if timer is not None else (lambda _name: nullcontext())
    cached = _weights_cached()
    logger.info(
        "Loading Demucs model '%s' (device=%s, weights %s)...",
        model_name,
        device,
        "cached locally" if cached else "downloading once from dl.fbaipublicfiles.com",
    )
    load_label = "demucs: load model" + ("" if cached else " (+ first-time download)")
    with stage(load_label):
        separator = Separator(
            model=model_name,
            device=device,
            shifts=1,
            split=True,
            overlap=0.25,
            progress=True,
        )

    with stage(f"demucs: separate stems ({device})"):
        _origin, stems = separator.separate_audio_file(wav_path)
    stem_names = list(stems.keys())
    logger.info("Demucs stems available: %s", stem_names)

    chosen_name = None
    for candidate in GUITAR_STEM_CANDIDATES:
        if candidate in stems:
            chosen_name = candidate
            break
    if chosen_name is None:
        for name in stem_names:
            if name not in ("vocals", "drums"):
                chosen_name = name
                break
    if chosen_name is None:
        chosen_name = stem_names[0]

    stem_tensor = stems[chosen_name].cpu()
    out_path = output_dir / f"{wav_path.stem}_{chosen_name}.wav"
    save_audio(stem_tensor, str(out_path), samplerate=separator.samplerate)
    logger.info("Wrote guitar stem (%s): %s", chosen_name, out_path)
    return out_path


def _weights_cached() -> bool:
    """True if torch.hub already holds Demucs checkpoints (best effort)."""
    try:
        import torch

        ckpt_dir = Path(torch.hub.get_dir()) / "checkpoints"
        return any(ckpt_dir.glob("*.th"))
    except Exception:
        return False
