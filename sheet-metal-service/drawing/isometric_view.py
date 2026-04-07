"""
Isometric 3D view renderer for the PDF drawing.

Uses OCC HLR projection (via export/projection.py) to generate an SVG,
then rasterises it to a PNG for embedding in the PDF.
Fallback: draws a wireframe bounding box.
"""

from __future__ import annotations

import io
import os
import tempfile
from typing import Optional

from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas

from OCP.TopoDS import TopoDS_Shape

from config import COLOR_ACCENT, COLOR_BORDER
from drawing.sheet_layout import Rect
from export.projection import project_isometric_svg


def draw_isometric_view(
    c: Canvas,
    rect: Rect,
    shape: Optional[TopoDS_Shape] = None,
    iso_png_path: Optional[str] = None,
) -> None:
    """
    Draw the isometric 3D view panel.

    If *iso_png_path* is provided and exists, embed it directly.
    Otherwise, generate an SVG projection from *shape* and embed it.
    """
    x, y, w, h = rect.x, rect.y, rect.w, rect.h
    _draw_section_border(c, x, y, w, h, "ISOMETRIC VIEW")

    inner_x = x + 3 * mm
    inner_y = y + 3 * mm
    inner_w = w - 6 * mm
    inner_h = h - 12 * mm

    # Try pre-rendered PNG
    if iso_png_path and os.path.isfile(iso_png_path):
        try:
            _embed_image(c, iso_png_path, inner_x, inner_y, inner_w, inner_h)
            return
        except Exception:
            pass

    # Try OCC HLR projection → SVG → embed via svglib
    if shape is not None:
        try:
            svg_str = project_isometric_svg(shape, int(inner_w), int(inner_h))
            _embed_svg_string(c, svg_str, inner_x, inner_y, inner_w, inner_h)
            return
        except Exception:
            pass

    # Placeholder
    c.setFont("Helvetica", 9)
    c.setFillColor(HexColor("#808080"))
    c.drawCentredString(inner_x + inner_w / 2, inner_y + inner_h / 2,
                        "3D view not available")


def draw_part_info(
    c: Canvas,
    rect: Rect,
    part_name: str,
    material: str,
    thickness: float,
    num_bends: int,
    flat_width: float,
    flat_height: float,
    bbox_3d: dict,
) -> None:
    """Draw the part information panel."""
    x, y, w, h = rect.x, rect.y, rect.w, rect.h
    _draw_section_border(c, x, y, w, h, "PART INFORMATION")

    info_items = [
        ("Part Name", part_name),
        ("Material", material),
        ("Thickness", f"{thickness:.2f} mm"),
        ("Number of Bends", str(num_bends)),
        ("Flat Pattern", f"{flat_width:.1f} \u00d7 {flat_height:.1f} mm"),
        ("3D Bounding Box",
         f'{bbox_3d.get("x", 0):.1f} \u00d7 {bbox_3d.get("y", 0):.1f} '
         f'\u00d7 {bbox_3d.get("z", 0):.1f} mm'),
    ]

    label_x = x + 6 * mm
    value_x = x + 45 * mm
    row_y = y + h - 16 * mm
    row_spacing = 7 * mm

    for label, value in info_items:
        c.setFont("Helvetica", 7)
        c.setFillColor(HexColor("#4A4A5A"))
        c.drawString(label_x, row_y, f"{label}:")

        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(HexColor("#1A1A2E"))
        c.drawString(value_x, row_y, value)
        row_y -= row_spacing


# ── Helpers ────────────────────────────────────────────────────────────────

def _draw_section_border(c, x, y, w, h, title=""):
    c.saveState()
    c.setStrokeColor(HexColor(COLOR_BORDER))
    c.setLineWidth(0.5)
    c.roundRect(x, y, w, h, 3, stroke=1, fill=0)
    if title:
        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(HexColor(COLOR_ACCENT))
        c.drawString(x + 4 * mm, y + h - 8 * mm, title)
    c.restoreState()


def _embed_image(c, path, x, y, w, h):
    img = ImageReader(path)
    iw, ih = img.getSize()
    aspect = iw / ih
    dw = w
    dh = dw / aspect
    if dh > h:
        dh = h
        dw = dh * aspect
    ix = x + (w - dw) / 2
    iy = y + (h - dh) / 2
    c.drawImage(path, ix, iy, dw, dh, preserveAspectRatio=True)


def _embed_svg_string(c, svg_str, x, y, w, h):
    """Try to render SVG string into the PDF using svglib."""
    try:
        from svglib.svglib import renderSVG
        from reportlab.graphics import renderPDF
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".svg", mode="w", delete=False) as f:
            f.write(svg_str)
            f.flush()
            drawing = renderSVG.render(f.name)
        if drawing:
            sx = w / drawing.width if drawing.width else 1
            sy = h / drawing.height if drawing.height else 1
            s = min(sx, sy)
            drawing.width *= s
            drawing.height *= s
            drawing.scale(s, s)
            renderPDF.draw(drawing, c, x, y)
    except Exception:
        # SVG embedding failed — skip silently
        pass
