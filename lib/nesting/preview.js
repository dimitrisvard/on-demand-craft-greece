/**
 * SVG preview generator for nested sheet metal layouts.
 * Produces a raw SVG string — no DOM, no external dependencies.
 */

import { rotatePoints, translatePoints, centroid, boundingBox } from './geometry.js';

const COLOR_PALETTE = [
  '#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed',
  '#db2777', '#0891b2', '#65a30d', '#ea580c', '#6366f1',
];

/**
 * Convert a hex color to an rgba() string with the given alpha.
 */
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Format a polygon's points into an SVG points attribute string.
 */
function svgPointsAttr(points) {
  return points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
}

/**
 * Truncate a string to maxLen characters, appending "..." if truncated.
 */
function truncate(str, maxLen = 12) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '\u2026';
}

/**
 * Escape special XML characters in a string.
 */
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Transform a part's contour for a given placement: rotate around the
 * contour's own centroid, then translate to the placement position.
 */
function transformContour(contour, placement) {
  const c = centroid(contour);
  const rotated = rotatePoints(contour, placement.rotation, c.x, c.y);
  const bb = boundingBox(rotated);
  // Translate so the rotated bounding-box origin aligns with placement.position
  return translatePoints(rotated, placement.position.x - bb.minX, placement.position.y - bb.minY);
}

/**
 * Compute the center of a transformed contour (for label positioning).
 */
function transformedCenter(contour, placement) {
  const transformed = transformContour(contour, placement);
  const c = centroid(transformed);
  return c;
}

/**
 * Generate an SVG preview string for a nested sheet layout.
 *
 * @param {object}  sheet        — { placements: [{ partId, instanceId, position: {x,y}, rotation, bbox: {w,h} }] }
 * @param {object}  sheetSize    — { w, h } in mm
 * @param {Array}   partsLookup  — original part objects with outer, holes, and name
 * @returns {string} Raw SVG markup
 */
export function generateSvgPreview(sheet, sheetSize, partsLookup) {
  const padding = 60;
  const vbW = sheetSize.w + padding * 2;
  const vbH = sheetSize.h + padding * 2;
  // Keep height proportional to width=1200
  const svgHeight = Math.round((1200 * vbH) / vbW);

  // Build a stable color map: each unique partId gets a consistent color index
  const uniquePartIds = [...new Set(sheet.placements.map((p) => p.partId))];
  const colorMap = new Map();
  uniquePartIds.forEach((id, idx) => {
    colorMap.set(id, COLOR_PALETTE[idx % COLOR_PALETTE.length]);
  });

  // Count parts per partId for the legend
  const partCounts = new Map();
  for (const pl of sheet.placements) {
    partCounts.set(pl.partId, (partCounts.get(pl.partId) || 0) + 1);
  }

  // Compute utilization: sum of placement bbox areas / sheet area
  let usedArea = 0;
  for (const pl of sheet.placements) {
    usedArea += pl.bbox.w * pl.bbox.h;
  }
  const utilization = ((usedArea / (sheetSize.w * sheetSize.h)) * 100).toFixed(1);

  // ---- Build SVG pieces ----
  const parts = [];

  // Flipped-geometry group: scale(1,-1) translate(0, -sheetSize.h) so Y goes up
  const geomParts = [];
  const holeParts = [];

  for (const placement of sheet.placements) {
    const part = partsLookup.find(
      (p) => p.partId === placement.partId || p.name === placement.partId,
    );
    if (!part || !part.outer) continue;

    const color = colorMap.get(placement.partId);
    const outerTransformed = transformContour(part.outer, placement);

    geomParts.push(
      `<polygon points="${svgPointsAttr(outerTransformed)}" ` +
        `fill="${hexToRgba(color, 0.3)}" stroke="${color}" stroke-width="1.5" />`,
    );

    // Holes
    if (part.holes && part.holes.length > 0) {
      for (const hole of part.holes) {
        const holeTransformed = transformContour(hole, placement);
        holeParts.push(
          `<polygon points="${svgPointsAttr(holeTransformed)}" ` +
            `fill="#ffffff" stroke="#999999" stroke-width="0.75" />`,
        );
      }
    }
  }

  // Labels for parts (NOT flipped — rendered in normal SVG coordinate space)
  const labelParts = [];
  for (const placement of sheet.placements) {
    const part = partsLookup.find(
      (p) => p.partId === placement.partId || p.name === placement.partId,
    );
    if (!part || !part.outer) continue;

    const center = transformedCenter(part.outer, placement);
    // In the flipped group Y goes up, but labels are in unflipped space.
    // So mirror the y coordinate: svgY = sheetSize.h - cadY
    const labelX = center.x;
    const labelY = sheetSize.h - center.y;

    const displayName = truncate(part.name || placement.partId);
    labelParts.push(
      `<text x="${labelX.toFixed(2)}" y="${labelY.toFixed(2)}" ` +
        `font-size="8" font-family="sans-serif" fill="#000000" ` +
        `text-anchor="middle" dominant-baseline="central">${escapeXml(displayName)}</text>`,
    );
  }

  // ---- Dimension labels ----
  const widthLabel = `${sheetSize.w} mm`;
  const heightLabel = `${sheetSize.h} mm`;

  // ---- Utilization badge (top-right inside the sheet, unflipped coords) ----
  const badgeText = `${utilization}% utilization`;
  const badgeW = badgeText.length * 5.5 + 16;
  const badgeH = 20;
  const badgeX = sheetSize.w - badgeW - 8;
  const badgeY = 8;

  // ---- Scale bar (bottom-left, outside the sheet) ----
  const scaleBarY = sheetSize.h + 20;
  const scaleBarX = 0;
  const scaleBarLen = 100; // 100 mm

  // ---- Legend (below the sheet) ----
  const legendY = sheetSize.h + 40;
  const legendItems = [];
  let legendOffset = 0;
  for (const partId of uniquePartIds) {
    const part = partsLookup.find(
      (p) => p.partId === partId || p.name === partId,
    );
    const name = part ? part.name || partId : partId;
    const color = colorMap.get(partId);
    const count = partCounts.get(partId);

    legendItems.push(
      `<rect x="${legendOffset}" y="${legendY}" width="10" height="10" rx="2" fill="${color}" />` +
        `<text x="${legendOffset + 14}" y="${legendY + 8}" font-size="7" font-family="sans-serif" fill="#333333">` +
        `${escapeXml(truncate(name, 16))} (x${count})</text>`,
    );
    legendOffset += 14 + (name.length + 6) * 4.5 + 12;
  }

  // ---- Assemble SVG ----
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${svgHeight}" viewBox="-${padding} -${padding} ${vbW} ${vbH}">
  <!-- Background -->
  <rect x="-${padding}" y="-${padding}" width="${vbW}" height="${vbH}" fill="#f8f9fa" />

  <!-- Sheet outline -->
  <rect x="0" y="0" width="${sheetSize.w}" height="${sheetSize.h}" fill="#ffffff" stroke="#dee2e6" stroke-width="1.5" stroke-dasharray="6,4" />

  <!-- Geometry group (Y-flipped: CAD convention, Y up) -->
  <g transform="scale(1,-1) translate(0,-${sheetSize.h})">
    ${geomParts.join('\n    ')}
    ${holeParts.join('\n    ')}
  </g>

  <!-- Part labels (unflipped, normal SVG coords) -->
  <g>
    ${labelParts.join('\n    ')}
  </g>

  <!-- Dimension label: width (centered above the sheet) -->
  <text x="${sheetSize.w / 2}" y="-20" font-size="10" font-family="sans-serif" fill="#666666" text-anchor="middle">${escapeXml(widthLabel)}</text>

  <!-- Dimension label: height (rotated, right side) -->
  <text x="${sheetSize.w + 25}" y="${sheetSize.h / 2}" font-size="10" font-family="sans-serif" fill="#666666" text-anchor="middle" transform="rotate(90,${sheetSize.w + 25},${sheetSize.h / 2})">${escapeXml(heightLabel)}</text>

  <!-- Utilization badge (top-right inside sheet) -->
  <rect x="${badgeX.toFixed(2)}" y="${badgeY}" width="${badgeW.toFixed(2)}" height="${badgeH}" rx="4" fill="rgba(0,0,0,0.65)" />
  <text x="${(badgeX + badgeW / 2).toFixed(2)}" y="${badgeY + badgeH / 2 + 1}" font-size="8" font-family="sans-serif" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${escapeXml(badgeText)}</text>

  <!-- Scale bar (bottom-left, outside the sheet) -->
  <line x1="${scaleBarX}" y1="${scaleBarY}" x2="${scaleBarX + scaleBarLen}" y2="${scaleBarY}" stroke="#333333" stroke-width="1.5" />
  <line x1="${scaleBarX}" y1="${scaleBarY - 3}" x2="${scaleBarX}" y2="${scaleBarY + 3}" stroke="#333333" stroke-width="1.5" />
  <line x1="${scaleBarX + scaleBarLen}" y1="${scaleBarY - 3}" x2="${scaleBarX + scaleBarLen}" y2="${scaleBarY + 3}" stroke="#333333" stroke-width="1.5" />
  <text x="${scaleBarX + scaleBarLen / 2}" y="${scaleBarY + 12}" font-size="7" font-family="sans-serif" fill="#333333" text-anchor="middle">100 mm</text>

  <!-- Legend -->
  <g>
    ${legendItems.join('\n    ')}
  </g>
</svg>`;

  return svg;
}
