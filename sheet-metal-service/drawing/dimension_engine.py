"""
Auto-dimensioning engine for the flat pattern view on the PDF drawing.

Draws:
- Overall width/height dimensions
- Edge-to-bend and bend-to-bend dimension chains
- Hole diameter callouts
"""

from __future__ import annotations

from typing import List, Callable, Tuple

from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.pdfgen.canvas import Canvas

from config import COLOR_DIMENSION
from core.unfolder import FlatPattern


def draw_dimensions(
    c: Canvas,
    flat: FlatPattern,
    to_pdf: Callable[[float, float], Tuple[float, float]],
    scale: float,
    offset_x: float,
    offset_y: float,
    pattern_w: float,
    pattern_h: float,
) -> None:
    """
    Draw all dimensions on the flat pattern view.

    Parameters
    ----------
    c : reportlab Canvas
    flat : FlatPattern result
    to_pdf : callable(x_mm, y_mm) → (pdf_x, pdf_y)
    scale : drawing scale factor
    offset_x, offset_y : pattern origin on the canvas
    pattern_w, pattern_h : scaled pattern dimensions
    """
    color = HexColor(COLOR_DIMENSION)

    # ── Dimension chain below the pattern ──────────────────────────────────
    if flat.bend_lines:
        dim_y = offset_y - 8 * mm

        # Collect dimension breakpoints
        points_mm = [0.0]
        for bl in flat.bend_lines:
            points_mm.append(bl.start[0])
        points_mm.append(flat.width)

        for i in range(len(points_mm) - 1):
            left = points_mm[i]
            right = points_mm[i + 1]
            value = right - left
            if value < 0.5:
                continue

            x1, _ = to_pdf(left, 0)
            x2, _ = to_pdf(right, 0)
            _draw_h_dim(c, x1, x2, dim_y, offset_y, f"{value:.1f}", color)

        # Overall width below the chain
        x1, _ = to_pdf(0, 0)
        x2, _ = to_pdf(flat.width, 0)
        overall_y = dim_y - 7 * mm
        _draw_h_dim(c, x1, x2, overall_y, dim_y - 2 * mm,
                    f"{flat.width:.1f}", color, font_size=8)

    else:
        # No bends — just overall width
        x1, _ = to_pdf(0, 0)
        x2, _ = to_pdf(flat.width, 0)
        dim_y = offset_y - 8 * mm
        _draw_h_dim(c, x1, x2, dim_y, offset_y, f"{flat.width:.1f}", color, font_size=8)

    # ── Overall height on the right ────────────────────────────────────────
    _, y1 = to_pdf(flat.width, 0)
    _, y2 = to_pdf(flat.width, flat.height)
    dim_x = offset_x + pattern_w + 8 * mm
    _draw_v_dim(c, dim_x, y1, y2, offset_x + pattern_w,
                f"{flat.height:.1f}", color)

    # ── Hole callouts ──────────────────────────────────────────────────────
    for hole in flat.holes:
        if hole.center and hole.diameter:
            px, py = to_pdf(hole.center[0], hole.center[1])
            c.setFont("Helvetica", 6)
            c.setFillColor(color)
            c.drawString(px + 3 * mm, py + 2 * mm, f"\u2300{hole.diameter:.1f}")


def _draw_h_dim(
    c: Canvas,
    x1: float, x2: float,
    dim_y: float, ext_top: float,
    text: str, color, font_size: float = 7,
) -> None:
    """Horizontal dimension with extension lines and arrows."""
    c.saveState()
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(0.5)

    ext_bottom = dim_y - 2 * mm
    c.line(x1, ext_top, x1, ext_bottom)
    c.line(x2, ext_top, x2, ext_bottom)
    c.line(x1, dim_y, x2, dim_y)

    # Arrowheads
    al = 2.5 * mm
    aw = 0.8 * mm
    for px, sign in [(x1, 1), (x2, -1)]:
        p = c.beginPath()
        p.moveTo(px, dim_y)
        p.lineTo(px + sign * al, dim_y + aw)
        p.lineTo(px + sign * al, dim_y - aw)
        p.close()
        c.drawPath(p, fill=1, stroke=0)

    mid = (x1 + x2) / 2
    c.setFont("Helvetica-Bold", font_size)
    c.drawCentredString(mid, dim_y + 1.5 * mm, text)
    c.restoreState()


def _draw_v_dim(
    c: Canvas,
    dim_x: float, y1: float, y2: float,
    ext_left: float,
    text: str, color, font_size: float = 7,
) -> None:
    """Vertical dimension with extension lines and arrows."""
    c.saveState()
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(0.5)

    ext_right = dim_x + 2 * mm
    c.line(ext_left, y1, ext_right, y1)
    c.line(ext_left, y2, ext_right, y2)
    c.line(dim_x, y1, dim_x, y2)

    al = 2.5 * mm
    aw = 0.8 * mm
    for py, sign in [(y1, 1), (y2, -1)]:
        p = c.beginPath()
        p.moveTo(dim_x, py)
        p.lineTo(dim_x + aw, py + sign * al)
        p.lineTo(dim_x - aw, py + sign * al)
        p.close()
        c.drawPath(p, fill=1, stroke=0)

    mid_y = (y1 + y2) / 2
    c.saveState()
    c.translate(dim_x + 3 * mm, mid_y)
    c.rotate(90)
    c.setFont("Helvetica-Bold", font_size)
    c.drawCentredString(0, 0, text)
    c.restoreState()
    c.restoreState()
