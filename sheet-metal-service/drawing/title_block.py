"""
ISO 7200 compliant title block renderer for reportlab Canvas.
"""

from __future__ import annotations

from datetime import date

from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.pdfgen.canvas import Canvas

from config import COLOR_HEADER_BG
from drawing.sheet_layout import Rect


def draw_title_block(
    c: Canvas,
    rect: Rect,
    part_name: str = "Part",
    material: str = "See Order",
    thickness: float = 0.0,
    flat_width: float = 0.0,
    flat_height: float = 0.0,
    num_bends: int = 0,
    scale_text: str = "NTS",
    drawing_number: str = "",
) -> None:
    """Draw the title block footer bar."""
    x, y, w, h = rect.x, rect.y, rect.w, rect.h

    # Background
    c.setFillColor(HexColor(COLOR_HEADER_BG))
    c.roundRect(x, y, w, h, 3, stroke=0, fill=1)

    c.setFillColor(white)
    c.setFont("Helvetica", 7)

    today = date.today().isoformat()
    items = [
        f"Part: {part_name}",
        f"{thickness:.2f}mm {material}",
        f"{num_bends} bend{'s' if num_bends != 1 else ''}",
        f"Flat: {flat_width:.1f}\u00d7{flat_height:.1f}mm",
        f"Scale: {scale_text}",
        f"Date: {today}",
        f"Units: mm",
    ]

    spacing = w / (len(items) + 1)
    for i, item in enumerate(items):
        ix = x + spacing * (i + 0.5)
        c.drawCentredString(ix, y + h / 2 - 2, item)

    # Company branding on far right
    c.setFont("Helvetica-Bold", 8)
    c.drawRightString(x + w - 4 * mm, y + h / 2 - 2, "MICRONS HUB")
