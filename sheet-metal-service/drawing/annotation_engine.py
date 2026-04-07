"""
Annotation engine — bend labels, direction arrows, and notes on the flat pattern.
"""

from __future__ import annotations

from typing import Callable, Tuple, List

from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.pdfgen.canvas import Canvas

from config import COLOR_BEND_LINE, COLOR_BEND_DOWN_LINE
from core.unfolder import FlatPattern


def draw_annotations(
    c: Canvas,
    flat: FlatPattern,
    to_pdf: Callable[[float, float], Tuple[float, float]],
    scale: float,
) -> None:
    """Draw bend labels and direction arrows on the flat pattern view."""
    for bl in flat.bend_lines:
        bi = bl.bend_info
        color = HexColor(COLOR_BEND_LINE if bi.direction == "UP" else COLOR_BEND_DOWN_LINE)

        # Bend line (red/blue dashed)
        x1, y1 = to_pdf(bl.start[0], bl.start[1])
        x2, y2 = to_pdf(bl.end[0], bl.end[1])

        c.setStrokeColor(color)
        c.setLineWidth(1.0)
        c.setDash(4, 3)
        c.line(x1, y1, x2, y2)
        c.setDash()

        # Label above bend line
        px, py = to_pdf(bl.start[0], flat.height)
        arrow = "\u2191" if bi.direction == "UP" else "\u2193"
        label = f"B{bi.bend_id}: {bi.angle_deg:.0f}\u00b0{arrow}"

        c.setFont("Helvetica-Bold", 7)
        c.setFillColor(color)
        c.drawCentredString(px, py + 4 * mm, label)

        # Radius callout
        c.setFont("Helvetica", 6)
        c.drawCentredString(px, py + 1.5 * mm, f"R{bi.inner_radius:.1f}")

        # Small direction triangle at mid-height of bend line
        mid_y = (y1 + y2) / 2
        _draw_arrow_triangle(c, px, mid_y, bi.direction, color)


def _draw_arrow_triangle(
    c: Canvas, x: float, y: float, direction: str, color
) -> None:
    """Small filled triangle indicating bend direction."""
    size = 2.0 * mm
    c.setFillColor(color)
    p = c.beginPath()
    if direction == "UP":
        p.moveTo(x, y + size)
        p.lineTo(x - size * 0.6, y - size * 0.5)
        p.lineTo(x + size * 0.6, y - size * 0.5)
    else:
        p.moveTo(x, y - size)
        p.lineTo(x - size * 0.6, y + size * 0.5)
        p.lineTo(x + size * 0.6, y + size * 0.5)
    p.close()
    c.drawPath(p, fill=1, stroke=0)
