"""ASCII guitar tablature formatting."""

from __future__ import annotations

from .fretboard import FretPosition, map_sequence_to_frets
from .pitch import DetectedNote

# Tab display order: high e on top
TAB_STRING_ORDER = (5, 4, 3, 2, 1, 0)  # high e → low E
TAB_LABELS = {5: "e", 4: "B", 3: "G", 2: "D", 1: "A", 0: "E"}


def _chord_clusters(notes: list[DetectedNote], chord_window: float) -> list[list[DetectedNote]]:
    """Group near-simultaneous notes (within chord_window of the first)."""
    clusters: list[list[DetectedNote]] = []
    i = 0
    while i < len(notes):
        j = i + 1
        while j < len(notes) and notes[j].time - notes[i].time <= chord_window:
            j += 1
        clusters.append(notes[i:j])
        i = j
    return clusters


def tab_fingerings(
    notes: list[DetectedNote], chord_window: float = 0.05
) -> tuple[list[dict[int, int]], list[FretPosition | None]]:
    """
    Choose fingerings for the whole sequence once.

    Returns (frames, positions): the chord frames for format_ascii_tab
    (string_index → fret) and the position chosen for each note, in order.
    """
    clusters = _chord_clusters(notes, chord_window)
    silences = [0.0]
    for prev, cur in zip(clusters, clusters[1:]):
        prev_end = max(n.time + n.duration for n in prev)
        silences.append(max(0.0, cur[0].time - prev_end))
    fingerings = map_sequence_to_frets([[n.midi for n in c] for c in clusters], silences=silences)

    frames = [{p.string_index: p.fret for p in f} for f in fingerings if f]
    positions: list[FretPosition | None] = []
    for cluster, fingering in zip(clusters, fingerings):
        for n in cluster:
            positions.append(next((p for p in fingering if p.midi == n.midi), None))
    return frames, positions


def notes_to_tab_frames(
    notes: list[DetectedNote],
    chord_window: float = 0.05,
) -> list[dict[int, int]]:
    """
    Group near-simultaneous notes into chord frames.

    Each frame is string_index → fret. Fingerings are chosen for the whole
    sequence at once, so runs played in position stay in that position.
    """
    return tab_fingerings(notes, chord_window)[0]


def note_positions(
    notes: list[DetectedNote], chord_window: float = 0.05
) -> list[FretPosition | None]:
    """The fretboard position chosen for each note, in the same order as notes."""
    return tab_fingerings(notes, chord_window)[1]


def format_ascii_tab(
    frames: list[dict[int, int]],
    columns_per_bar: int = 8,
    spacer: int = 2,
) -> str:
    """
    Render frames as ASCII tablature.

    Example:
        e|--0-----2--|
        B|--1-----3--|
        ...
    """
    if not frames:
        return _empty_tab_message()

    col_widths: list[int] = []
    for frame in frames:
        max_digits = max((len(str(f)) for f in frame.values()), default=1)
        col_widths.append(max(max_digits, 1))

    lines: dict[int, list[str]] = {s: [] for s in TAB_STRING_ORDER}
    for idx, frame in enumerate(frames):
        w = col_widths[idx]
        for s in TAB_STRING_ORDER:
            if s in frame:
                token = str(frame[s]).ljust(w, "-")
            else:
                token = "-" * w
            lines[s].append(token)
            lines[s].append("-" * spacer)

    out_lines: list[str] = []
    for s in TAB_STRING_ORDER:
        parts = lines[s]
        chunks: list[str] = []
        note_idx = 0
        i = 0
        current = ""
        while i < len(parts):
            current += parts[i]
            if i + 1 < len(parts):
                current += parts[i + 1]
            note_idx += 1
            i += 2
            if note_idx % columns_per_bar == 0:
                chunks.append(current)
                current = ""
        if current:
            chunks.append(current)
        body = "|".join(chunks)
        out_lines.append(f"{TAB_LABELS[s]}|{body}|")

    return "\n".join(out_lines)


def _empty_tab_message() -> str:
    blank = "\n".join(f"{TAB_LABELS[s]}|----------|" for s in TAB_STRING_ORDER)
    return blank + "\n(no notes detected)"


def format_note_log(
    notes: list[DetectedNote], positions: list[FretPosition | None] | None = None
) -> str:
    """
    Human-readable note list for debugging. Pass the positions from
    tab_fingerings to show exactly what the tab shows.
    """
    if positions is None:
        positions = note_positions(notes)
    rows = ["#  time    dur     Hz     MIDI  fretboard"]
    for i, (n, pos) in enumerate(zip(notes, positions)):
        pos_str = f"{pos.string_name}{pos.fret}" if pos else "?"
        rows.append(
            f"{i:02d} {n.time:6.2f}  {n.duration:5.2f}  {n.hz:7.1f}  {n.midi:4d}  {pos_str}"
        )
    return "\n".join(rows)
