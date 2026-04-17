"""
SVG export for web preview of the flat pattern.

Produces an inline SVG string suitable for embedding in HTML or returning
from an API endpoint.
"""

from __future__ import annotations

import math
from typing import Optional

import svgwrite

from core.unfolder import FlatPattern


def export_svg(
    flat: FlatPattern,
    part_name: str = "Part",
    padding: float = 20.0,
    max_width: float = 800.0,
) -> str:
    """
    Render the flat pattern as an SVG string.

    Returns the SVG as a UTF-8 string (not a file path).
    """
    if flat.width <= 0 or flat.height <= 0:
        return _empty_svg(max_width)

    # Scale to fit max_width
    scale = min(max_width / flat.width, (max_width * 0.75) / flat.height, 5.0)
    svg_w = flat.width * scale + 2 * padding
    svg_h = flat.height * scale + 2 * padding + 40  # extra for labels

    dwg = svgwrite.Drawing(size=(f"{svg_w:.0f}px", f"{svg_h:.0f}px"))
    dwg.viewbox(0, 0, svg_w, svg_h)

    # Background
    dwg.add(dwg.rect(insert=(0, 0), size=(svg_w, svg_h), fill="white"))

    ox = padding
    oy = padding + 20  # leave room for labels at top

    def pt(x, y):
        # SVG Y is inverted
        return (ox + x * scale, oy + (flat.height - y) * scale)

    # ── Outline (thick dark stroke) ────────────────────────────────────────
    for edge in flat.outer_edges:
        p1 = pt(edge.start[0], edge.start[1])
        p2 = pt(edge.end[0], edge.end[1])
        dwg.add(dwg.line(
            start=p1, end=p2,
            stroke="#1A1A2E", stroke_width=2, fill="none",
        ))

    # Light fill
    if flat.outer_edges:
        points = [pt(e.start[0], e.start[1]) for e in flat.outer_edges]
        dwg.add(dwg.polygon(
            points=points,
            fill="#F8F9FA", stroke="none", opacity=0.5,
        ))

    # Redraw outline on top
    for edge in flat.outer_edges:
        p1 = pt(edge.start[0], edge.start[1])
        p2 = pt(edge.end[0], edge.end[1])
        dwg.add(dwg.line(
            start=p1, end=p2,
            stroke="#1A1A2E", stroke_width=2, fill="none",
        ))

    # ── Bend lines ─────────────────────────────────────────────────────────
    for bl in flat.bend_lines:
        color = "#C0392B" if bl.bend_info.direction == "UP" else "#2E6EA6"
        dash = "8,4" if bl.bend_info.direction == "UP" else "8,4,2,4"
        x = bl.start[0]

        p1 = pt(x, -2)
        p2 = pt(x, flat.height + 2)
        dwg.add(dwg.line(
            start=p1, end=p2,
            stroke=color, stroke_width=1.5,
            stroke_dasharray=dash,
        ))

        # Label
        arrow = "↑" if bl.bend_info.direction == "UP" else "↓"
        label_text = f"B{bl.bend_info.bend_id} {arrow}{bl.bend_info.angle_deg:.0f}°"
        label_pos = pt(x, flat.height + 5)
        dwg.add(dwg.text(
            label_text,
            insert=label_pos,
            fill=color,
            font_size="11px",
            font_family="sans-serif",
            font_weight="bold",
            text_anchor="middle",
        ))

    # ── Holes ──────────────────────────────────────────────────────────────
    for hole in flat.holes:
        if hole.center and hole.diameter:
            c = pt(hole.center[0], hole.center[1])
            r = hole.diameter / 2 * scale
            dwg.add(dwg.circle(
                center=c, r=max(r, 1),
                stroke="#27AE60", stroke_width=1.5, fill="none",
            ))
            # Centre cross
            ext = r + 4
            dwg.add(dwg.line(
                start=(c[0] - ext, c[1]), end=(c[0] + ext, c[1]),
                stroke="#F39C12", stroke_width=0.5, stroke_dasharray="4,2",
            ))
            dwg.add(dwg.line(
                start=(c[0], c[1] - ext), end=(c[0], c[1] + ext),
                stroke="#F39C12", stroke_width=0.5, stroke_dasharray="4,2",
            ))
        elif hole.edges:
            # Non-circular hole — render its polyline.
            for edge in hole.edges:
                p1 = pt(edge.start[0], edge.start[1])
                p2 = pt(edge.end[0], edge.end[1])
                dwg.add(dwg.line(
                    start=p1, end=p2,
                    stroke="#27AE60", stroke_width=1.2, fill="none",
                ))

    # ── Dimensions ─────────────────────────────────────────────────────────
    # Overall width
    yw = oy + (flat.height) * scale + 35
    dwg.add(dwg.text(
        f"{flat.width:.1f} mm",
        insert=(ox + flat.width * scale / 2, yw),
        fill="#2E6EA6",
        font_size="12px",
        font_family="sans-serif",
        font_weight="bold",
        text_anchor="middle",
    ))

    # Overall height
    xh = ox + flat.width * scale + 15
    dwg.add(dwg.text(
        f"{flat.height:.1f} mm",
        insert=(xh, oy + flat.height * scale / 2),
        fill="#2E6EA6",
        font_size="12px",
        font_family="sans-serif",
        font_weight="bold",
        text_anchor="start",
        transform=f"rotate(90, {xh}, {oy + flat.height * scale / 2})",
    ))

    # Title
    dwg.add(dwg.text(
        f"{part_name} — Flat Pattern",
        insert=(svg_w / 2, 15),
        fill="#1A1A2E",
        font_size="14px",
        font_family="sans-serif",
        font_weight="bold",
        text_anchor="middle",
    ))

    return dwg.tostring()


def _empty_svg(max_width: float) -> str:
    dwg = svgwrite.Drawing(size=(f"{max_width:.0f}px", "200px"))
    dwg.add(dwg.rect(insert=(0, 0), size=(max_width, 200), fill="#F8F9FA"))
    dwg.add(dwg.text(
        "Flat pattern not available",
        insert=(max_width / 2, 100),
        fill="#808080",
        font_size="16px",
        font_family="sans-serif",
        text_anchor="middle",
    ))
    return dwg.tostring()
