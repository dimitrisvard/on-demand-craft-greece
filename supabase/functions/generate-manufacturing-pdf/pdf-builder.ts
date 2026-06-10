/**
 * PDF Builder — generates professional manufacturing drawing PDFs
 *
 * Uses pdf-lib (pure JS, works in Deno) to create A4 landscape
 * bending shop drawings with vector wireframe projections.
 *
 * Layout:
 *   +----------------------------------------------------+
 *   | HEADER: MICRONS HUB  .  BENDING SHOP DRAWING       |
 *   +---------------+------------------------------------+
 *   | ISOMETRIC     |  PART INFORMATION                   |
 *   | VIEW          |  Material / Thickness / Bends       |
 *   | (wireframe)   |  Overall flat dimensions            |
 *   +---------------+------------------------------------+
 *   |                                                     |
 *   |  FLAT PATTERN (top view wireframe) with:            |
 *   |  - Linear dimensions (mm)                           |
 *   |  - Bend lines (red dashed)                          |
 *   |  - FRONT VIEW reference (inset right)               |
 *   |                                                     |
 *   +----------------------------------------------------+
 *   | TITLE BLOCK: Part | Dims & Metrics | Company        |
 *   +----------------------------------------------------+
 */

import {
  PDFDocument,
  rgb,
  StandardFonts,
  LineCapStyle,
  PDFPage,
  PDFFont,
} from "https://esm.sh/pdf-lib@1.17.1";
import { type Edge2D, type MeshAnalysis, type UnfoldData } from "./mesh-analyzer.ts";

// ── Types ───────────────────────────────────────────────────────────────────

export interface PartInfo {
  name: string;
  material?: string;
  process?: string;
  thickness?: string;
  tolerance?: string;
  surfaceRoughness?: string;
  surfaceTreatment?: string;
  quantity?: number;
  needsBending?: boolean;
}

// ── Color constants ─────────────────────────────────────────────────────────

const DARK_BLUE = rgb(27 / 255, 42 / 255, 74 / 255);
const ACCENT_BLUE = rgb(46 / 255, 110 / 255, 166 / 255);
const RED = rgb(192 / 255, 57 / 255, 43 / 255);
const WHITE = rgb(1, 1, 1);
const LIGHT_GRAY = rgb(240 / 255, 242 / 255, 245 / 255);
const MEDIUM_GRAY = rgb(0.55, 0.55, 0.55);
const DARK_GRAY = rgb(0.12, 0.12, 0.12);
const EDGE_COLOR = rgb(0.1, 0.14, 0.27);
const BORDER_GRAY = rgb(0.78, 0.78, 0.78);

// ── Material density lookup (subset) ────────────────────────────────────────

const DENSITIES: Record<string, number> = {
  aluminum: 2.7, "6061": 2.7, "6082": 2.7, "5052": 2.68, "7075": 2.81,
  steel: 7.85, "mild steel": 7.85, "carbon steel": 7.85,
  "stainless": 8.0, "304": 8.0, "316": 8.0, "316l": 8.0,
  copper: 8.96, brass: 8.5, bronze: 8.8,
  titanium: 4.51, "ti-6al-4v": 4.43,
  zinc: 7.13, nickel: 8.9, inconel: 8.44,
  abs: 1.04, pla: 1.24, nylon: 1.14, peek: 1.3, ptfe: 2.2, pom: 1.41,
};

function estimateWeight(volumeMm3: number, material?: string): string | null {
  if (!material) return null;
  const lower = material.toLowerCase();
  for (const [key, density] of Object.entries(DENSITIES)) {
    if (lower.includes(key)) {
      const grams = (volumeMm3 / 1000) * density; // mm³ → cm³ → grams
      return grams >= 1000
        ? `${(grams / 1000).toFixed(2)} kg`
        : `${grams.toFixed(1)} g`;
    }
  }
  return null;
}

// ── Drawing helpers ─────────────────────────────────────────────────────────

/** Compute bounding box of 2D edges */
function edges2DBounds(edges: Edge2D[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of edges) {
    minX = Math.min(minX, e.x1, e.x2);
    minY = Math.min(minY, e.y1, e.y2);
    maxX = Math.max(maxX, e.x1, e.x2);
    maxY = Math.max(maxY, e.y1, e.y2);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Map the unfold service's flat-pattern outline edges ({start:[x,y],end:[x,y]})
 * into the Edge2D shape drawWireframe expects.
 *
 * The flat pattern is already in a +Y-up frame (the same convention pdf-lib
 * uses), so we do NOT negate Y here — unlike the folded top/iso projections
 * which negate Z to flip into screen space.
 */
function outlineEdgesToEdge2D(
  edges: Array<{ start: number[]; end: number[] }>,
): Edge2D[] {
  const out: Edge2D[] = [];
  for (const e of edges) {
    if (!e?.start || !e?.end || e.start.length < 2 || e.end.length < 2) continue;
    out.push({ x1: e.start[0], y1: e.start[1], x2: e.end[0], y2: e.end[1] });
  }
  return out;
}

/** Greedy word-wrap so a string fits within maxWidth at the given font size. */
function wrapText(
  font: PDFFont,
  text: string,
  size: number,
  maxWidth: number,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Draw 2D wireframe edges onto a PDF page within a given rectangle */
function drawWireframe(
  page: PDFPage,
  edges: Edge2D[],
  rect: { x: number; y: number; w: number; h: number },
  color = EDGE_COLOR,
  lineWidth = 0.4,
) {
  if (edges.length === 0) return;

  const bounds = edges2DBounds(edges);
  if (bounds.width === 0 && bounds.height === 0) return;

  // Scale to fit with padding
  const padding = 8;
  const availW = rect.w - 2 * padding;
  const availH = rect.h - 2 * padding;
  const scale = Math.min(
    availW / (bounds.width || 1),
    availH / (bounds.height || 1),
  );

  // Center offset
  const drawW = bounds.width * scale;
  const drawH = bounds.height * scale;
  const offsetX = rect.x + padding + (availW - drawW) / 2;
  const offsetY = rect.y + padding + (availH - drawH) / 2;

  for (const e of edges) {
    const x1 = offsetX + (e.x1 - bounds.minX) * scale;
    const y1 = offsetY + (e.y1 - bounds.minY) * scale;
    const x2 = offsetX + (e.x2 - bounds.minX) * scale;
    const y2 = offsetY + (e.y2 - bounds.minY) * scale;

    page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      thickness: lineWidth,
      color,
    });
  }
}

/** Draw dashed line */
function drawDashedLine(
  page: PDFPage,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dashLen: number,
  gapLen: number,
  color = RED,
  thickness = 0.5,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const totalLen = Math.sqrt(dx * dx + dy * dy);
  if (totalLen < 0.1) return;

  const ux = dx / totalLen;
  const uy = dy / totalLen;
  let pos = 0;

  while (pos < totalLen) {
    const end = Math.min(pos + dashLen, totalLen);
    page.drawLine({
      start: { x: x1 + ux * pos, y: y1 + uy * pos },
      end: { x: x1 + ux * end, y: y1 + uy * end },
      thickness,
      color,
    });
    pos = end + gapLen;
  }
}

/** Draw dimension arrow with text */
function drawDimension(
  page: PDFPage,
  font: PDFFont,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  label: string,
  offset: number,
  horizontal: boolean,
) {
  const arrowSize = 3;

  if (horizontal) {
    const lineY = y1 + offset;
    // Extension lines
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x1, y: lineY }, thickness: 0.2, color: RED });
    page.drawLine({ start: { x: x2, y: y1 }, end: { x: x2, y: lineY }, thickness: 0.2, color: RED });
    // Dimension line
    page.drawLine({ start: { x: x1, y: lineY }, end: { x: x2, y: lineY }, thickness: 0.35, color: RED });
    // Arrowheads
    page.drawLine({ start: { x: x1, y: lineY }, end: { x: x1 + arrowSize, y: lineY + 1.2 }, thickness: 0.3, color: RED });
    page.drawLine({ start: { x: x1, y: lineY }, end: { x: x1 + arrowSize, y: lineY - 1.2 }, thickness: 0.3, color: RED });
    page.drawLine({ start: { x: x2, y: lineY }, end: { x: x2 - arrowSize, y: lineY + 1.2 }, thickness: 0.3, color: RED });
    page.drawLine({ start: { x: x2, y: lineY }, end: { x: x2 - arrowSize, y: lineY - 1.2 }, thickness: 0.3, color: RED });
    // Label
    const textW = font.widthOfTextAtSize(label, 7);
    page.drawText(label, {
      x: (x1 + x2) / 2 - textW / 2,
      y: lineY + 2,
      size: 7,
      font,
      color: RED,
    });
  } else {
    const lineX = x1 + offset;
    // Extension lines
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: lineX, y: y1 }, thickness: 0.2, color: RED });
    page.drawLine({ start: { x: x1, y: y2 }, end: { x: lineX, y: y2 }, thickness: 0.2, color: RED });
    // Dimension line
    page.drawLine({ start: { x: lineX, y: y1 }, end: { x: lineX, y: y2 }, thickness: 0.35, color: RED });
    // Arrowheads
    page.drawLine({ start: { x: lineX, y: y1 }, end: { x: lineX + 1.2, y: y1 + arrowSize }, thickness: 0.3, color: RED });
    page.drawLine({ start: { x: lineX, y: y1 }, end: { x: lineX - 1.2, y: y1 + arrowSize }, thickness: 0.3, color: RED });
    page.drawLine({ start: { x: lineX, y: y2 }, end: { x: lineX + 1.2, y: y2 - arrowSize }, thickness: 0.3, color: RED });
    page.drawLine({ start: { x: lineX, y: y2 }, end: { x: lineX - 1.2, y: y2 - arrowSize }, thickness: 0.3, color: RED });
    // Label (rotated text not supported in pdf-lib, so place sideways)
    page.drawText(label, {
      x: lineX + 3,
      y: (y1 + y2) / 2 - 3,
      size: 7,
      font,
      color: RED,
    });
  }
}

/** A bend line expressed in the SAME 2D frame as its reference edges. */
interface BendSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
}

/**
 * Draw bend-line segments onto the flat pattern view.
 *
 * `segments` must already be in the same coordinate frame as `refEdges` (the
 * flat-pattern outline when unfolded, otherwise the top projection). We scale
 * with the EXACT same fit math drawWireframe uses, so bend lines land on the
 * outline they belong to.
 *
 * Guard: the unfold service occasionally emits bend coordinates in the wrong
 * frame (far outside the blank). Any segment with an endpoint outside the
 * reference bounding box (plus a small margin) is dropped from the drawing —
 * it still appears in the bend table.
 */
function drawBendLines(
  page: PDFPage,
  font: PDFFont,
  segments: BendSegment[],
  refEdges: Edge2D[],
  rect: { x: number; y: number; w: number; h: number },
  guardOutOfBounds = false,
) {
  if (segments.length === 0 || refEdges.length === 0) return;

  const bounds = edges2DBounds(refEdges);
  if (bounds.width === 0 && bounds.height === 0) return;

  const padding = 8;
  const availW = rect.w - 2 * padding;
  const availH = rect.h - 2 * padding;
  const scale = Math.min(
    availW / (bounds.width || 1),
    availH / (bounds.height || 1),
  );

  const drawW = bounds.width * scale;
  const drawH = bounds.height * scale;
  const offsetX = rect.x + padding + (availW - drawW) / 2;
  const offsetY = rect.y + padding + (availH - drawH) / 2;

  // Drop bend lines that fall outside the outline (with a small margin).
  const margin = Math.max(bounds.width, bounds.height) * 0.05 + 1e-3;
  const inBounds = (x: number, y: number) =>
    x >= bounds.minX - margin && x <= bounds.maxX + margin &&
    y >= bounds.minY - margin && y <= bounds.maxY + margin;

  for (const seg of segments) {
    if (
      guardOutOfBounds &&
      (!inBounds(seg.x1, seg.y1) || !inBounds(seg.x2, seg.y2))
    ) {
      continue;
    }

    const x1 = offsetX + (seg.x1 - bounds.minX) * scale;
    const y1 = offsetY + (seg.y1 - bounds.minY) * scale;
    const x2 = offsetX + (seg.x2 - bounds.minX) * scale;
    const y2 = offsetY + (seg.y2 - bounds.minY) * scale;

    drawDashedLine(page, x1, y1, x2, y2, 4, 2.5, RED, 0.6);

    const labelX = Math.min(x1, x2) - 2;
    const labelY = Math.max(y1, y2) + 4;
    page.drawText(seg.label, {
      x: labelX,
      y: labelY,
      size: 5.5,
      font,
      color: RED,
    });
  }
}

// ── Main PDF builder ────────────────────────────────────────────────────────

export async function buildManufacturingPDF(
  analysis: MeshAnalysis,
  partInfo: PartInfo,
  fileName: string,
  unfoldData?: UnfoldData | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // A4 Landscape: 841.89 x 595.28 pt
  const page = doc.addPage([841.89, 595.28]);
  const pageW = page.getWidth();
  const pageH = page.getHeight();
  const m = 22; // margin in points

  const contentW = pageW - 2 * m;
  let curY = pageH - m; // start from top (pdf-lib uses bottom-left origin)

  const dims = analysis.dimensions;
  // Folded 3D bounding box: prefer the unfold service's value; fall back to the
  // mesh/STEP bounding box (correct for STL/DXF where there is no unfold).
  const bbox = unfoldData?.bounding_box_mm ?? { x: dims.x, y: dims.y, z: dims.z };
  const weight = estimateWeight(analysis.volume, partInfo.material);

  // ── HEADER BAR ─────────────────────────────────────────

  const headerH = 34;
  page.drawRectangle({
    x: m,
    y: curY - headerH,
    width: contentW,
    height: headerH,
    color: DARK_BLUE,
  });

  page.drawText("MICRONS HUB", {
    x: m + 14,
    y: curY - 14,
    size: 14,
    font: fontBold,
    color: WHITE,
  });
  page.drawText("micronshub.eu", {
    x: m + 14,
    y: curY - 26,
    size: 7,
    font,
    color: rgb(0.7, 0.7, 0.8),
  });

  page.drawText("BENDING SHOP DRAWING", {
    x: pageW - m - 14 - fontBold.widthOfTextAtSize("BENDING SHOP DRAWING", 13),
    y: curY - 14,
    size: 13,
    font: fontBold,
    color: WHITE,
  });
  const partLabel = `Part: ${partInfo.name || fileName.replace(/\.[^.]+$/, "")}`;
  page.drawText(partLabel, {
    x: pageW - m - 14 - font.widthOfTextAtSize(partLabel, 7),
    y: curY - 26,
    size: 7,
    font,
    color: rgb(0.7, 0.7, 0.8),
  });

  curY -= headerH + 6;

  // ── TOP ROW: Isometric View + Part Info ────────────────

  const topRowH = 140;
  const isoBoxW = 170;
  const infoBoxW = contentW - isoBoxW - 8;

  // Isometric view box
  page.drawRectangle({
    x: m,
    y: curY - topRowH,
    width: isoBoxW,
    height: topRowH,
    color: LIGHT_GRAY,
    borderColor: BORDER_GRAY,
    borderWidth: 0.5,
  });
  drawWireframe(page, analysis.isoView, {
    x: m,
    y: curY - topRowH,
    w: isoBoxW,
    h: topRowH - 16,
  });
  const isoLabel = "ISOMETRIC VIEW";
  page.drawText(isoLabel, {
    x: m + isoBoxW / 2 - fontBold.widthOfTextAtSize(isoLabel, 7) / 2,
    y: curY - topRowH + 5,
    size: 7,
    font: fontBold,
    color: ACCENT_BLUE,
  });

  // Part info box
  const infoX = m + isoBoxW + 8;
  page.drawRectangle({
    x: infoX,
    y: curY - topRowH,
    width: infoBoxW,
    height: topRowH,
    color: WHITE,
    borderColor: BORDER_GRAY,
    borderWidth: 0.5,
  });

  page.drawText("PART INFORMATION", {
    x: infoX + 12,
    y: curY - 16,
    size: 10,
    font: fontBold,
    color: ACCENT_BLUE,
  });

  // Use unfold data for enhanced info when available
  const flatW = unfoldData?.flat_pattern?.width_mm || dims.x;
  const flatH_mm = unfoldData?.flat_pattern?.height_mm || dims.z;
  const thicknessMm = unfoldData?.thickness_mm || (partInfo.thickness ? parseFloat(partInfo.thickness) : dims.y);
  const bendCount = unfoldData?.bends?.length || analysis.bendLines.length;

  const infoFields: [string, string][] = [
    ["Part Name:", partInfo.name || "Untitled"],
    ["Material:", partInfo.material || "\u2014"],
    ["Thickness:", thicknessMm > 0 ? `${thicknessMm.toFixed(2)} mm` : (partInfo.thickness ? `${partInfo.thickness} mm` : "\u2014")],
    ["Number of Bends:", bendCount > 0 ? String(bendCount) : "0"],
    ["Flat Pattern:", `${flatW.toFixed(1)} \u00d7 ${flatH_mm.toFixed(1)} mm`],
    [
      "Bounding Box:",
      `${bbox.x.toFixed(1)} \u00d7 ${bbox.y.toFixed(1)} \u00d7 ${bbox.z.toFixed(1)} mm`,
    ],
    ["Process:", partInfo.process || "\u2014"],
    ["Quantity:", partInfo.quantity ? String(partInfo.quantity) : "\u2014"],
  ];

  let infoY = curY - 30;
  const colMid = infoX + infoBoxW / 2;
  for (let i = 0; i < infoFields.length; i++) {
    const [label, value] = infoFields[i];
    const cx = i % 2 === 0 ? infoX + 12 : colMid + 6;
    const cy = infoY - Math.floor(i / 2) * 16;

    page.drawText(label, { x: cx, y: cy, size: 7, font, color: MEDIUM_GRAY });
    page.drawText(value, {
      x: cx + 70,
      y: cy,
      size: 7,
      font: fontBold,
      color: DARK_GRAY,
    });
  }

  // Weight + surface treatment
  const extraY = infoY - Math.ceil(infoFields.length / 2) * 16;
  if (weight) {
    page.drawText("Est. Weight:", { x: infoX + 12, y: extraY, size: 7, font, color: MEDIUM_GRAY });
    page.drawText(weight, { x: infoX + 82, y: extraY, size: 7, font: fontBold, color: DARK_GRAY });
  }
  if (partInfo.surfaceTreatment && partInfo.surfaceTreatment !== "none") {
    page.drawText("Finish:", { x: colMid + 6, y: extraY, size: 7, font, color: MEDIUM_GRAY });
    page.drawText(partInfo.surfaceTreatment, {
      x: colMid + 50,
      y: extraY,
      size: 7,
      font: fontBold,
      color: DARK_GRAY,
    });
  }

  // Bending badge
  if (partInfo.needsBending) {
    const badgeW = 90;
    const badgeH = 18;
    page.drawRectangle({
      x: pageW - m - badgeW - 8,
      y: curY - 22,
      width: badgeW,
      height: badgeH,
      color: rgb(1, 140 / 255, 0),
      borderColor: rgb(0.8, 0.4, 0),
      borderWidth: 0.3,
    });
    const badgeText = "BENDING REQUIRED";
    page.drawText(badgeText, {
      x: pageW - m - badgeW - 8 + (badgeW - fontBold.widthOfTextAtSize(badgeText, 7)) / 2,
      y: curY - 17,
      size: 7,
      font: fontBold,
      color: WHITE,
    });
  }

  // ── Sanity warnings (rendered inside the info box's lower edge) ─────────
  const drawingWarnings: string[] = [];
  const modelThk = unfoldData?.thickness_mm || 0;
  if (unfoldData?.success && (unfoldData.bends?.length ?? 0) > 0) {
    const refThk = modelThk > 0 ? modelThk : thicknessMm;
    if (refThk > 0) {
      const minR = 0.5 * refThk;
      if (unfoldData.bends!.some((b) => b.inner_radius_mm > 0 && b.inner_radius_mm < minR)) {
        drawingWarnings.push(
          `Inner radius below recommended minimum bend radius (0.5 × t = ${minR.toFixed(2)} mm)`,
        );
      }
    }
  }
  const declaredThk = partInfo.thickness ? parseFloat(partInfo.thickness) : 0;
  if (
    declaredThk > 0 && modelThk > 0 &&
    Math.abs(declaredThk - modelThk) / modelThk > 0.10
  ) {
    drawingWarnings.push(
      `Declared thickness ${declaredThk.toFixed(2)} mm vs. model thickness ${modelThk.toFixed(2)} mm`,
    );
  }
  if (drawingWarnings.length > 0) {
    const wrapped: string[] = [];
    for (const w of drawingWarnings) {
      wrapped.push(...wrapText(fontBold, `! ${w}`, 6.5, infoBoxW - 24));
    }
    let warnY = curY - topRowH + 8 + (wrapped.length - 1) * 9;
    for (const ln of wrapped) {
      page.drawText(ln, { x: infoX + 12, y: warnY, size: 6.5, font: fontBold, color: RED });
      warnY -= 9;
    }
  }

  curY -= topRowH + 6;

  // ── FLAT PATTERN VIEW ─────────────────────────────────

  const hasBendTable = !!(unfoldData?.bends && unfoldData.bends.length > 0) || analysis.bendLines.length > 0;
  const bendTableRowCount = unfoldData?.bends?.length || analysis.bendLines.length;
  const bendTableH = hasBendTable ? Math.min(22 + bendTableRowCount * 14, 120) : 0;
  const titleBlockH = 46;
  const flatH = curY - m - titleBlockH - bendTableH - (hasBendTable ? 12 : 6);

  page.drawRectangle({
    x: m,
    y: curY - flatH,
    width: contentW,
    height: flatH,
    color: WHITE,
    borderColor: BORDER_GRAY,
    borderWidth: 0.5,
  });

  // Section label
  const flatLabel = unfoldData?.success
    ? `FLAT PATTERN (${unfoldData.unfold_method || "unfolded"})`
    : "FLAT PATTERN";
  page.drawText(flatLabel, {
    x: m + 12,
    y: curY - 14,
    size: 9,
    font: fontBold,
    color: ACCENT_BLUE,
  });
  page.drawText(
    "Bend lines shown as red dashed lines \u2014 dimensions in mm",
    {
      x: m + 12 + fontBold.widthOfTextAtSize(flatLabel, 9) + 8,
      y: curY - 13,
      size: 6,
      font,
      color: MEDIUM_GRAY,
    },
  );

  // Main flat pattern wireframe (left ~72%)
  const flatImgW = contentW * 0.72;
  const flatContentH = flatH - 22;
  const flatPanelRect = {
    x: m + 4,
    y: curY - flatH + 4,
    w: flatImgW - 8,
    h: flatContentH,
  };
  // Reserve CAD-style margins inside the panel so dimension rows (below),
  // the height dimension (right) and bend labels (above) never overlap the
  // part geometry or spill onto neighbouring panels.
  const flatRect = {
    x: flatPanelRect.x + 4,
    y: flatPanelRect.y + 44,
    w: flatPanelRect.w - 4 - 30,
    h: flatPanelRect.h - 44 - 12,
  };
  // Flat-pattern geometry: draw the REAL unfolded blank outline (which already
  // includes the hole loops) when the unfold service succeeded. Only fall back
  // to the folded part's top projection when there is no unfold data (STL/DXF,
  // or a failed STEP unfold).
  const outlineEdges =
    unfoldData?.success && (unfoldData.flat_pattern?.outline_edges?.length ?? 0) > 0
      ? outlineEdgesToEdge2D(unfoldData.flat_pattern!.outline_edges!)
      : [];
  const flatEdges = outlineEdges.length > 0 ? outlineEdges : analysis.topView;
  drawWireframe(page, flatEdges, flatRect, EDGE_COLOR, 0.5);

  // Build bend-line segments in the SAME frame as flatEdges.
  //  - unfold path: bend_line_on_flat is in the +Y-up flat frame (no negation),
  //    and we guard against the service emitting coords outside the blank.
  //  - fallback path: project mesh bend lines the same way the legacy code did
  //    (x, −z over the top projection) so STL/DXF output is unchanged.
  const useOutline = outlineEdges.length > 0;
  const bendSegments: BendSegment[] = useOutline
    ? (unfoldData?.bends || [])
        .filter((b) => b.bend_line_on_flat?.start && b.bend_line_on_flat?.end)
        .map((b) => ({
          x1: b.bend_line_on_flat!.start[0],
          y1: b.bend_line_on_flat!.start[1],
          x2: b.bend_line_on_flat!.end[0],
          y2: b.bend_line_on_flat!.end[1],
          label: `B${b.index} ${b.angle_deg.toFixed(0)}° ${b.direction || ""}`.trim(),
        }))
    : analysis.bendLines.map((bl, i) => ({
        x1: bl.start.x,
        y1: -bl.start.z,
        x2: bl.end.x,
        y2: -bl.end.z,
        label: `B${i + 1} (${bl.angle.toFixed(0)}°)`,
      }));

  // Only enforce the out-of-bounds guard on the unfold path (the frame where
  // bad service coordinates can appear); the fallback frame is left untouched.
  drawBendLines(page, fontBold, bendSegments, flatEdges, flatRect, useOutline);

  // Front view reference (right ~28%)
  const refX = m + flatImgW + 4;
  const refW = contentW - flatImgW - 8;
  const refH = flatContentH * 0.55;
  page.drawRectangle({
    x: refX,
    y: curY - 18 - refH,
    width: refW,
    height: refH,
    borderColor: rgb(0.85, 0.85, 0.85),
    borderWidth: 0.3,
  });
  drawWireframe(
    page,
    analysis.frontView,
    { x: refX, y: curY - 18 - refH, w: refW, h: refH - 14 },
    EDGE_COLOR,
    0.35,
  );
  const fvLabel = "FRONT VIEW";
  page.drawText(fvLabel, {
    x: refX + refW / 2 - fontBold.widthOfTextAtSize(fvLabel, 6) / 2,
    y: curY - 18 - refH + 4,
    size: 6,
    font: fontBold,
    color: ACCENT_BLUE,
  });

  // Specs summary below front view
  const specsY = curY - 22 - refH - 8;
  const specLines = [
    partInfo.tolerance && `Tolerance: ${partInfo.tolerance}`,
    partInfo.surfaceRoughness && `Surface Ra: ${partInfo.surfaceRoughness}`,
    weight && `Weight: ${weight}`,
    `Volume: ${analysis.volume >= 1000 ? `${(analysis.volume / 1000).toFixed(2)} cm\u00b3` : `${analysis.volume.toFixed(1)} mm\u00b3`}`,
    // Surface area from the STEP text parser is physically meaningless for a
    // sheet-metal blank, so omit it once the unfold succeeded. Keep it for
    // STL/DXF where it is computed from real mesh triangles.
    !unfoldData?.success &&
      `Surface Area: ${analysis.surfaceArea >= 100 ? `${(analysis.surfaceArea / 100).toFixed(2)} cm\u00b2` : `${analysis.surfaceArea.toFixed(1)} mm\u00b2`}`,
    analysis.triangleCount > 0 && `Triangles: ${analysis.triangleCount.toLocaleString()}`,
    `Feature edges: ${analysis.featureEdges.length.toLocaleString()}`,
    `Detected bends: ${unfoldData?.bends?.length || analysis.bendLines.length}`,
    unfoldData?.unfold_method && `Unfold: ${unfoldData.unfold_method}`,
  ].filter(Boolean) as string[];
  for (let i = 0; i < specLines.length; i++) {
    page.drawText(specLines[i], {
      x: refX + 8,
      y: specsY - i * 12,
      size: 6.5,
      font,
      color: rgb(0.23, 0.23, 0.23),
    });
  }

  // ── Dimension arrows on flat pattern ──────────────────

  if (flatEdges.length > 0) {
    const bounds = edges2DBounds(flatEdges);
    const padding = 8;
    const availW = flatRect.w - 2 * padding;
    const availH = flatRect.h - 2 * padding;
    const scale = Math.min(
      availW / (bounds.width || 1),
      availH / (bounds.height || 1),
    );
    const drawW = bounds.width * scale;
    const drawH = bounds.height * scale;
    const ox = flatRect.x + padding + (availW - drawW) / 2;
    const oy = flatRect.y + padding + (availH - drawH) / 2;

    // Use flat pattern dims from unfold data if available
    const flatWidthLabel = unfoldData?.flat_pattern?.width_mm
      ? `${unfoldData.flat_pattern.width_mm.toFixed(1)}`
      : `${dims.x.toFixed(1)}`;
    const flatHeightLabel = unfoldData?.flat_pattern?.height_mm
      ? `${unfoldData.flat_pattern.height_mm.toFixed(1)}`
      : `${dims.z.toFixed(1)}`;

    // Horizontal dimension (overall width)
    drawDimension(
      page,
      fontBold,
      ox,
      oy - 2,
      ox + drawW,
      oy - 2,
      flatWidthLabel,
      -14,
      true,
    );

    // Vertical dimension (overall height)
    drawDimension(
      page,
      fontBold,
      ox + drawW + 2,
      oy,
      ox + drawW + 2,
      oy + drawH,
      flatHeightLabel,
      14,
      false,
    );

    // Edge-to-bend dimension chain (CAD-style): 0 → B1 → B2 → … → width.
    // The unfold service does not send linear_dimensions, so derive the chain
    // from each bend's distance_from_left_edge_mm (already clamped to the
    // blank). Skip positions on the blank edges — they would duplicate the
    // overall width dimension.
    if (useOutline && unfoldData?.bends && unfoldData.bends.length > 0) {
      const flatW = unfoldData.flat_pattern?.width_mm || bounds.width;
      if (flatW > 0) {
        const interior = unfoldData.bends
          .map((b) => b.distance_from_left_edge_mm)
          .filter((d) => d > 0.5 && d < flatW - 0.5)
          .sort((a, b) => a - b);
        if (interior.length > 0) {
          const positions = [0, ...interior, flatW];
          const dimChainY = oy - 26; // row below the overall width dimension
          for (let pi = 0; pi < positions.length - 1; pi++) {
            const valueMm = positions[pi + 1] - positions[pi];
            if (valueMm < 0.5) continue;
            const x1Draw = ox + (positions[pi] / flatW) * drawW;
            const x2Draw = ox + (positions[pi + 1] / flatW) * drawW;
            drawDimension(
              page,
              font,
              x1Draw,
              dimChainY,
              x2Draw,
              dimChainY,
              `${valueMm.toFixed(1)}`,
              -10,
              true,
            );
          }
        }
      }
    }

    // Thickness annotation
    const thickVal = unfoldData?.thickness_mm || dims.y;
    if (thickVal > 0.1) {
      page.drawText(`t = ${thickVal.toFixed(1)} mm`, {
        x: flatPanelRect.x + 8,
        y: flatPanelRect.y + 6,
        size: 6,
        font: fontBold,
        color: ACCENT_BLUE,
      });
    }
  }

  curY -= flatH + 6;

  // ── BEND TABLE ────────────────────────────────────────

  if (hasBendTable) {
    const bends = unfoldData?.bends || [];
    const bendLinesForTable = analysis.bendLines;
    const rowH = 14;
    const headerH = 16;
    const tableTopY = curY;
    const tableW = contentW;

    // Section label
    page.drawText("BEND TABLE", {
      x: m + 12,
      y: curY - 12,
      size: 9,
      font: fontBold,
      color: ACCENT_BLUE,
    });

    curY -= 18;

    // Table header
    const cols = bends.length > 0
      ? ["#", "Angle (\u00b0)", "Inner R (mm)", "Direction", "Length (mm)", "K-Factor", "BA (mm)", "BD (mm)"]
      : ["#", "Angle (\u00b0)", "Length (mm)"];
    const colWidths = bends.length > 0
      ? [0.05, 0.12, 0.13, 0.10, 0.13, 0.12, 0.17, 0.18].map((w) => w * tableW)
      : [0.10, 0.45, 0.45].map((w) => w * tableW);

    // Header background
    page.drawRectangle({
      x: m,
      y: curY - headerH,
      width: tableW,
      height: headerH,
      color: DARK_BLUE,
    });

    // Header text
    let colX = m;
    for (let i = 0; i < cols.length; i++) {
      const textW = fontBold.widthOfTextAtSize(cols[i], 6.5);
      page.drawText(cols[i], {
        x: colX + colWidths[i] / 2 - textW / 2,
        y: curY - headerH + 5,
        size: 6.5,
        font: fontBold,
        color: WHITE,
      });
      colX += colWidths[i];
    }

    curY -= headerH;

    // Data rows
    if (bends.length > 0) {
      // Use detailed unfold data
      for (let ri = 0; ri < bends.length; ri++) {
        const bend = bends[ri];

        // Alternating row background
        if (ri % 2 === 1) {
          page.drawRectangle({
            x: m,
            y: curY - rowH,
            width: tableW,
            height: rowH,
            color: LIGHT_GRAY,
          });
        }

        const values = [
          String(bend.index),
          bend.angle_deg.toFixed(1),
          bend.inner_radius_mm.toFixed(2),
          bend.direction,
          bend.length_mm.toFixed(1),
          bend.k_factor.toFixed(2),
          bend.bend_allowance_mm.toFixed(2),
          bend.bend_deduction_mm.toFixed(2),
        ];

        colX = m;
        for (let ci = 0; ci < values.length; ci++) {
          const textW = font.widthOfTextAtSize(values[ci], 6.5);
          page.drawText(values[ci], {
            x: colX + colWidths[ci] / 2 - textW / 2,
            y: curY - rowH + 4,
            size: 6.5,
            font,
            color: DARK_GRAY,
          });
          colX += colWidths[ci];
        }

        curY -= rowH;
      }
    } else {
      // Use basic bend line data
      for (let ri = 0; ri < bendLinesForTable.length; ri++) {
        const bl = bendLinesForTable[ri];

        if (ri % 2 === 1) {
          page.drawRectangle({
            x: m,
            y: curY - rowH,
            width: tableW,
            height: rowH,
            color: LIGHT_GRAY,
          });
        }

        const edgeLen = Math.sqrt(
          (bl.end.x - bl.start.x) ** 2 +
          (bl.end.y - bl.start.y) ** 2 +
          (bl.end.z - bl.start.z) ** 2,
        );
        const values = [
          `B${ri + 1}`,
          bl.angle.toFixed(1),
          edgeLen.toFixed(1),
        ];

        colX = m;
        for (let ci = 0; ci < values.length; ci++) {
          const textW = font.widthOfTextAtSize(values[ci], 6.5);
          page.drawText(values[ci], {
            x: colX + colWidths[ci] / 2 - textW / 2,
            y: curY - rowH + 4,
            size: 6.5,
            font,
            color: DARK_GRAY,
          });
          colX += colWidths[ci];
        }

        curY -= rowH;
      }
    }

    // Table border
    page.drawRectangle({
      x: m,
      y: curY,
      width: tableW,
      height: tableTopY - curY - 18,
      borderColor: BORDER_GRAY,
      borderWidth: 0.5,
    });

    curY -= 6;
  }

  // ── TITLE BLOCK ───────────────────────────────────────

  page.drawRectangle({
    x: m,
    y: curY - titleBlockH,
    width: contentW,
    height: titleBlockH,
    color: DARK_BLUE,
  });

  const now = new Date();
  const dateStr = `${now.getDate().toString().padStart(2, "0")}/${(now.getMonth() + 1).toString().padStart(2, "0")}/${now.getFullYear()}`;
  const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

  // Left column
  page.drawText(`Part: ${partInfo.name || "Untitled"}`, {
    x: m + 12,
    y: curY - 14,
    size: 7,
    font,
    color: WHITE,
  });
  page.drawText(`Generated: ${dateStr} ${timeStr}`, {
    x: m + 12,
    y: curY - 26,
    size: 7,
    font,
    color: rgb(0.7, 0.7, 0.8),
  });
  page.drawText(`Server-side PDF (vector wireframe)`, {
    x: m + 12,
    y: curY - 38,
    size: 6,
    font,
    color: rgb(0.5, 0.5, 0.6),
  });

  // Center column
  const footerThickness = unfoldData?.thickness_mm ? unfoldData.thickness_mm.toFixed(2) : (partInfo.thickness || "\u2014");
  const footerBends = unfoldData?.bends?.length || analysis.bendLines.length;
  const centerText1 = `Thickness: ${footerThickness} mm  |  Material: ${partInfo.material || "\u2014"}  |  Bends: ${footerBends}`;
  const footerFlatW = unfoldData?.flat_pattern?.width_mm || dims.x;
  const footerFlatH = unfoldData?.flat_pattern?.height_mm || dims.z;
  const centerText2 = `Flat size: ${footerFlatW.toFixed(1)} \u00d7 ${footerFlatH.toFixed(1)} mm  |  Weight: ${weight || "\u2014"}`;
  page.drawText(centerText1, {
    x: m + contentW / 2 - font.widthOfTextAtSize(centerText1, 7) / 2,
    y: curY - 14,
    size: 7,
    font,
    color: WHITE,
  });
  page.drawText(centerText2, {
    x: m + contentW / 2 - font.widthOfTextAtSize(centerText2, 7) / 2,
    y: curY - 26,
    size: 7,
    font,
    color: rgb(0.7, 0.7, 0.8),
  });

  // Right column
  const companyName = "MICRONS HUB DV E.E.";
  page.drawText(companyName, {
    x: pageW - m - 12 - fontBold.widthOfTextAtSize(companyName, 8),
    y: curY - 14,
    size: 8,
    font: fontBold,
    color: WHITE,
  });
  const sheetInfo = `Scale: NTS  |  Sheet 1/1  |  File: ${fileName}`;
  page.drawText(sheetInfo, {
    x: pageW - m - 12 - font.widthOfTextAtSize(sheetInfo, 7),
    y: curY - 26,
    size: 7,
    font,
    color: rgb(0.7, 0.7, 0.8),
  });

  // Note line
  page.drawText(
    "NOTE: Verify all dimensions before production. Bend allowances must be calculated per material K-factor. All dimensions in mm.",
    {
      x: m + 12,
      y: curY - titleBlockH + 4,
      size: 5,
      font,
      color: rgb(0.5, 0.5, 0.6),
    },
  );

  return await doc.save();
}
