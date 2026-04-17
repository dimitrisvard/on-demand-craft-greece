/**
 * SVG preview generator for nested sheet metal layouts.
 * Produces a raw SVG string — no DOM, no external dependencies.
 */

import { rotatePoints, translatePoints, centroid, boundingBox } from './geometry.js';

const COLOR_PALETTE = [
  '#1d4ed8', '#b91c1c', '#047857', '#b45309', '#6d28d9',
  '#be185d', '#0e7490', '#4d7c0f', '#c2410c', '#4f46e5',
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
 * Works in sheet coordinates (before Y-mirror).
 */
function transformContour(contour, placement) {
  const c = centroid(contour);
  const rotated = rotatePoints(contour, placement.rotation, c.x, c.y);
  const bb = boundingBox(rotated);
  // Translate so the rotated bounding-box origin aligns with placement.position
  return translatePoints(rotated, placement.position.x - bb.minX, placement.position.y - bb.minY);
}

/**
 * Transform a hole contour for a given placement, using the outer contour
 * as the reference for rotation center and translation.
 * Holes must rotate around the outer contour's centroid (not their own)
 * and translate by the same offset as the outer contour.
 */
function transformHoleContour(holeContour, outerContour, placement) {
  const outerC = centroid(outerContour);
  // Rotate hole around the outer contour's centroid
  const rotatedHole = rotatePoints(holeContour, placement.rotation, outerC.x, outerC.y);
  // Compute translation from the outer contour's rotation
  const rotatedOuter = rotatePoints(outerContour, placement.rotation, outerC.x, outerC.y);
  const outerBB = boundingBox(rotatedOuter);
  const dx = placement.position.x - outerBB.minX;
  const dy = placement.position.y - outerBB.minY;
  return translatePoints(rotatedHole, dx, dy);
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

  // Utilization = net part area / sheet area. Prefer the value already computed
  // by the nester (which uses net area, accounting for holes); fall back to the
  // placement bbox-area sum only if the nester did not provide one.
  const sheetAreaMm2 = sheetSize.w * sheetSize.h;
  let utilization;
  if (typeof sheet.utilization === 'number') {
    utilization = sheet.utilization.toFixed(1);
  } else if (typeof sheet.partArea === 'number' && sheet.partArea > 0) {
    utilization = ((sheet.partArea / sheetAreaMm2) * 100).toFixed(1);
  } else {
    let bboxAreaSum = 0;
    for (const pl of sheet.placements) {
      bboxAreaSum += pl.bbox.w * pl.bbox.h;
    }
    utilization = ((bboxAreaSum / sheetAreaMm2) * 100).toFixed(1);
  }

  // ---- Build SVG pieces ----
  const geomParts = [];
  const holeParts = [];
  const bendParts = [];

  /**
   * Mirror a contour's Y coordinates: svgY = sheetSize.h - cadY
   * so the nesting layout renders correctly in SVG (Y-down) space.
   */
  function mirrorY(points) {
    return points.map((p) => ({ x: p.x, y: sheetSize.h - p.y }));
  }

  // Track how many parts matched for diagnostics
  let matchedParts = 0;

  for (const placement of sheet.placements) {
    const part = partsLookup.find(
      (p) => p.partId === placement.partId || p.name === placement.partId,
    );

    if (!part || !part.outer || part.outer.length < 3) {
      // Fallback: render placement bbox as a rectangle when contour data is missing
      const color = colorMap.get(placement.partId) || '#999999';
      const x = placement.position.x;
      const y = sheetSize.h - placement.position.y - placement.bbox.h;
      geomParts.push(
        `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${placement.bbox.w.toFixed(2)}" height="${placement.bbox.h.toFixed(2)}" ` +
          `fill="${hexToRgba(color, 0.35)}" stroke="${color}" stroke-width="2" stroke-dasharray="4,2" />`,
      );
      matchedParts++;
      continue;
    }

    matchedParts++;
    const color = colorMap.get(placement.partId);
    const outerTransformed = mirrorY(transformContour(part.outer, placement));

    geomParts.push(
      `<polygon points="${svgPointsAttr(outerTransformed)}" ` +
        `fill="${hexToRgba(color, 0.55)}" stroke="${color}" stroke-width="2" />`,
    );

    // Holes — rotate around the outer contour's centroid, not the hole's own
    if (part.holes && part.holes.length > 0) {
      for (const hole of part.holes) {
        const holeTransformed = mirrorY(transformHoleContour(hole, part.outer, placement));
        holeParts.push(
          `<polygon points="${svgPointsAttr(holeTransformed)}" ` +
            `fill="#ffffff" stroke="#333333" stroke-width="1.2" />`,
        );
      }
    }

    // Bend lines — draw in red dashed, same rotation/translation as the part's
    // outer contour. Treat each bend line as a two-point polyline so the same
    // centroid-based rotation used for holes positions it correctly.
    if (part.bendLines && part.bendLines.length > 0) {
      for (const bl of part.bendLines) {
        const bendPoly = [
          { x: bl.start.x, y: bl.start.y },
          { x: bl.end.x, y: bl.end.y },
        ];
        const [ps, pe] = mirrorY(
          transformHoleContour(bendPoly, part.outer, placement),
        );
        const color = bl.direction === 'DOWN' ? '#2E6EA6' : '#c0392b';
        const dash = bl.direction === 'DOWN' ? '6,3,2,3' : '6,3';
        bendParts.push(
          `<line x1="${ps.x.toFixed(2)}" y1="${ps.y.toFixed(2)}" ` +
            `x2="${pe.x.toFixed(2)}" y2="${pe.y.toFixed(2)}" ` +
            `stroke="${color}" stroke-width="1.5" stroke-dasharray="${dash}" />`,
        );
      }
    }
  }

  // Labels for parts
  const labelParts = [];
  for (const placement of sheet.placements) {
    const part = partsLookup.find(
      (p) => p.partId === placement.partId || p.name === placement.partId,
    );

    // Label position: use transformed center if contour available, else bbox center
    let labelX, labelY;
    if (part && part.outer && part.outer.length >= 3) {
      const center = centroid(transformContour(part.outer, placement));
      labelX = center.x;
      labelY = sheetSize.h - center.y;
    } else {
      labelX = placement.position.x + placement.bbox.w / 2;
      labelY = sheetSize.h - placement.position.y - placement.bbox.h / 2;
    }

    const displayName = truncate((part && part.name) || placement.partId);
    const labelW = displayName.length * 5 + 6;
    const labelH = 12;
    labelParts.push(
      `<rect x="${(labelX - labelW / 2).toFixed(2)}" y="${(labelY - labelH / 2).toFixed(2)}" ` +
        `width="${labelW}" height="${labelH}" rx="2" fill="rgba(255,255,255,0.85)" stroke="none" />`,
    );
    labelParts.push(
      `<text x="${labelX.toFixed(2)}" y="${labelY.toFixed(2)}" ` +
        `font-size="8" font-weight="600" font-family="sans-serif" fill="#1a1a1a" ` +
        `text-anchor="middle" dominant-baseline="central">${escapeXml(displayName)}</text>`,
    );
  }

  // ---- Dimension labels ----
  const widthLabel = `${sheetSize.w} mm`;
  const heightLabel = `${sheetSize.h} mm`;

  // ---- Utilization badge (top-right inside the sheet) ----
  const badgeText = `${utilization}% utilization · ${matchedParts} part${matchedParts !== 1 ? 's' : ''}`;
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

  <!-- Geometry group -->
  <g>
    ${geomParts.join('\n    ')}
    ${holeParts.join('\n    ')}
    ${bendParts.join('\n    ')}
  </g>

  <!-- Part labels -->
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
