"""Map MIDI pitches to standard-tuning guitar fretboard positions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

# Standard tuning open-string MIDI numbers (low E to high e)
# E2=40, A2=45, D3=50, G3=55, B3=59, E4=64
OPEN_STRING_MIDI = (40, 45, 50, 55, 59, 64)
STRING_NAMES = ("E", "A", "D", "G", "B", "e")  # low → high (tab is usually high→low)
MAX_FRET = 24


@dataclass(frozen=True)
class FretPosition:
    string_index: int  # 0 = low E, 5 = high e
    fret: int
    midi: int

    @property
    def string_name(self) -> str:
        return STRING_NAMES[self.string_index]


def midi_from_hz(hz: float) -> int | None:
    """Convert frequency (Hz) to nearest MIDI note number, or None if invalid."""
    if hz is None or hz <= 0:
        return None
    import math

    midi = int(round(69 + 12 * math.log2(hz / 440.0)))
    # Guitar practical range roughly E2 (40) to ~E6 (88)
    if midi < 36 or midi > 96:
        return None
    return midi


def positions_for_midi(midi: int, max_fret: int = MAX_FRET) -> list[FretPosition]:
    """All fretted positions that produce this MIDI pitch within max_fret."""
    positions: list[FretPosition] = []
    for i, open_midi in enumerate(OPEN_STRING_MIDI):
        fret = midi - open_midi
        if 0 <= fret <= max_fret:
            positions.append(FretPosition(string_index=i, fret=fret, midi=midi))
    return positions


def prefer_lower_fret(positions: Iterable[FretPosition]) -> FretPosition | None:
    """Prefer open/lower frets; on ties prefer higher strings (more natural for melody)."""
    pos_list = list(positions)
    if not pos_list:
        return None
    # Sort by fret ascending, then by string_index descending (higher string preferred for same fret)
    pos_list.sort(key=lambda p: (p.fret, -p.string_index))
    return pos_list[0]


def map_midi_to_fret(midi: int, max_fret: int = MAX_FRET) -> FretPosition | None:
    """Best single fretboard position for a MIDI pitch under standard tuning."""
    return prefer_lower_fret(positions_for_midi(midi, max_fret=max_fret))


def map_midis_to_chord(
    midis: Iterable[int], max_fret: int = MAX_FRET
) -> dict[int, int]:
    """
    Map simultaneous MIDI pitches to a chord fingering.

    Returns dict: string_index → fret. Uses a greedy approach that prefers
    lower frets and avoids putting two notes on the same string when possible.
    """
    unique = sorted(set(m for m in midis if m is not None))
    assignment: dict[int, int] = {}
    used_strings: set[int] = set()

    # Assign highest pitches first (melody/top notes tend to matter more)
    for midi in reversed(unique):
        candidates = [
            p
            for p in positions_for_midi(midi, max_fret=max_fret)
            if p.string_index not in used_strings
        ]
        best = prefer_lower_fret(candidates)
        if best is None:
            # Fall back: allow overwrite of a used string if needed
            best = prefer_lower_fret(positions_for_midi(midi, max_fret=max_fret))
        if best is not None:
            assignment[best.string_index] = best.fret
            used_strings.add(best.string_index)

    return assignment
