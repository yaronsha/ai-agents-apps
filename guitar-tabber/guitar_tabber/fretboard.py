"""Map MIDI pitches to standard-tuning guitar fretboard positions."""

from __future__ import annotations

from dataclasses import dataclass
from itertools import product
from typing import Iterable, Sequence

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


# --- Sequence-level fingering (hand position aware) -------------------------
#
# Choosing each note's lowest fret on its own ignores where the hand is, so a
# run played in 5th position comes out as open-position tab. Instead we pick
# fingerings for the whole sequence with Viterbi: each state is a fingering
# plus a hand position (the fret under the index finger), and the path cost
# rewards staying in one position and on nearby strings, and penalises shifts,
# stretches and high frets.

HAND_SPAN = 3  # frets reachable without stretching: [hand, hand + 3]
MAX_STRETCH = 1  # one extra fret is allowed, at a cost
SHIFT_COST = 2.0  # any change of hand position
MOVE_COST = 0.5  # per fret the hand moves
STRING_COST = 0.05  # per string the picking hand crosses between frames
FRET_COST = 0.2  # per fretted (non-open) note
HEIGHT_COST = 0.03  # per fret number of each fretted note
STRETCH_COST = 1.5
OPEN_IN_POSITION_COST = 0.6  # open string while the hand is up the neck
REST_GAP = 0.3  # seconds of silence that leave time to shift freely
REST_SHIFT_DISCOUNT = 0.1  # shift and move costs are scaled by this after a rest
OPEN_SHIFT_SCALE = 0.6  # ...and by this after open strings only (the hand is free)
MAX_CHORD_CANDIDATES = 24

Fingering = tuple[FretPosition, ...]


def _chord_fingerings(midis: Sequence[int], max_fret: int) -> list[Fingering]:
    """Playable fingerings of simultaneous pitches, one string per pitch."""
    options = [positions_for_midi(m, max_fret=max_fret) for m in midis]
    out = []
    for combo in product(*options):
        strings = {p.string_index for p in combo}
        if len(strings) != len(combo):
            continue
        fretted = [p.fret for p in combo if p.fret > 0]
        if fretted and max(fretted) - min(fretted) > HAND_SPAN + MAX_STRETCH:
            continue
        out.append(combo)
    out.sort(key=lambda c: (max(p.fret for p in c), sum(p.fret for p in c)))
    return out[:MAX_CHORD_CANDIDATES]


def _frame_candidates(midis: Sequence[int], max_fret: int) -> list[Fingering]:
    # Pitches with no fret position (e.g. stray bass bleed) can't be tabbed;
    # drop them so they don't make the rest of the chord unplayable.
    unique = sorted(m for m in set(midis) if positions_for_midi(m, max_fret=max_fret))
    if not unique:
        return []
    if len(unique) == 1:
        return [(p,) for p in positions_for_midi(unique[0], max_fret=max_fret)]
    if len(unique) <= len(OPEN_STRING_MIDI):
        cands = _chord_fingerings(unique, max_fret)
        if cands:
            return cands
    # Unplayable as one shape (too many notes or too wide): keep the greedy chord
    greedy = map_midis_to_chord(unique, max_fret=max_fret)
    if not greedy:
        return []
    return [
        tuple(FretPosition(s, f, OPEN_STRING_MIDI[s] + f) for s, f in sorted(greedy.items()))
    ]


def _hand_options(
    fingering: Fingering, max_fret: int, free_hands: Iterable[int]
) -> list[tuple[int, float]]:
    """
    (hand position, static cost) pairs under which this fingering is playable.

    Open strings only need no hand, so such a fingering just keeps one of
    free_hands (the positions the hand may be in from the previous frame).
    """
    fretted = [p.fret for p in fingering if p.fret > 0]
    n_open = len(fingering) - len(fretted)
    base = sum(FRET_COST + HEIGHT_COST * f for f in fretted)
    if fretted:
        top = max(1, max_fret - HAND_SPAN)
        lo, hi = min(fretted), max(fretted)
        hands = range(max(1, hi - HAND_SPAN - MAX_STRETCH), min(lo, top) + 1)
        if not hands:  # wider than any hand: emit it anyway, expensively
            return [(lo, base + 4 * STRETCH_COST)]
    else:
        hands = free_hands
    out = []
    for h in hands:
        cost = base
        if fretted and max(fretted) > h + HAND_SPAN:
            cost += STRETCH_COST
        if n_open and h > HAND_SPAN + 1:
            cost += OPEN_IN_POSITION_COST * n_open
        out.append((h, cost))
    return out


def _mean_string(fingering: Fingering) -> float:
    return sum(p.string_index for p in fingering) / len(fingering)


def map_sequence_to_frets(
    frames: Sequence[Sequence[int]],
    silences: Sequence[float] | None = None,
    max_fret: int = MAX_FRET,
) -> list[Fingering]:
    """
    Choose fingerings for a sequence of frames (each a list of simultaneous
    MIDI pitches), minimising hand movement over the whole sequence.

    silences (seconds, one per frame) are optional: the silence before each
    frame, from the end of the previous notes to this onset. A long silence
    makes a position shift there cheap, since the hand has time to move.

    Returns one tuple of FretPositions per frame, empty for unplayable frames.
    """
    if silences is not None and len(silences) != len(frames):
        raise ValueError(f"got {len(silences)} silences for {len(frames)} frames")

    # States per frame: (fingering, hand position, static cost)
    layers: list[list[tuple[Fingering, int, float]]] = []
    for midis in frames:
        free_hands = sorted({h for _, h, _ in layers[-1]}) if layers and layers[-1] else [1]
        layers.append([
            (fingering, h, c)
            for fingering in _frame_candidates(midis, max_fret)
            for h, c in _hand_options(fingering, max_fret, free_hands)
        ])

    result: list[Fingering] = [()] * len(frames)
    start = 0
    while start < len(layers):
        # Run Viterbi over each stretch of playable frames
        if not layers[start]:
            start += 1
            continue
        end = start
        while end < len(layers) and layers[end]:
            end += 1

        cost = [c for _, _, c in layers[start]]
        back: list[list[int]] = []
        for k in range(start + 1, end):
            rest = silences is not None and silences[k] >= REST_GAP
            shift_scale = REST_SHIFT_DISCOUNT if rest else 1.0
            prev = [
                (h, _mean_string(f), all(p.fret == 0 for p in f), cost[j])
                for j, (f, h, _) in enumerate(layers[k - 1])
            ]
            new_cost, ptr = [], []
            for fingering, h, c in layers[k]:
                s = _mean_string(fingering)
                best_j, best_v = 0, float("inf")
                for j, (ph, ps, p_open, pc) in enumerate(prev):
                    v = pc + STRING_COST * abs(ps - s)
                    if ph != h:
                        scale = shift_scale * (OPEN_SHIFT_SCALE if p_open else 1.0)
                        v += scale * (SHIFT_COST + MOVE_COST * abs(ph - h))
                    if v < best_v:
                        best_j, best_v = j, v
                new_cost.append(best_v + c)
                ptr.append(best_j)
            cost = new_cost
            back.append(ptr)

        idx = min(range(len(cost)), key=cost.__getitem__)
        for k in range(end - 1, start - 1, -1):
            result[k] = layers[k][idx][0]
            if k > start:
                idx = back[k - start - 1][idx]
        start = end
    return result
