#!/usr/bin/env python3
"""
FreeCAD Unfold Worker — runs inside FreeCAD's Python environment via freecadcmd.

This script performs the actual sheet metal unfolding using FreeCAD and the
SheetMetal Workbench. It communicates results back to the main process via
JSON printed to stdout between markers.

Usage:
    freecadcmd freecad_unfold_worker.py <step_path> <output_dir> <thickness> <k_factor>
"""

import sys
import os
import json
import math
import traceback

# Parse arguments — freecadcmd may consume some args, so we look from the end
args = sys.argv[1:]
if len(args) < 4:
    # Try to find our args after the script path
    all_args = sys.argv
    script_idx = -1
    for i, a in enumerate(all_args):
        if a.endswith("freecad_unfold_worker.py"):
            script_idx = i
            break
    if script_idx >= 0:
        args = all_args[script_idx + 1:]

step_path = args[0]
output_dir = args[1]
thickness_input = float(args[2])
k_factor = float(args[3])

# Ensure output directory exists
os.makedirs(output_dir, exist_ok=True)

# Add SheetMetal workbench to path
SM_PATH = os.path.expanduser("~/.local/share/FreeCAD/Mod/SheetMetal")
if os.path.exists(SM_PATH) and SM_PATH not in sys.path:
    sys.path.insert(0, SM_PATH)

# FreeCAD module paths
for p in ["/usr/lib/freecad/lib", "/usr/lib/freecad-python3/lib",
          "/usr/share/freecad/Mod", "/usr/lib/freecad/Mod"]:
    if os.path.exists(p) and p not in sys.path:
        sys.path.insert(0, p)

import FreeCAD
import Part


def detect_thickness(shape):
    """
    Auto-detect sheet metal thickness by finding parallel planar face pairs
    with the smallest perpendicular distance.
    """
    planar_faces = []
    for i, face in enumerate(shape.Faces):
        surf = face.Surface
        if surf.__class__.__name__ == "Plane":
            normal = face.normalAt(0, 0)
            center = face.CenterOfMass
            planar_faces.append({
                "index": i,
                "normal": normal,
                "center": center,
                "area": face.Area,
            })

    if len(planar_faces) < 2:
        return None

    # Find pairs with parallel/anti-parallel normals
    distances = []
    for i in range(len(planar_faces)):
        for j in range(i + 1, len(planar_faces)):
            n1 = planar_faces[i]["normal"]
            n2 = planar_faces[j]["normal"]
            dot = abs(n1.dot(n2))
            if dot > 0.99:  # Nearly parallel
                c1 = planar_faces[i]["center"]
                c2 = planar_faces[j]["center"]
                diff = c2 - c1
                dist = abs(diff.dot(n1))
                if 0.3 <= dist <= 25.0:  # Valid sheet metal range
                    distances.append(dist)

    if not distances:
        return None

    # Find the most common distance (mode)
    distances.sort()
    rounded = [round(d, 2) for d in distances]

    # Count occurrences
    counts = {}
    for d in rounded:
        counts[d] = counts.get(d, 0) + 1

    # Return the most frequent distance
    best = max(counts, key=counts.get)
    return best


def detect_cylindrical_faces(shape):
    """
    Detect all cylindrical faces (bends) in the shape.
    Returns list of dicts with face index, radius, angle, length, axis info.
    """
    bends = []
    for i, face in enumerate(shape.Faces):
        surf = face.Surface
        if surf.__class__.__name__ != "Cylinder":
            continue

        radius = surf.Radius
        axis = surf.Axis
        center = surf.Center

        # Get angular extent from circular edges
        max_angle = 0
        bend_length = 0
        for edge in face.Edges:
            curve = edge.Curve
            cname = curve.__class__.__name__
            if cname == "Circle":
                fp = edge.FirstParameter
                lp = edge.LastParameter
                angle = abs(lp - fp)
                max_angle = max(max_angle, angle)
            elif cname == "Line" or cname == "BSplineCurve":
                elen = edge.Length
                bend_length = max(bend_length, elen)

        if max_angle < math.radians(5):
            continue

        angle_deg = math.degrees(max_angle)

        # Determine face normal direction relative to cylinder axis
        # to identify inner vs outer face
        try:
            mid_u = (face.ParameterRange[0] + face.ParameterRange[1]) / 2
            mid_v = (face.ParameterRange[2] + face.ParameterRange[3]) / 2
            normal = face.normalAt(mid_u, mid_v)
            # If normal points away from axis → outer face
            # If normal points toward axis → inner face
            point_on_face = face.valueAt(mid_u, mid_v)
            to_axis = FreeCAD.Vector(center) - point_on_face
            # Project onto plane perpendicular to axis
            to_axis = to_axis - axis * to_axis.dot(axis)
            is_inner = normal.dot(to_axis) > 0
        except Exception:
            is_inner = True

        bends.append({
            "face_index": i,
            "radius": round(radius, 4),
            "angle_rad": max_angle,
            "angle_deg": round(angle_deg, 1),
            "length": round(bend_length, 3),
            "axis": [round(axis.x, 6), round(axis.y, 6), round(axis.z, 6)],
            "center": [round(center.x, 4), round(center.y, 4), round(center.z, 4)],
            "is_inner_face": is_inner,
        })

    return bends


def find_largest_planar_face(shape):
    """Find the largest planar face in the shape (used as base face for unfolding)."""
    best_face = None
    best_area = 0
    best_idx = -1
    for i, face in enumerate(shape.Faces):
        if face.Surface.__class__.__name__ == "Plane" and face.Area > best_area:
            best_area = face.Area
            best_face = face
            best_idx = i
    return best_face, best_idx


def try_sheetmetal_unfold(doc, shape, base_face_idx, k_factor):
    """
    Attempt to unfold using the SheetMetal Workbench's SMUnfolder.
    Returns (unfolded_shape, bend_sketch_edges) or (None, None).
    """
    try:
        from SheetMetalUnfolder import SMUnfold

        # Create a Part::Feature in the document
        obj = doc.addObject("Part::Feature", "SheetPart")
        obj.Shape = shape
        doc.recompute()

        # Select the base face
        face_name = f"Face{base_face_idx + 1}"

        # Run the unfolder
        unfolder = SMUnfold(obj, faceName=face_name, kFactor=k_factor)
        unfolder.run()

        unfolded_shape = None
        bend_lines = []

        # Extract unfolded shape
        for o in doc.Objects:
            name = o.Name.lower()
            if "unfold" in name and hasattr(o, "Shape") and o.Shape.Area > 0:
                if "sketch" not in name and "bend" not in name:
                    unfolded_shape = o.Shape

            # Extract bend lines from the bend sketch
            if ("sketch" in name and "bend" in name) or ("bendlines" in name):
                if hasattr(o, "Shape"):
                    for edge in o.Shape.Edges:
                        v1 = edge.Vertexes[0].Point
                        v2 = edge.Vertexes[1].Point
                        bend_lines.append({
                            "start": [round(v1.x, 4), round(v1.y, 4)],
                            "end": [round(v2.x, 4), round(v2.y, 4)],
                        })
                elif hasattr(o, "Geometry"):
                    # Sketch geometry
                    for geom in o.Geometry:
                        if hasattr(geom, "StartPoint") and hasattr(geom, "EndPoint"):
                            bend_lines.append({
                                "start": [round(geom.StartPoint.x, 4),
                                          round(geom.StartPoint.y, 4)],
                                "end": [round(geom.EndPoint.x, 4),
                                        round(geom.EndPoint.y, 4)],
                            })

        return unfolded_shape, bend_lines

    except ImportError:
        print("SheetMetal workbench not available", file=sys.stderr)
        return None, None
    except Exception as e:
        print(f"SheetMetal unfold failed: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return None, None


def manual_unfold(shape, bends_info, thickness, k_factor):
    """
    Manual OCC-based unfolding for simple parts when the SheetMetal WB fails.

    Walks the face adjacency graph: planar → cylindrical → planar → ...
    Unfolds each flange about the neutral axis.

    Returns (unfolded_wire, bend_line_positions).
    """
    try:
        # Build face adjacency graph
        faces = shape.Faces
        adjacency = {}
        for i, f1 in enumerate(faces):
            adjacency[i] = set()
            for j, f2 in enumerate(faces):
                if i == j:
                    continue
                # Two faces are adjacent if they share an edge
                for e1 in f1.Edges:
                    for e2 in f2.Edges:
                        if e1.isSame(e2):
                            adjacency[i].add(j)
                            break

        # Find planar and cylindrical faces
        planar_indices = []
        cyl_indices = set()
        for i, face in enumerate(faces):
            stype = face.Surface.__class__.__name__
            if stype == "Plane":
                planar_indices.append(i)
            elif stype == "Cylinder":
                cyl_indices.add(i)

        if not planar_indices or not cyl_indices:
            return None, []

        # Find the largest planar face as the base
        base_idx = max(planar_indices, key=lambda i: faces[i].Area)
        base_face = faces[base_idx]
        base_normal = base_face.normalAt(0, 0)

        # Walk the graph from base face through bends
        visited = {base_idx}
        queue = [(base_idx, 0.0)]  # (face_idx, accumulated_x_offset)
        bend_positions = []

        # Get base face bounding box in its local frame
        bb = base_face.BoundBox
        base_width = max(bb.XLength, bb.YLength, bb.ZLength)

        # Simple approach: measure the widths of planar faces and bend allowances
        # along the primary bending direction
        accumulated_x = 0.0
        flat_segments = []

        # Sort bends by adjacency order from the base face
        # BFS from base face
        ordered_flanges = []
        bfs_queue = [base_idx]
        bfs_visited = {base_idx}
        while bfs_queue:
            current = bfs_queue.pop(0)
            for neighbor in adjacency.get(current, []):
                if neighbor in bfs_visited:
                    continue
                bfs_visited.add(neighbor)
                if neighbor in cyl_indices:
                    # Find the planar face on the other side of this bend
                    for nn in adjacency.get(neighbor, []):
                        if nn not in bfs_visited and nn in set(planar_indices):
                            bfs_visited.add(nn)
                            ordered_flanges.append({
                                "planar_idx": nn,
                                "bend_idx": neighbor,
                                "from_planar_idx": current,
                            })
                            bfs_queue.append(nn)

        # Compute flat layout
        # Start with the base face width
        base_bb = faces[base_idx].BoundBox
        dims = sorted([base_bb.XLength, base_bb.YLength, base_bb.ZLength])
        # The two larger dimensions are width and height; smallest is thickness
        base_w = dims[-1]  # largest = "along the part"
        pattern_height = dims[-2]  # second largest = perpendicular

        flat_segments.append({"width": base_w, "type": "flange"})
        accumulated_x = base_w

        for flange in ordered_flanges:
            bend_face = faces[flange["bend_idx"]]
            bend_info = None
            for b in bends_info:
                if b["face_index"] == flange["bend_idx"]:
                    bend_info = b
                    break

            if bend_info:
                inner_r = bend_info["radius"]
                if not bend_info["is_inner_face"]:
                    inner_r = max(inner_r - thickness, 0.1)
                angle_rad = bend_info["angle_rad"]

                # Bend allowance
                ba = (math.pi / 180.0) * bend_info["angle_deg"] * (inner_r + k_factor * thickness)

                # Record bend position
                bend_positions.append({
                    "x_position": accumulated_x,
                    "bend_allowance": ba,
                    "angle_deg": bend_info["angle_deg"],
                    "inner_radius": inner_r,
                    "length": bend_info["length"],
                    "face_index": flange["bend_idx"],
                })

                flat_segments.append({"width": ba, "type": "bend"})
                accumulated_x += ba

            # Add flange width
            flange_face = faces[flange["planar_idx"]]
            fbb = flange_face.BoundBox
            fdims = sorted([fbb.XLength, fbb.YLength, fbb.ZLength])
            flange_w = fdims[-1]

            flat_segments.append({"width": flange_w, "type": "flange"})
            accumulated_x += flange_w

        total_width = accumulated_x

        # Build bend line positions on the flat pattern
        bend_line_positions = []
        for bp in bend_positions:
            bend_center_x = bp["x_position"] + bp["bend_allowance"] / 2.0
            bend_line_positions.append({
                "start": [round(bend_center_x, 4), 0.0],
                "end": [round(bend_center_x, 4), round(pattern_height, 4)],
                "angle_deg": bp["angle_deg"],
                "inner_radius": bp["inner_radius"],
                "length": bp["length"],
                "face_index": bp["face_index"],
            })

        # Build a simple rectangular flat pattern outline
        outline_edges = [
            {"start": [0, 0], "end": [round(total_width, 4), 0]},
            {"start": [round(total_width, 4), 0],
             "end": [round(total_width, 4), round(pattern_height, 4)]},
            {"start": [round(total_width, 4), round(pattern_height, 4)],
             "end": [0, round(pattern_height, 4)]},
            {"start": [0, round(pattern_height, 4)], "end": [0, 0]},
        ]

        return {
            "width": round(total_width, 4),
            "height": round(pattern_height, 4),
            "outline_edges": outline_edges,
            "bend_line_positions": bend_line_positions,
        }, bend_positions

    except Exception as e:
        print(f"Manual unfold failed: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return None, []


def export_stl(shape, output_path):
    """Export shape as STL for 3D rendering fallback."""
    try:
        import Mesh
        mesh = Mesh.Mesh()
        verts, tris = shape.tessellate(0.1)
        for tri in tris:
            mesh.addFacet(verts[tri[0]], verts[tri[1]], verts[tri[2]])
        mesh.write(output_path)
        return True
    except Exception:
        return False


def export_dxf_flat(unfolded_shape, outline_edges, bends_data, output_path):
    """
    Export flat pattern as DXF with bend lines on separate layer.
    Uses FreeCAD's DXF exporter if shape is available, or ezdxf for manual outlines.
    """
    if unfolded_shape is not None:
        try:
            import importDXF
            temp_doc = FreeCAD.newDocument("DXFExport")
            obj = temp_doc.addObject("Part::Feature", "FlatPattern")
            obj.Shape = unfolded_shape
            temp_doc.recompute()
            importDXF.export([obj], output_path)
            FreeCAD.closeDocument("DXFExport")
            return True
        except Exception as e:
            print(f"FreeCAD DXF export failed: {e}", file=sys.stderr)

    # Fallback: write minimal DXF manually
    try:
        lines = [
            "0", "SECTION", "2", "HEADER", "0", "ENDSEC",
            "0", "SECTION", "2", "TABLES",
            "0", "TABLE", "2", "LAYER",
            "0", "LAYER", "2", "OUTLINE", "70", "0", "62", "7",
            "0", "LAYER", "2", "BEND_LINES", "70", "0", "62", "1",
            "0", "ENDTAB",
            "0", "ENDSEC",
            "0", "SECTION", "2", "ENTITIES",
        ]
        # Outline edges
        for edge in outline_edges:
            lines.extend([
                "0", "LINE", "8", "OUTLINE",
                "10", str(edge["start"][0]), "20", str(edge["start"][1]), "30", "0",
                "11", str(edge["end"][0]), "21", str(edge["end"][1]), "31", "0",
            ])
        # Bend lines
        for bl in bends_data:
            pos = bl.get("bend_line_on_flat", bl)
            if "start" in pos:
                lines.extend([
                    "0", "LINE", "8", "BEND_LINES",
                    "10", str(pos["start"][0]), "20", str(pos["start"][1]), "30", "0",
                    "11", str(pos["end"][0]), "21", str(pos["end"][1]), "31", "0",
                ])
        lines.extend(["0", "ENDSEC", "0", "EOF"])

        with open(output_path, "w") as f:
            f.write("\n".join(lines))
        return True
    except Exception as e:
        print(f"Manual DXF export failed: {e}", file=sys.stderr)
        return False


def determine_bend_direction(face, base_normal, shape):
    """
    Determine UP/DOWN bend direction relative to the base plane.
    UP = bends toward the viewer (same side as base normal)
    DOWN = bends away from the viewer
    """
    try:
        surf = face.Surface
        axis = surf.Axis
        center = surf.Center

        mid_u = (face.ParameterRange[0] + face.ParameterRange[1]) / 2
        mid_v = (face.ParameterRange[2] + face.ParameterRange[3]) / 2
        face_normal = face.normalAt(mid_u, mid_v)

        # Cross product of base normal and bend axis gives the bend direction
        cross = base_normal.cross(FreeCAD.Vector(axis))
        if cross.dot(face_normal) > 0:
            return "UP"
        return "DOWN"
    except Exception:
        return "UP"


def main():
    result = {"success": False}

    try:
        # Load STEP file
        doc = FreeCAD.newDocument("Unfold")
        Part.insert(step_path, doc.Name)
        doc.recompute()

        # Get all solid shapes
        shapes = []
        for obj in doc.Objects:
            if hasattr(obj, "Shape") and obj.Shape and obj.Shape.Volume > 0:
                shapes.append(obj.Shape)

        if not shapes:
            result["error"] = "No valid solid shapes found in STEP file"
            return result

        # Use the largest shape
        main_shape = max(shapes, key=lambda s: s.Volume)

        # Part name from file
        part_name = os.path.splitext(os.path.basename(step_path))[0]

        # Bounding box
        bb = main_shape.BoundBox
        bbox_3d = {
            "x": round(bb.XLength, 2),
            "y": round(bb.YLength, 2),
            "z": round(bb.ZLength, 2),
        }

        # Auto-detect thickness
        thickness = thickness_input
        if thickness <= 0:
            detected = detect_thickness(main_shape)
            if detected:
                thickness = detected
            else:
                # Fallback: use smallest bounding box dimension
                thickness = min(bb.XLength, bb.YLength, bb.ZLength)
                if thickness < 0.3 or thickness > 25.0:
                    thickness = 2.0  # Default

        # Detect cylindrical faces (bends)
        cyl_bends = detect_cylindrical_faces(main_shape)

        if not cyl_bends:
            result = {
                "success": True,
                "part_name": part_name,
                "thickness_mm": round(thickness, 2),
                "bounding_box_3d": bbox_3d,
                "flat_pattern": {
                    "width_mm": round(bb.XLength, 2),
                    "height_mm": round(bb.YLength, 2),
                    "dxf_path": "",
                    "outline_edges": [],
                },
                "bends": [],
                "linear_dimensions": [],
                "unfold_method": "none",
                "warning": "No cylindrical faces detected — part may not be sheet metal",
            }

            # Export STL for isometric view
            stl_path = os.path.join(output_dir, f"{part_name}.stl")
            if export_stl(main_shape, stl_path):
                result["stl_path"] = stl_path

            return result

        # Find largest planar face as base
        base_face, base_face_idx = find_largest_planar_face(main_shape)
        base_normal = base_face.normalAt(0, 0) if base_face else FreeCAD.Vector(0, 0, 1)

        # Try SheetMetal WB unfold first
        unfolded_shape, sm_bend_lines = try_sheetmetal_unfold(
            doc, main_shape, base_face_idx, k_factor
        )

        unfold_method = "none"
        flat_width = 0
        flat_height = 0
        outline_edges = []
        bend_line_positions = []
        manual_bend_positions = []

        if unfolded_shape is not None:
            unfold_method = "sheetmetal_wb"
            ubb = unfolded_shape.BoundBox
            flat_width = round(ubb.XLength, 4)
            flat_height = round(ubb.YLength, 4)

            # Extract outline edges from the unfolded shape
            # Use the outer wire of the largest face
            try:
                largest_face = max(unfolded_shape.Faces, key=lambda f: f.Area)
                outer_wire = largest_face.OuterWire
                for edge in outer_wire.Edges:
                    verts = edge.Vertexes
                    if len(verts) == 2:
                        # Translate so min corner is at origin
                        outline_edges.append({
                            "start": [round(verts[0].X - ubb.XMin, 4),
                                      round(verts[0].Y - ubb.YMin, 4)],
                            "end": [round(verts[1].X - ubb.XMin, 4),
                                    round(verts[1].Y - ubb.YMin, 4)],
                        })
            except Exception:
                # Fallback rectangle
                outline_edges = [
                    {"start": [0, 0], "end": [flat_width, 0]},
                    {"start": [flat_width, 0], "end": [flat_width, flat_height]},
                    {"start": [flat_width, flat_height], "end": [0, flat_height]},
                    {"start": [0, flat_height], "end": [0, 0]},
                ]

            # Translate SM bend lines to origin-based coords
            if sm_bend_lines:
                for bl in sm_bend_lines:
                    bend_line_positions.append({
                        "start": [round(bl["start"][0] - ubb.XMin, 4),
                                  round(bl["start"][1] - ubb.YMin, 4)],
                        "end": [round(bl["end"][0] - ubb.XMin, 4),
                                round(bl["end"][1] - ubb.YMin, 4)],
                    })

        if unfold_method == "none":
            # Try manual unfold
            manual_result, manual_bend_positions = manual_unfold(
                main_shape, cyl_bends, thickness, k_factor
            )
            if manual_result:
                unfold_method = "manual_unfold"
                flat_width = manual_result["width"]
                flat_height = manual_result["height"]
                outline_edges = manual_result["outline_edges"]
                for bl in manual_result["bend_line_positions"]:
                    bend_line_positions.append({
                        "start": bl["start"],
                        "end": bl["end"],
                    })

        # Match bend lines to cylindrical faces
        # Sort bend lines by X position
        bend_line_positions.sort(key=lambda bl: min(bl["start"][0], bl["end"][0]))

        # Sort cylindrical bends by position (project center onto base normal direction)
        cyl_bends.sort(key=lambda b: b["center"][0])

        # Build bend data
        bends_output = []
        num_bends = min(len(cyl_bends), len(bend_line_positions)) if bend_line_positions else len(cyl_bends)

        for i in range(len(cyl_bends)):
            cb = cyl_bends[i]

            inner_r = cb["radius"]
            if not cb["is_inner_face"]:
                inner_r = max(inner_r - thickness, 0.1)

            angle_deg = cb["angle_deg"]
            bend_length = cb["length"] if cb["length"] > 0 else flat_height

            # Bend allowance and deduction
            ba = (math.pi / 180.0) * angle_deg * (inner_r + k_factor * thickness)
            bd = 2.0 * (inner_r + thickness) * math.tan(math.radians(angle_deg / 2.0)) - ba

            # Direction
            face = main_shape.Faces[cb["face_index"]]
            direction = determine_bend_direction(face, base_normal, main_shape)

            # Bend line position on flat
            if i < len(bend_line_positions):
                bl_pos = bend_line_positions[i]
                dist_from_left = min(bl_pos["start"][0], bl_pos["end"][0])
            else:
                # Estimate position if no bend line data
                if flat_width > 0 and len(cyl_bends) > 0:
                    dist_from_left = flat_width * (i + 1) / (len(cyl_bends) + 1)
                else:
                    dist_from_left = 0
                bl_pos = {
                    "start": [round(dist_from_left, 4), 0],
                    "end": [round(dist_from_left, 4), round(flat_height, 4)],
                }

            bends_output.append({
                "index": i + 1,
                "angle_deg": round(angle_deg, 1),
                "inner_radius_mm": round(inner_r, 2),
                "direction": direction,
                "length_mm": round(bend_length, 2),
                "k_factor": k_factor,
                "bend_allowance_mm": round(ba, 2),
                "bend_deduction_mm": round(bd, 2),
                "bend_line_on_flat": bl_pos,
                "distance_from_left_edge_mm": round(dist_from_left, 2),
            })

        # Sort bends by position on flat pattern
        bends_output.sort(key=lambda b: b["distance_from_left_edge_mm"])
        for idx, b in enumerate(bends_output):
            b["index"] = idx + 1

        # Compute linear dimensions
        linear_dimensions = []
        if bends_output:
            # Edge to first bend
            first_dist = bends_output[0]["distance_from_left_edge_mm"]
            if first_dist > 0.01:
                linear_dimensions.append({
                    "label": "Edge → B1",
                    "value_mm": round(first_dist, 1),
                    "type": "edge_to_bend",
                })

            # Bend to bend
            for i in range(1, len(bends_output)):
                dist = bends_output[i]["distance_from_left_edge_mm"] - \
                       bends_output[i - 1]["distance_from_left_edge_mm"]
                linear_dimensions.append({
                    "label": f"B{i} → B{i + 1}",
                    "value_mm": round(dist, 1),
                    "type": "bend_to_bend",
                })

            # Last bend to edge
            last_dist = flat_width - bends_output[-1]["distance_from_left_edge_mm"]
            if last_dist > 0.01:
                linear_dimensions.append({
                    "label": f"B{len(bends_output)} → Edge",
                    "value_mm": round(last_dist, 1),
                    "type": "bend_to_edge",
                })

        # Export DXF
        dxf_path = os.path.join(output_dir, f"{part_name}_flat.dxf")
        export_dxf_flat(unfolded_shape, outline_edges, bends_output, dxf_path)

        # Export STL for isometric rendering
        stl_path = os.path.join(output_dir, f"{part_name}.stl")
        export_stl(main_shape, stl_path)

        result = {
            "success": True,
            "part_name": part_name,
            "thickness_mm": round(thickness, 2),
            "material_guess": "Steel",
            "bounding_box_3d": bbox_3d,
            "flat_pattern": {
                "width_mm": round(flat_width, 2),
                "height_mm": round(flat_height, 2),
                "dxf_path": dxf_path if os.path.exists(dxf_path) else "",
                "outline_edges": outline_edges,
            },
            "bends": bends_output,
            "linear_dimensions": linear_dimensions,
            "stl_path": stl_path if os.path.exists(stl_path) else "",
            "unfold_method": unfold_method,
        }

        FreeCAD.closeDocument("Unfold")
        return result

    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        result["error"] = str(e)
        return result


if __name__ == "__main__":
    output = main()
    print("===JSON_START===")
    print(json.dumps(output, indent=2))
    print("===JSON_END===")
