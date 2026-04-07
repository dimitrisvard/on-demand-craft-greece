"""
Bend table renderer — professional table with bend data for the shop drawing.
"""

from __future__ import annotations

from typing import List

from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.pdfgen.canvas import Canvas

from config import COLOR_TABLE_HEADER, COLOR_TABLE_ALT_ROW, COLOR_TEXT_DARK, COLOR_ACCENT
from core.bend_detector import BendInfo
from core.kfactor import BendCalc, compute_bend
from drawing.sheet_layout import Rect


def draw_bend_table(
    c: Canvas,
    rect: Rect,
    bends: List[BendInfo],
    thickness: float,
    k_factor: float,
    material: str = "Steel",
    flat_width: float = 0.0,
    flat_height: float = 0.0,
) -> None:
    """Draw the bend table section on the PDF canvas."""
    if not bends:
        return

    x, y, w, h = rect.x, rect.y, rect.w, rect.h

    # Section title
    c.setFont("Helvetica-Bold", 8)
    c.setFillColor(HexColor(COLOR_ACCENT))
    c.drawString(x + 4 * mm, y + h - 8 * mm, "BEND TABLE")

    # Table headers
    headers = ["#", "Angle (\u00b0)", "Inner R (mm)", "Direction",
               "Length (mm)", "K-Factor", "BA (mm)", "BD (mm)", "OSSB (mm)"]
    col_fracs = [0.05, 0.11, 0.12, 0.10, 0.12, 0.10, 0.13, 0.13, 0.14]
    col_widths = [w * f for f in col_fracs]

    header_h = 7 * mm
    row_h = 6 * mm
    table_x = x + 2 * mm
    table_w = w - 4 * mm
    header_y = y + h - 10 * mm - header_h

    # Header background
    c.setFillColor(HexColor(COLOR_TABLE_HEADER))
    c.rect(table_x, header_y, table_w, header_h, stroke=0, fill=1)

    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 6.5)
    cx = table_x
    for i, hdr in enumerate(headers):
        c.drawCentredString(cx + col_widths[i] / 2, header_y + 2 * mm, hdr)
        cx += col_widths[i]

    # Data rows
    for row_idx, bi in enumerate(bends):
        row_y = header_y - (row_idx + 1) * row_h

        # Alternating background
        if row_idx % 2 == 1:
            c.setFillColor(HexColor(COLOR_TABLE_ALT_ROW))
            c.rect(table_x, row_y, table_w, row_h, stroke=0, fill=1)

        bc = compute_bend(bi.angle_deg, bi.inner_radius, thickness, k_factor)

        values = [
            f"B{bi.bend_id}",
            f"{bi.angle_deg:.1f}",
            f"{bi.inner_radius:.2f}",
            bi.direction,
            f"{bi.length:.1f}",
            f"{k_factor:.2f}",
            f"{bc.bend_allowance:.2f}",
            f"{bc.bend_deduction:.2f}",
            f"{bc.ossb:.2f}",
        ]

        c.setFillColor(HexColor(COLOR_TEXT_DARK))
        c.setFont("Helvetica", 6.5)
        cx = table_x
        for i, val in enumerate(values):
            c.drawCentredString(cx + col_widths[i] / 2, row_y + 1.5 * mm, val)
            cx += col_widths[i]

    # Summary line below table
    summary_y = header_y - (len(bends) + 1) * row_h - 4 * mm
    c.setFont("Helvetica", 7)
    c.setFillColor(HexColor(COLOR_TEXT_DARK))
    summary_items = [
        f"Material: {material}",
        f"Thickness: {thickness:.2f} mm",
        f"Flat Size: {flat_width:.1f} \u00d7 {flat_height:.1f} mm",
        f"Total Bends: {len(bends)}",
        f"K-Factor: {k_factor:.2f}",
    ]
    sx = table_x
    for item in summary_items:
        c.drawString(sx, summary_y, item)
        sx += table_w / len(summary_items)
