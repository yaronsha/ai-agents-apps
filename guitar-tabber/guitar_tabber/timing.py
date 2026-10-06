"""Per-stage wall-clock timing for the pipeline."""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager

logger = logging.getLogger(__name__)


class StageTimer:
    """Collects (stage, seconds); logs each stage as it finishes."""

    def __init__(self) -> None:
        self.stages: list[tuple[str, float]] = []

    @contextmanager
    def stage(self, name: str):
        start = time.perf_counter()
        try:
            yield
        finally:
            elapsed = time.perf_counter() - start
            self.stages.append((name, elapsed))
            logger.info("⏱ %s: %s", name, format_seconds(elapsed))

    @property
    def total(self) -> float:
        return sum(s for _, s in self.stages)

    def report(self) -> str:
        if not self.stages:
            return ""
        total = self.total or 1e-9
        width = max(len(name) for name, _ in self.stages)
        lines = ["Timing:"]
        for name, secs in self.stages:
            lines.append(f"  {name:<{width}}  {format_seconds(secs):>8}  {secs / total * 100:4.0f}%")
        lines.append(f"  {'total':<{width}}  {format_seconds(self.total):>8}")
        return "\n".join(lines)


def format_seconds(secs: float) -> str:
    if secs < 60:
        return f"{secs:.1f}s"
    minutes, secs = divmod(secs, 60)
    return f"{int(minutes)}m{secs:04.1f}s"
