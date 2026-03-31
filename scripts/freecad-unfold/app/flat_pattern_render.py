"""
Flat pattern renderer — draws the annotated flat pattern directly on a reportlab canvas.

Renders:
- Part outline (thick black lines from DXF/unfold data)
- Bend lines (red dashed) at true positions
- Bend labels (B1: 90 UP, etc.)
- Radius callouts (R2.0)
- Linear dimension chains (edge-to-bend, bend-to-bend)
- Overall width/height dimensions
"""

from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor

from config import COLOR_BEND_LINE, COLOR_DIMENSION, COLOR_TEXT_DARK


def draw_flat_pattern_with_dimensions(canvas, flat_data, bends, dimensions,
                                       x_origin, y_origin,
                                       available_width, available_height):
    """
    Draw the flat pattern outline, bend lines, and dimensions
    directly on the reportlab canvas.

    Args:
        canvas: reportlab Canvas
        flat_data: dict with outline_edges, width_mm, height_mm
        bends: list of bend dicts with bend_line_on_flat positions
        dimensions: list of linear dimension dicts
        x_origin, y_origin: bottom-left corner of the drawing area on the PDF
        available_width, available_height: available space in PDF points
    """
    flat_w = flat_data.get("width_mm", 0)
    flat_h = flat_data.get("height_mm", 0)

    if flat_w <= 0 or flat_h <= 0:
        # Draw placeholder
        canvas.setFont("Helvetica", 10)
        canvas.setFillColor(HexColor("#808080"))
        canvas.drawCentredString(
            x_origin + available_width / 2,
            y_origin + available_height / 2,
            "Flat pattern not available"
        )
        return

    # Calculate scale factor to fit flat pattern in available space
    margin_x = 35 * mm  # margins for dimension annotations
    margin_y_bottom = 25 * mm
    margin_y_top = 15 * mm
    draw_area_w = available_width - 2 * margin_x
    draw_area_h = available_height - margin_y_bottom - margin_y_top

    scale = min(draw_area_w / (flat_w * mm), draw_area_h / (flat_h * mm))
    scale = min(scale, 1.5)  # Don't scale up too much

    # Center the flat pattern in the available area
    pattern_w = flat_w * mm * scale
    pattern_h = flat_h * mm * scale
    offset_x = x_origin + (available_width - pattern_w) / 2
    offset_y = y_origin + margin_y_bottom + (draw_area_h - pattern_h) / 2

    def to_pdf(x_mm_val, y_mm_val):
        """Convert flat pattern mm coordinates to PDF canvas coordinates."""
        return (offset_x + x_mm_val * mm * scale,
                offset_y + y_mm_val * mm * scale)

    c = canvas

    # 1. Draw outline edges
    c.setStrokeColor(HexColor(COLOR_TEXT_DARK))
    c.setLineWidth(1.2)
    outline_edges = flat_data.get("outline_edges", [])

    if outline_edges:
        for edge in outline_edges:
            x1, y1 = to_pdf(edge["start"][0], edge["start"][1])
            x2, y2 = to_pdf(edge["end"][0], edge["end"][1])
            c.line(x1, y1, x2, y2)
    else:
        # Fallback: draw rectangle
        px, py = to_pdf(0, 0)
        c.rect(px, py, pattern_w, pattern_h, stroke=1, fill=0)

    # Light fill for the flat pattern area
    c.saveState()
    c.setFillColor(HexColor("#F8F9FA"))
    px, py = to_pdf(0, 0)
    c.rect(px, py, pattern_w, pattern_h, stroke=0, fill=1)
    c.restoreState()

    # Redraw outline on top of fill
    c.setStrokeColor(HexColor(COLOR_TEXT_DARK))
    c.setLineWidth(1.2)
    if outline_edges:
        for edge in outline_edges:
            x1, y1 = to_pdf(edge["start"][0], edge["start"][1])
            x2, y2 = to_pdf(edge["end"][0], edge["end"][1])
            c.line(x1, y1, x2, y2)
    else:
        px, py = to_pdf(0, 0)
        c.rect(px, py, pattern_w, pattern_h, stroke=1, fill=0)

    # 2. Draw bend lines (red dashed)
    if bends:
        c.setStrokeColor(HexColor(COLOR_BEND_LINE))
        c.setLineWidth(1.0)
        c.setDash(4, 3)

        for bend in bends:
            bl = bend.get("bend_line_on_flat", {})
            if "start" not in bl or "end" not in bl:
                continue
            x1, y1 = to_pdf(bl["start"][0], bl["start"][1])
            x2, y2 = to_pdf(bl["end"][0], bl["end"][1])
            c.line(x1, y1, x2, y2)

        c.setDash()  # Reset dash pattern

        # 3. Bend labels above each bend line
        c.setFillColor(HexColor(COLOR_BEND_LINE))
        for bend in bends:
            bl = bend.get("bend_line_on_flat", {})
            if "start" not in bl or "end" not in bl:
                continue

            mid_x = (bl["start"][0] + bl["end"][0]) / 2
            top_y = max(bl["start"][1], bl["end"][1])
            px, py = to_pdf(mid_x, top_y)

            direction_arrow = "\u2191" if bend.get("direction") == "UP" else "\u2193"
            label = f'B{bend.get("index", "")}: {bend.get("angle_deg", 0):.0f}\u00b0{direction_arrow}'
            c.setFont("Helvetica-Bold", 7)
            c.drawCentredString(px, py + 4 * mm, label)

            # Radius callout
            c.setFont("Helvetica", 6)
            c.drawCentredString(px, py + 1.5 * mm,
                                f'R{bend.get("inner_radius_mm", 0):.1f}')

    # 4. Linear dimension chain along the bottom
    if bends:
        _draw_dimension_chain(c, bends, flat_w, flat_h,
                              offset_x, offset_y, pattern_w, pattern_h,
                              scale, to_pdf)


def _draw_dimension_chain(c, bends, flat_w, flat_h,
                          offset_x, offset_y, pattern_w, pattern_h,
                          scale, to_pdf):
    """Draw the dimension chain below the flat pattern."""
    color = HexColor(COLOR_DIMENSION)
    dim_y = offset_y - 8 * mm  # First dimension row

    # Gather dimension points
    sorted_bends = sorted(bends, key=lambda b: b.get("distance_from_left_edge_mm", 0))
    dim_points = [0.0]
    for bend in sorted_bends:
        dim_points.append(bend.get("distance_from_left_edge_mm", 0))
    dim_points.append(flat_w)

    # Draw individual segment dimensions
    for i in range(len(dim_points) - 1):
        left_mm = dim_points[i]
        right_mm = dim_points[i + 1]
        value_mm = right_mm - left_mm

        if value_mm < 0.1:
            continue

        x1_pdf, _ = to_pdf(left_mm, 0)
        x2_pdf, _ = to_pdf(right_mm, 0)
        pattern_bottom = offset_y

        _draw_linear_dimension(c, x1_pdf, x2_pdf, dim_y, pattern_bottom,
                               f"{value_mm:.1f}", color)

    # Overall width dimension below the chain
    x1_pdf, _ = to_pdf(0, 0)
    x2_pdf, _ = to_pdf(flat_w, 0)
    overall_y = dim_y - 7 * mm
    _draw_linear_dimension(c, x1_pdf, x2_pdf, overall_y, dim_y - 2 * mm,
                           f"{flat_w:.1f}", color, font_size=8)

    # Overall height dimension on the right side
    _, y1_pdf = to_pdf(flat_w, 0)
    _, y2_pdf = to_pdf(flat_w, flat_h)
    dim_x = offset_x + pattern_w + 8 * mm
    pattern_right = offset_x + pattern_w
    _draw_vertical_dimension(c, dim_x, y1_pdf, y2_pdf, pattern_right,
                             f"{flat_h:.1f}", color)


def _draw_linear_dimension(c, x1, x2, dim_y, ext_top, text, color,
                           font_size=7):
    """Draw a horizontal linear dimension with extension lines and arrows."""
    c.saveState()
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(0.5)

    # Extension lines (from pattern down to dimension line)
    ext_bottom = dim_y - 2 * mm
    c.line(x1, ext_top, x1, ext_bottom)
    c.line(x2, ext_top, x2, ext_bottom)

    # Dimension line
    c.line(x1, dim_y, x2, dim_y)

    # Arrowheads
    arrow_len = 2.5 * mm
    arrow_w = 0.8 * mm

    # Left arrow
    p = c.beginPath()
    p.moveTo(x1, dim_y)
    p.lineTo(x1 + arrow_len, dim_y + arrow_w)
    p.lineTo(x1 + arrow_len, dim_y - arrow_w)
    p.close()
    c.drawPath(p, fill=1, stroke=0)

    # Right arrow
    p = c.beginPath()
    p.moveTo(x2, dim_y)
    p.lineTo(x2 - arrow_len, dim_y + arrow_w)
    p.lineTo(x2 - arrow_len, dim_y - arrow_w)
    p.close()
    c.drawPath(p, fill=1, stroke=0)

    # Dimension text centered above the dimension line
    mid_x = (x1 + x2) / 2
    c.setFont("Helvetica-Bold", font_size)
    c.drawCentredString(mid_x, dim_y + 1.5 * mm, text)

    c.restoreState()


def _draw_vertical_dimension(c, dim_x, y1, y2, ext_left, text, color,
                             font_size=7):
    """Draw a vertical linear dimension with extension lines and arrows."""
    c.saveState()
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(0.5)

    # Extension lines
    ext_right = dim_x + 2 * mm
    c.line(ext_left, y1, ext_right, y1)
    c.line(ext_left, y2, ext_right, y2)

    # Dimension line
    c.line(dim_x, y1, dim_x, y2)

    # Arrowheads
    arrow_len = 2.5 * mm
    arrow_w = 0.8 * mm

    # Bottom arrow
    p = c.beginPath()
    p.moveTo(dim_x, y1)
    p.lineTo(dim_x + arrow_w, y1 + arrow_len)
    p.lineTo(dim_x - arrow_w, y1 + arrow_len)
    p.close()
    c.drawPath(p, fill=1, stroke=0)

    # Top arrow
    p = c.beginPath()
    p.moveTo(dim_x, y2)
    p.lineTo(dim_x + arrow_w, y2 - arrow_len)
    p.lineTo(dim_x - arrow_w, y2 - arrow_len)
    p.close()
    c.drawPath(p, fill=1, stroke=0)

    # Dimension text rotated 90 degrees
    mid_y = (y1 + y2) / 2
    c.saveState()
    c.translate(dim_x + 3 * mm, mid_y)
    c.rotate(90)
    c.setFont("Helvetica-Bold", font_size)
    c.drawCentredString(0, 0, text)
    c.restoreState()

    c.restoreState()
