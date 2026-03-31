"""
DXF export with bend lines on separate layers.

Produces a clean DXF file with:
- Layer "OUTLINE": flat pattern boundary (for cutting)
- Layer "BEND_LINES": bend line positions with annotations (for reference)
"""

import ezdxf


def export_flat_dxf_with_bend_lines(outline_edges: list, bends: list,
                                     output_path: str, part_name: str = "Part"):
    """
    Create a DXF file with the flat pattern outline and bend lines on
    separate layers.

    Args:
        outline_edges: list of {"start": [x, y], "end": [x, y]} dicts
        bends: list of bend data dicts with bend_line_on_flat positions
        output_path: path for the output DXF file
        part_name: name of the part (for metadata)
    """
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()

    # Create layers
    doc.layers.add("OUTLINE", color=7)       # White/black — cutting path
    doc.layers.add("BEND_LINES", color=1)    # Red — bend references
    doc.layers.add("ANNOTATIONS", color=5)   # Blue — text annotations

    # Add DASHED linetype for bend lines
    if "DASHED" not in doc.linetypes:
        doc.linetypes.add("DASHED", pattern=[0.5, 0.25, -0.25])

    # Add outline edges
    for edge in outline_edges:
        start = edge.get("start", [0, 0])
        end = edge.get("end", [0, 0])
        msp.add_line(
            (start[0], start[1]),
            (end[0], end[1]),
            dxfattribs={"layer": "OUTLINE"},
        )

    # Add bend lines and annotations
    for bend in bends:
        bl = bend.get("bend_line_on_flat", {})
        if "start" not in bl or "end" not in bl:
            continue

        start = bl["start"]
        end = bl["end"]

        # Bend line (dashed)
        msp.add_line(
            (start[0], start[1]),
            (end[0], end[1]),
            dxfattribs={
                "layer": "BEND_LINES",
                "linetype": "DASHED",
            },
        )

        # Bend annotation text
        mid_x = (start[0] + end[0]) / 2
        mid_y = (start[1] + end[1]) / 2
        text_y = max(start[1], end[1]) + 5  # 5mm above the top

        index = bend.get("index", "")
        angle = bend.get("angle_deg", 0)
        direction = bend.get("direction", "")
        radius = bend.get("inner_radius_mm", 0)

        annotation = f"B{index}: {angle:.0f} deg {direction} R{radius:.1f}"

        msp.add_text(
            annotation,
            dxfattribs={
                "layer": "ANNOTATIONS",
                "height": 3.0,
                "insert": (mid_x - 15, text_y),
            },
        )

    doc.saveas(output_path)
