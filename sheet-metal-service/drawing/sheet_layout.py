"""
Drawing sheet layout engine — positions views, tables, and title block
on an A3 (or A4) landscape sheet.

Dynamically adjusts zone sizes based on content.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Tuple

from reportlab.lib.pagesizes import A3, A4, landscape
from reportlab.lib.units import mm


@dataclass
class Rect:
    """A rectangular zone on the drawing sheet (in PDF points)."""
    x: float
    y: float
    w: float
    h: float


@dataclass
class SheetLayout:
    """Computed zones for a single drawing sheet."""
    page_size: Tuple[float, float]
    margin: float

    header: Rect = field(default_factory=lambda: Rect(0, 0, 0, 0))
    isometric_view: Rect = field(default_factory=lambda: Rect(0, 0, 0, 0))
    part_info: Rect = field(default_factory=lambda: Rect(0, 0, 0, 0))
    flat_pattern: Rect = field(default_factory=lambda: Rect(0, 0, 0, 0))
    bend_table: Rect = field(default_factory=lambda: Rect(0, 0, 0, 0))
    title_block: Rect = field(default_factory=lambda: Rect(0, 0, 0, 0))


def compute_layout(
    drawing_size: str = "A3",
    num_bends: int = 0,
) -> SheetLayout:
    """
    Compute the drawing sheet layout.

    Parameters
    ----------
    drawing_size : "A3" | "A4"
    num_bends : number of bends (affects bend table height)
    """
    page = landscape(A3) if drawing_size.upper() == "A3" else landscape(A4)
    page_w, page_h = page

    m = 8 * mm  # margin
    gap = 3 * mm
    content_w = page_w - 2 * m
    content_h = page_h - 2 * m

    layout = SheetLayout(page_size=page, margin=m)

    # ── Header ─────────────────────────────────────────────────────────────
    header_h = 18 * mm
    y_cursor = page_h - m
    layout.header = Rect(m, y_cursor - header_h, content_w, header_h)
    y_cursor -= header_h + gap

    # ── Top row: isometric (left 40 %) + part info (right 60 %) ────────────
    top_row_h = 55 * mm
    iso_w = content_w * 0.40
    info_w = content_w * 0.60 - gap

    layout.isometric_view = Rect(m, y_cursor - top_row_h, iso_w, top_row_h)
    layout.part_info = Rect(m + iso_w + gap, y_cursor - top_row_h, info_w, top_row_h)
    y_cursor -= top_row_h + gap

    # ── Title block (fixed at bottom) ──────────────────────────────────────
    title_h = 14 * mm
    layout.title_block = Rect(m, m, content_w, title_h)

    # ── Bend table (above title block) ─────────────────────────────────────
    bend_table_h = _bend_table_height(num_bends)
    bt_y = m + title_h + gap
    layout.bend_table = Rect(m, bt_y, content_w, bend_table_h)

    # ── Flat pattern (remaining space) ─────────────────────────────────────
    flat_y = bt_y + bend_table_h + gap
    flat_h = y_cursor - flat_y
    flat_h = max(flat_h, 50 * mm)
    layout.flat_pattern = Rect(m, flat_y, content_w, flat_h)

    return layout


def _bend_table_height(num_bends: int) -> float:
    if num_bends == 0:
        return 0
    header_h = 8 * mm
    row_h = 6 * mm
    label_h = 10 * mm  # section title
    footer_h = 20 * mm  # summary line below table
    return label_h + header_h + row_h * num_bends + footer_h
