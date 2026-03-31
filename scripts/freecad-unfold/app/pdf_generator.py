"""
Professional bending shop drawing PDF generator.

Produces an A4 landscape PDF with:
- Header bar with Microns Hub branding
- Isometric 3D view (solid shaded PNG)
- Part information panel
- Flat pattern with dimensions and bend annotations
- Bend table
- Title block footer
"""

import os
from datetime import datetime

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white, black
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

from config import (
    COLOR_HEADER_BG,
    COLOR_ACCENT,
    COLOR_TEXT_DARK,
    COLOR_TEXT_MEDIUM,
    COLOR_BEND_LINE,
    COLOR_TABLE_HEADER,
    COLOR_TABLE_ALT_ROW,
    COLOR_BORDER,
    COLOR_DIMENSION,
)
from flat_pattern_render import draw_flat_pattern_with_dimensions


def generate_shop_drawing_pdf(unfold_data: dict, iso_png_path: str,
                               output_pdf_path: str):
    """
    Generate a professional bending shop drawing PDF (A4 landscape).

    Args:
        unfold_data: dict from freecad_unfold_worker with all bend/dimension data
        iso_png_path: path to the isometric PNG render
        output_pdf_path: output PDF file path
    """
    page_w, page_h = landscape(A4)
    c = canvas.Canvas(output_pdf_path, pagesize=landscape(A4))

    margin = 8 * mm
    content_w = page_w - 2 * margin
    content_h = page_h - 2 * margin

    part_name = unfold_data.get("part_name", "Part")
    material = unfold_data.get("material", unfold_data.get("material_guess", "Steel"))
    thickness = unfold_data.get("thickness_mm", 0)
    bends = unfold_data.get("bends", [])
    flat_data = unfold_data.get("flat_pattern", {})
    bbox = unfold_data.get("bounding_box_3d", {})
    dimensions = unfold_data.get("linear_dimensions", [])

    y_cursor = page_h - margin

    # --- HEADER BAR ---
    header_h = 18 * mm
    y_cursor = _draw_header(c, margin, y_cursor, content_w, header_h, part_name)

    # --- TOP ROW: Isometric view (left) + Part info (right) ---
    top_row_h = 55 * mm
    y_cursor -= 3 * mm
    iso_w = content_w * 0.45
    info_w = content_w * 0.55 - 3 * mm

    _draw_isometric_view(c, iso_png_path, margin, y_cursor - top_row_h,
                         iso_w, top_row_h)
    _draw_part_info(c, margin + iso_w + 3 * mm, y_cursor - top_row_h,
                    info_w, top_row_h, part_name, material, thickness,
                    bends, flat_data, bbox)

    y_cursor -= top_row_h + 3 * mm

    # --- FLAT PATTERN WITH DIMENSIONS ---
    bend_table_h = _estimate_bend_table_height(bends)
    footer_h = 14 * mm
    flat_h = y_cursor - margin - bend_table_h - footer_h - 6 * mm
    flat_h = max(flat_h, 50 * mm)

    _draw_section_border(c, margin, y_cursor - flat_h, content_w, flat_h,
                         "FLAT PATTERN WITH DIMENSIONS")

    draw_flat_pattern_with_dimensions(
        c, flat_data, bends, dimensions,
        margin + 2 * mm, y_cursor - flat_h + 2 * mm,
        content_w - 4 * mm, flat_h - 12 * mm
    )

    y_cursor -= flat_h + 3 * mm

    # --- BEND TABLE ---
    y_cursor = _draw_bend_table(c, margin, y_cursor, content_w, bends)

    # --- FOOTER / TITLE BLOCK ---
    _draw_footer(c, margin, margin, content_w, footer_h,
                 part_name, material, thickness, bends, flat_data)

    c.save()


def _draw_header(c, x, y_top, width, height, part_name):
    """Draw the dark navy header bar with company name and drawing title."""
    y = y_top - height

    # Background
    c.setFillColor(HexColor(COLOR_HEADER_BG))
    c.roundRect(x, y, width, height, 3, stroke=0, fill=1)

    # Company name (left)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(x + 6 * mm, y + height - 7 * mm, "MICRONS HUB")
    c.setFont("Helvetica", 7)
    c.drawString(x + 6 * mm, y + 3 * mm, "micronshub.eu")

    # Drawing title (right)
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(x + width - 6 * mm, y + height - 7 * mm,
                      "BENDING SHOP DRAWING")
    c.setFont("Helvetica", 8)
    c.drawRightString(x + width - 6 * mm, y + 3 * mm,
                      f"Part: {part_name}")

    return y


def _draw_isometric_view(c, iso_png_path, x, y, width, height):
    """Draw the isometric 3D view panel."""
    _draw_section_border(c, x, y, width, height, "ISOMETRIC VIEW")

    inner_x = x + 2 * mm
    inner_y = y + 2 * mm
    inner_w = width - 4 * mm
    inner_h = height - 12 * mm

    if iso_png_path and os.path.exists(iso_png_path):
        try:
            img = ImageReader(iso_png_path)
            iw, ih = img.getSize()
            aspect = iw / ih
            display_w = inner_w
            display_h = display_w / aspect
            if display_h > inner_h:
                display_h = inner_h
                display_w = display_h * aspect

            img_x = inner_x + (inner_w - display_w) / 2
            img_y = inner_y + (inner_h - display_h) / 2
            c.drawImage(iso_png_path, img_x, img_y, display_w, display_h,
                        preserveAspectRatio=True, anchor="c")
            return
        except Exception:
            pass

    # Placeholder if no image
    c.setFont("Helvetica", 9)
    c.setFillColor(HexColor("#808080"))
    c.drawCentredString(inner_x + inner_w / 2, inner_y + inner_h / 2,
                        "3D view not available")


def _draw_part_info(c, x, y, width, height, part_name, material,
                    thickness, bends, flat_data, bbox):
    """Draw the part information panel."""
    _draw_section_border(c, x, y, width, height, "PART INFORMATION")

    # Info rows
    info_items = [
        ("Part Name", part_name),
        ("Material", material),
        ("Thickness", f"{thickness:.2f} mm"),
        ("Number of Bends", str(len(bends))),
        ("Flat Pattern",
         f'{flat_data.get("width_mm", 0):.1f} \u00d7 {flat_data.get("height_mm", 0):.1f} mm'),
        ("3D Bounding Box",
         f'{bbox.get("x", 0):.1f} \u00d7 {bbox.get("y", 0):.1f} \u00d7 {bbox.get("z", 0):.1f} mm'),
    ]

    label_x = x + 6 * mm
    value_x = x + 45 * mm
    row_y = y + height - 16 * mm
    row_spacing = 7 * mm

    for label, value in info_items:
        c.setFont("Helvetica", 7)
        c.setFillColor(HexColor(COLOR_TEXT_MEDIUM))
        c.drawString(label_x, row_y, f"{label}:")

        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(HexColor(COLOR_TEXT_DARK))
        c.drawString(value_x, row_y, value)

        row_y -= row_spacing


def _draw_bend_table(c, x, y_top, width, bends):
    """Draw the bend data table."""
    if not bends:
        return y_top

    headers = ["#", "Angle (\u00b0)", "Inner R (mm)", "Direction",
               "Length (mm)", "K-Factor", "BA (mm)", "BD (mm)"]
    col_widths = [
        width * 0.05,   # #
        width * 0.12,   # Angle
        width * 0.13,   # Inner R
        width * 0.12,   # Direction
        width * 0.13,   # Length
        width * 0.12,   # K-Factor
        width * 0.15,   # BA
        width * 0.18,   # BD
    ]

    header_h = 7 * mm
    row_h = 6 * mm
    table_h = header_h + row_h * len(bends)

    y = y_top - table_h

    _draw_section_border(c, x, y, width, table_h + 8 * mm, "BEND TABLE")

    # Header row
    header_y = y_top - 10 * mm
    c.setFillColor(HexColor(COLOR_TABLE_HEADER))
    c.rect(x + 2 * mm, header_y, width - 4 * mm, header_h, stroke=0, fill=1)

    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 7)
    col_x = x + 2 * mm
    for i, header in enumerate(headers):
        c.drawCentredString(col_x + col_widths[i] / 2, header_y + 2 * mm, header)
        col_x += col_widths[i]

    # Data rows
    for row_idx, bend in enumerate(bends):
        row_y = header_y - (row_idx + 1) * row_h

        # Alternating row background
        if row_idx % 2 == 1:
            c.setFillColor(HexColor(COLOR_TABLE_ALT_ROW))
            c.rect(x + 2 * mm, row_y, width - 4 * mm, row_h, stroke=0, fill=1)

        values = [
            str(bend.get("index", row_idx + 1)),
            f'{bend.get("angle_deg", 0):.1f}',
            f'{bend.get("inner_radius_mm", 0):.2f}',
            bend.get("direction", "—"),
            f'{bend.get("length_mm", 0):.1f}',
            f'{bend.get("k_factor", 0):.2f}',
            f'{bend.get("bend_allowance_mm", 0):.2f}',
            f'{bend.get("bend_deduction_mm", 0):.2f}',
        ]

        c.setFillColor(HexColor(COLOR_TEXT_DARK))
        c.setFont("Helvetica", 7)
        col_x = x + 2 * mm
        for i, val in enumerate(values):
            c.drawCentredString(col_x + col_widths[i] / 2, row_y + 1.5 * mm, val)
            col_x += col_widths[i]

    return y


def _draw_footer(c, x, y, width, height, part_name, material,
                 thickness, bends, flat_data):
    """Draw the title block footer."""
    c.setFillColor(HexColor(COLOR_HEADER_BG))
    c.roundRect(x, y, width, height, 3, stroke=0, fill=1)

    c.setFillColor(white)
    c.setFont("Helvetica", 7)

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    flat_w = flat_data.get("width_mm", 0)
    flat_h = flat_data.get("height_mm", 0)

    items = [
        f"Part: {part_name}",
        f"{thickness:.2f}mm {material}",
        f"{len(bends)} bend{'s' if len(bends) != 1 else ''}",
        f"Flat: {flat_w:.1f}\u00d7{flat_h:.1f}mm",
        f"Generated: {now}",
        "NTS",
    ]

    # Distribute items across the footer
    spacing = width / len(items)
    for i, item in enumerate(items):
        ix = x + spacing * i + spacing / 2
        c.drawCentredString(ix, y + height / 2 - 2, item)

    # Company name on far right
    c.setFont("Helvetica-Bold", 7)
    c.drawRightString(x + width - 4 * mm, y + height / 2 - 2, "MICRONS HUB")


def _draw_section_border(c, x, y, width, height, title=""):
    """Draw a rounded-rect section border with optional title."""
    c.saveState()
    c.setStrokeColor(HexColor(COLOR_BORDER))
    c.setLineWidth(0.5)
    c.roundRect(x, y, width, height, 3, stroke=1, fill=0)

    if title:
        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(HexColor(COLOR_ACCENT))
        c.drawString(x + 4 * mm, y + height - 8 * mm, title)

    c.restoreState()


def _estimate_bend_table_height(bends):
    """Estimate the height needed for the bend table."""
    if not bends:
        return 0
    header_h = 7 * mm
    row_h = 6 * mm
    return 10 * mm + header_h + row_h * len(bends) + 4 * mm
