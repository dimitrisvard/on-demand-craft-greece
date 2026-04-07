"""
Final PDF assembly — combines all drawing elements into a professional
bending shop drawing.
"""

from __future__ import annotations

import io
from typing import Optional, List

from reportlab.lib.pagesizes import landscape
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.pdfgen.canvas import Canvas

from OCP.TopoDS import TopoDS_Shape

from config import COLOR_HEADER_BG, COLOR_ACCENT, COLOR_BORDER, COLOR_TEXT_DARK, COLOR_BEND_LINE
from core.unfolder import FlatPattern
from core.bend_detector import BendInfo
from drawing.sheet_layout import compute_layout, Rect
from drawing.title_block import draw_title_block
from drawing.bend_table import draw_bend_table
from drawing.isometric_view import draw_isometric_view, draw_part_info
from drawing.dimension_engine import draw_dimensions
from drawing.annotation_engine import draw_annotations


def generate_pdf(
    flat: FlatPattern,
    bends: List[BendInfo],
    thickness: float,
    k_factor: float,
    part_name: str = "Part",
    material: str = "Steel",
    drawing_size: str = "A3",
    shape: Optional[TopoDS_Shape] = None,
    iso_png_path: Optional[str] = None,
    bbox_3d: Optional[dict] = None,
) -> bytes:
    """
    Generate a complete bending shop drawing PDF.

    Returns the PDF as bytes (suitable for StreamingResponse).
    """
    layout = compute_layout(drawing_size=drawing_size, num_bends=len(bends))
    page_w, page_h = layout.page_size

    buf = io.BytesIO()
    c = Canvas(buf, pagesize=layout.page_size)

    # ── Header ─────────────────────────────────────────────────────────────
    _draw_header(c, layout.header, part_name)

    # ── Isometric view ─────────────────────────────────────────────────────
    draw_isometric_view(c, layout.isometric_view, shape=shape, iso_png_path=iso_png_path)

    # ── Part info ──────────────────────────────────────────────────────────
    draw_part_info(
        c, layout.part_info,
        part_name=part_name,
        material=material,
        thickness=thickness,
        num_bends=len(bends),
        flat_width=flat.width,
        flat_height=flat.height,
        bbox_3d=bbox_3d or {},
    )

    # ── Flat pattern view ──────────────────────────────────────────────────
    _draw_flat_pattern_section(c, layout.flat_pattern, flat, bends)

    # ── Bend table ─────────────────────────────────────────────────────────
    draw_bend_table(
        c, layout.bend_table,
        bends=bends,
        thickness=thickness,
        k_factor=k_factor,
        material=material,
        flat_width=flat.width,
        flat_height=flat.height,
    )

    # ── Title block ────────────────────────────────────────────────────────
    # Compute scale text
    scale_text = _compute_scale(flat, layout.flat_pattern)
    draw_title_block(
        c, layout.title_block,
        part_name=part_name,
        material=material,
        thickness=thickness,
        flat_width=flat.width,
        flat_height=flat.height,
        num_bends=len(bends),
        scale_text=scale_text,
    )

    c.save()
    return buf.getvalue()


# ── Section renderers ──────────────────────────────────────────────────────


def _draw_header(c: Canvas, rect: Rect, part_name: str) -> None:
    x, y, w, h = rect.x, rect.y, rect.w, rect.h
    c.setFillColor(HexColor(COLOR_HEADER_BG))
    c.roundRect(x, y, w, h, 3, stroke=0, fill=1)

    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(x + 6 * mm, y + h - 7 * mm, "MICRONS HUB")
    c.setFont("Helvetica", 7)
    c.drawString(x + 6 * mm, y + 3 * mm, "micronshub.eu")

    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(x + w - 6 * mm, y + h - 7 * mm, "BENDING SHOP DRAWING")
    c.setFont("Helvetica", 8)
    c.drawRightString(x + w - 6 * mm, y + 3 * mm, f"Part: {part_name}")


def _draw_flat_pattern_section(
    c: Canvas,
    rect: Rect,
    flat: FlatPattern,
    bends: List[BendInfo],
) -> None:
    """Draw the flat pattern view with outline, bend lines, dimensions, annotations."""
    x, y, w, h = rect.x, rect.y, rect.w, rect.h

    # Section border
    c.saveState()
    c.setStrokeColor(HexColor(COLOR_BORDER))
    c.setLineWidth(0.5)
    c.roundRect(x, y, w, h, 3, stroke=1, fill=0)
    c.setFont("Helvetica-Bold", 8)
    c.setFillColor(HexColor(COLOR_ACCENT))
    c.drawString(x + 4 * mm, y + h - 8 * mm, "FLAT PATTERN WITH DIMENSIONS")
    c.restoreState()

    if flat.width <= 0 or flat.height <= 0:
        c.setFont("Helvetica", 10)
        c.setFillColor(HexColor("#808080"))
        c.drawCentredString(x + w / 2, y + h / 2, "Flat pattern not available")
        return

    # Compute scale and positioning
    margin_x = 35 * mm
    margin_y_bot = 25 * mm
    margin_y_top = 15 * mm
    draw_w = w - 2 * margin_x
    draw_h = h - margin_y_bot - margin_y_top

    scale = min(draw_w / (flat.width * mm), draw_h / (flat.height * mm))
    scale = min(scale, 1.5)

    pattern_w = flat.width * mm * scale
    pattern_h = flat.height * mm * scale
    offset_x = x + (w - pattern_w) / 2
    offset_y = y + margin_y_bot + (draw_h - pattern_h) / 2

    def to_pdf(x_mm, y_mm):
        return (offset_x + x_mm * mm * scale,
                offset_y + y_mm * mm * scale)

    # Light fill
    c.setFillColor(HexColor("#F8F9FA"))
    px, py = to_pdf(0, 0)
    c.rect(px, py, pattern_w, pattern_h, stroke=0, fill=1)

    # Outline
    c.setStrokeColor(HexColor(COLOR_TEXT_DARK))
    c.setLineWidth(1.2)
    for edge in flat.outer_edges:
        p1 = to_pdf(edge.start[0], edge.start[1])
        p2 = to_pdf(edge.end[0], edge.end[1])
        c.line(p1[0], p1[1], p2[0], p2[1])

    # Holes
    for hole in flat.holes:
        if hole.center and hole.diameter:
            cx, cy = to_pdf(hole.center[0], hole.center[1])
            r = hole.diameter / 2 * mm * scale
            c.setStrokeColor(HexColor("#27AE60"))
            c.setLineWidth(0.8)
            c.circle(cx, cy, max(r, 0.5), stroke=1, fill=0)
            # Centre cross
            ext = r + 2 * mm
            c.setDash(3, 2)
            c.setStrokeColor(HexColor("#F39C12"))
            c.setLineWidth(0.3)
            c.line(cx - ext, cy, cx + ext, cy)
            c.line(cx, cy - ext, cx, cy + ext)
            c.setDash()

    # Bend lines + annotations
    draw_annotations(c, flat, to_pdf, scale)

    # Dimensions
    draw_dimensions(c, flat, to_pdf, scale, offset_x, offset_y, pattern_w, pattern_h)


def _compute_scale(flat: FlatPattern, rect: Rect) -> str:
    """Determine the drawing scale text."""
    if flat.width <= 0 or flat.height <= 0:
        return "NTS"

    draw_w = rect.w - 70 * mm
    draw_h = rect.h - 40 * mm
    s = min(draw_w / (flat.width * mm), draw_h / (flat.height * mm))

    preferred = [0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0]
    best = min(preferred, key=lambda p: abs(p - s))

    if best >= 1.0:
        return f"{best:.0f}:1"
    else:
        return f"1:{1 / best:.0f}"
