"""ASCII guitar tablature formatting."""

from __future__ import annotations

from .fretboard import map_midi_to_fret, map_midis_to_chord
from .pitch import DetectedNote

# Tab display order: high e on top
TAB_STRING_ORDER = (5, 4, 3, 2, 1, 0)  # high e → low E
TAB_LABELS = {5: "e", 4: "B", 3: "G", 2: "D", 1: "A", 0: "E"}


def notes_to_tab_frames(
    notes: list[DetectedNote],
    chord_window: float = 0.05,
) -> list[dict[int, int]]:
    """
    Group near-simultaneous notes into chord frames.

    Each frame is string_index → fret. Detection is primarily monophonic, so
    most frames will have a single note; grouping still helps with clusters.
    """
    if not notes:
        return []

    frames: list[dict[int, int]] = []
    i = 0
    while i < len(notes):
        cluster = [notes[i]]
        j = i + 1
        while j < len(notes) and notes[j].time - cluster[0].time <= chord_window:
            cluster.append(notes[j])
            j += 1

        midis = [n.midi for n in cluster]
        if len(midis) == 1:
            pos = map_midi_to_fret(midis[0])
            frame = {pos.string_index: pos.fret} if pos else {}
        else:
            frame = map_midis_to_chord(midis)
        if frame:
            frames.append(frame)
        i = j
    return frames


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


def format_note_log(notes: list[DetectedNote]) -> str:
    """Human-readable note list for debugging."""
    rows = ["#  time    dur     Hz     MIDI  fretboard"]
    for i, n in enumerate(notes):
        pos = map_midi_to_fret(n.midi)
        pos_str = f"{pos.string_name}{pos.fret}" if pos else "?"
        rows.append(
            f"{i:02d} {n.time:6.2f}  {n.duration:5.2f}  {n.hz:7.1f}  {n.midi:4d}  {pos_str}"
        )
    return "\n".join(rows)
