"""
Professional DXF export with proper layers, linetypes, and annotations.

Layers:
    OUTLINE     – White/7  – CONTINUOUS  – Cut outline
    BEND_UP     – Red/1    – DASHED      – Bend up (valley fold)
    BEND_DOWN   – Blue/5   – DASHDOT     – Bend down (mountain fold)
    HOLES       – Green/3  – CONTINUOUS  – Internal cutouts
    DIMENSIONS  – Cyan/4   – CONTINUOUS  – Dimension annotations
    CENTER      – Yellow/2 – CENTER      – Centre lines of holes
    NOTES       – White/7  – CONTINUOUS  – Text notes
"""

from __future__ import annotations

import math
from typing import Optional

import ezdxf
from ezdxf.enums import TextEntityAlignment

from core.unfolder import FlatPattern, Edge2D, BendLine2D, Hole2D


def export_dxf(
    flat: FlatPattern,
    output_path: str,
    part_name: str = "Part",
    origin: str = "bottom_left",  # "bottom_left" or "center"
) -> None:
    """
    Write the flat pattern to a DXF file with professional layer structure.
    """
    doc = ezdxf.new("R2013")
    msp = doc.modelspace()

    # ── Linetypes ──────────────────────────────────────────────────────────
    if "DASHED" not in doc.linetypes:
        doc.linetypes.add("DASHED", pattern=[0.6, 0.5, -0.1])
    if "DASHDOT" not in doc.linetypes:
        doc.linetypes.add("DASHDOT", pattern=[1.0, 0.5, -0.25, 0.0, -0.25])
    if "CENTER" not in doc.linetypes:
        doc.linetypes.add("CENTER", pattern=[1.4, 1.0, -0.25, 0.2, -0.25])

    # ── Layers ─────────────────────────────────────────────────────────────
    doc.layers.add("OUTLINE", color=7, lineweight=50)      # 0.50 mm
    doc.layers.add("BEND_UP", color=1, lineweight=25)      # 0.25 mm
    doc.layers.add("BEND_DOWN", color=5, lineweight=25)
    doc.layers.add("HOLES", color=3, lineweight=35)
    doc.layers.add("DIMENSIONS", color=4, lineweight=18)
    doc.layers.add("CENTER", color=2, lineweight=13)
    doc.layers.add("NOTES", color=7, lineweight=18)

    # ── Origin offset ──────────────────────────────────────────────────────
    ox, oy = 0.0, 0.0
    if origin == "center":
        ox = -flat.width / 2
        oy = -flat.height / 2

    def pt(x, y):
        return (x + ox, y + oy)

    # ── Outline ────────────────────────────────────────────────────────────
    # Emit as a closed LWPOLYLINE so downstream DXF readers (e.g. the nesting
    # import pipeline) reliably detect a single closed contour rather than
    # having to re-chain loose LINE entities.
    if flat.outer_edges:
        outline_vertices = [
            pt(edge.start[0], edge.start[1]) for edge in flat.outer_edges
        ]
        msp.add_lwpolyline(
            outline_vertices, close=True,
            dxfattribs={"layer": "OUTLINE"},
        )

    # ── Bend lines ─────────────────────────────────────────────────────────
    for bl in flat.bend_lines:
        direction = bl.bend_info.direction
        layer = "BEND_UP" if direction == "UP" else "BEND_DOWN"
        linetype = "DASHED" if direction == "UP" else "DASHDOT"

        # Extend bend line 3mm beyond part edges for visibility
        overshoot = 3.0
        x = bl.start[0]
        msp.add_line(
            pt(x, -overshoot),
            pt(x, flat.height + overshoot),
            dxfattribs={"layer": layer, "linetype": linetype},
        )

        # Bend annotation above the line
        arrow = "↑" if direction == "UP" else "↓"
        label = (
            f"B{bl.bend_info.bend_id} {arrow}{bl.bend_info.angle_deg:.0f}° "
            f"R{bl.bend_info.inner_radius:.1f}"
        )
        text_y = flat.height + overshoot + 2
        msp.add_text(
            label,
            dxfattribs={
                "layer": "NOTES",
                "height": 3.0,
                "insert": pt(x - 15, text_y),
            },
        )

        # Small direction triangle on the bend line
        _add_direction_arrow(msp, pt, x, flat.height / 2, direction)

    # ── Holes ──────────────────────────────────────────────────────────────
    for hole in flat.holes:
        if hole.center and hole.diameter:
            cx, cy = hole.center
            r = hole.diameter / 2
            msp.add_circle(
                pt(cx, cy), r,
                dxfattribs={"layer": "HOLES"},
            )
            # Centre lines
            ext = r + 3
            msp.add_line(
                pt(cx - ext, cy), pt(cx + ext, cy),
                dxfattribs={"layer": "CENTER", "linetype": "CENTER"},
            )
            msp.add_line(
                pt(cx, cy - ext), pt(cx, cy + ext),
                dxfattribs={"layer": "CENTER", "linetype": "CENTER"},
            )
        elif hole.edges:
            # Non-circular cutout — emit a closed LWPOLYLINE so downstream
            # DXF readers (e.g. the nesting import) can detect the contour.
            vertices = []
            for edge in hole.edges:
                vertices.append(pt(edge.start[0], edge.start[1]))
            if vertices:
                msp.add_lwpolyline(
                    vertices, close=True,
                    dxfattribs={"layer": "HOLES"},
                )

    # ── Overall dimensions ─────────────────────────────────────────────────
    dim_offset = 12.0
    # Width dimension below the part
    _add_aligned_dim(
        msp, doc,
        pt(0, -dim_offset), pt(flat.width, -dim_offset),
        f"{flat.width:.1f}",
    )
    # Height dimension to the right
    _add_aligned_dim(
        msp, doc,
        pt(flat.width + dim_offset, 0), pt(flat.width + dim_offset, flat.height),
        f"{flat.height:.1f}",
    )

    # ── Bend-to-bend dimensions ────────────────────────────────────────────
    if flat.bend_lines:
        dim_y = -dim_offset - 8
        points = [0.0] + [bl.start[0] for bl in flat.bend_lines] + [flat.width]
        for i in range(len(points) - 1):
            val = points[i + 1] - points[i]
            if val < 0.5:
                continue
            mid_x = (points[i] + points[i + 1]) / 2
            msp.add_text(
                f"{val:.1f}",
                dxfattribs={
                    "layer": "DIMENSIONS",
                    "height": 2.5,
                    "insert": pt(mid_x - 5, dim_y),
                },
            )
            msp.add_line(
                pt(points[i], dim_y + 1), pt(points[i + 1], dim_y + 1),
                dxfattribs={"layer": "DIMENSIONS"},
            )

    doc.saveas(output_path)


def _add_direction_arrow(msp, pt, x, y, direction):
    """Add a small triangle on the bend line indicating bend direction."""
    size = 2.0
    if direction == "UP":
        pts = [pt(x, y), pt(x - size, y - size * 1.5), pt(x + size, y - size * 1.5)]
    else:
        pts = [pt(x, y), pt(x - size, y + size * 1.5), pt(x + size, y + size * 1.5)]
    msp.add_lwpolyline(
        [(p[0], p[1]) for p in pts] + [(pts[0][0], pts[0][1])],
        close=True,
        dxfattribs={"layer": "BEND_UP" if direction == "UP" else "BEND_DOWN"},
    )


def _add_aligned_dim(msp, doc, p1, p2, text):
    """Add a simple dimension annotation as text + leader lines."""
    mid = ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)
    msp.add_text(
        text,
        dxfattribs={
            "layer": "DIMENSIONS",
            "height": 3.0,
            "insert": (mid[0] - 5, mid[1] + 1),
        },
    )
    # Dimension line
    msp.add_line(p1, p2, dxfattribs={"layer": "DIMENSIONS"})
    # Tick marks
    for p in [p1, p2]:
        msp.add_line(
            (p[0], p[1] - 1.5), (p[0], p[1] + 1.5),
            dxfattribs={"layer": "DIMENSIONS"},
        )
