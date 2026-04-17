"""
Build a flange-bend adjacency graph for unfolding order determination.

Nodes  = flanges (planar faces)
Edges  = bends   (cylindrical faces connecting two flanges)

The graph must be a tree for simple unfolding.  If cycles exist (closed
shapes like tubes), we flag the part and pick a cut edge.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple

import networkx as nx

from core.face_classifier import ClassifiedFace, FaceType
from core.bend_detector import BendInfo


@dataclass
class BendGraph:
    """Flange-bend adjacency graph."""
    graph: nx.Graph = field(default_factory=nx.Graph)
    base_flange: Optional[int] = None          # index of the largest flange
    unfolding_order: List[Tuple[int, int, int]] = field(default_factory=list)
    # (from_flange, bend_id, to_flange) in BFS order
    has_cycles: bool = False
    cut_edges: List[Tuple[int, int]] = field(default_factory=list)


def build_bend_graph(
    classified: List[ClassifiedFace],
    bends: List[BendInfo],
) -> BendGraph:
    """
    Build the flange-bend graph and compute the unfolding order via BFS
    from the largest flange.
    """
    bg = BendGraph()
    G = bg.graph

    # Add flange nodes
    for cf in classified:
        if cf.face_type == FaceType.FLANGE:
            G.add_node(cf.info.index, area=cf.info.area, type="flange")

    # Add bend edges
    bend_map: Dict[int, BendInfo] = {}  # bend_id → BendInfo
    for b in bends:
        f1, f2 = b.adjacent_flanges
        if f1 in G.nodes and f2 in G.nodes:
            G.add_edge(f1, f2, bend_id=b.bend_id, bend_info=b)
            bend_map[b.bend_id] = b

    if G.number_of_nodes() == 0:
        return bg

    # Work with the largest connected component: a sheet-metal part should
    # be one solid, but face classification + adjacency detection sometimes
    # leaves isolated flanges (duplicate faces, features not connected via
    # THICKNESS walls, etc.). Picking the globally-largest flange can land on
    # an isolated node, leaving unfolding_order empty. Restrict to the biggest
    # connected subgraph that actually carries bend edges.
    components = [c for c in nx.connected_components(G) if len(c) > 1]
    if components:
        biggest = max(components, key=len)
        work_subgraph = G.subgraph(biggest).copy()
    else:
        work_subgraph = G

    # Find the base (largest) flange within the connected subgraph
    bg.base_flange = max(work_subgraph.nodes,
                         key=lambda n: work_subgraph.nodes[n].get("area", 0))

    # Check for cycles on the connected subgraph
    bg.has_cycles = (
        not nx.is_tree(work_subgraph)
        and nx.number_of_edges(work_subgraph) >= nx.number_of_nodes(work_subgraph)
    )

    # From here on we unfold across the connected subgraph
    G = work_subgraph

    if bg.has_cycles:
        # Break cycles by removing the edge with the smallest flange on either side
        # to create a spanning tree
        tree = nx.minimum_spanning_tree(G, weight="area")
        removed = set(G.edges) - set(tree.edges) - set((v, u) for u, v in tree.edges)
        bg.cut_edges = list(removed)
        work_graph = tree.copy()
    else:
        work_graph = G

    # BFS from base flange to determine unfolding order
    visited = {bg.base_flange}
    queue = [bg.base_flange]

    while queue:
        current = queue.pop(0)
        for neighbor in work_graph.neighbors(current):
            if neighbor in visited:
                continue
            visited.add(neighbor)

            edge_data = work_graph.edges[current, neighbor]
            bend_id = edge_data.get("bend_id", 0)
            bg.unfolding_order.append((current, bend_id, neighbor))
            queue.append(neighbor)

    return bg
