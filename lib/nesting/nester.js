/**
 * Core 2D nesting engine for sheet metal parts.
 * Bottom-left-fill algorithm with bounding-box placement and rotation optimization.
 */

import ClipperLib from 'clipper-lib';
import {
  boundingBox,
  polygonArea,
  rotatePoints,
  translatePoints,
  centroid,
  toClipperPath,
  fromClipperPath,
  CLIPPER_SCALE,
  normalizeToOrigin,
} from './geometry.js';

/**
 * Check whether two bounding boxes overlap (including touching edges).
 * Each bbox: { minX, minY, maxX, maxY }
 */
function bboxOverlap(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

/**
 * Precise polygon intersection test via ClipperLib.
 * Returns true if polyA and polyB share any interior area.
 */
function polygonsOverlap(polyA, polyB) {
  const clipper = new ClipperLib.Clipper();
  const solution = new ClipperLib.Paths();
  clipper.AddPath(toClipperPath(polyA), ClipperLib.PolyType.ptSubject, true);
  clipper.AddPath(toClipperPath(polyB), ClipperLib.PolyType.ptClip, true);
  clipper.Execute(ClipperLib.ClipType.ctIntersection, solution);
  return solution.length > 0;
}

/**
 * Compute rotation angles array based on the rotation mode string.
 */
function getRotationAngles(rotationMode) {
  switch (rotationMode) {
    case 'none':
      return [0];
    case 'full':
      return [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
    case '90deg':
    default:
      return [0, 90, 180, 270];
  }
}

/**
 * Shuffle an array in place (Fisher-Yates) and return it.
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Pre-compute per-rotation data for a single part instance.
 * Returns an array (one entry per rotation angle) of:
 *   { angle, contour, bbox, gapBbox }
 * where contour is the outer polygon normalized to origin,
 * bbox is its tight bounding box, and gapBbox is bbox expanded by halfGap.
 */
function precomputeRotations(outerContour, angles, halfGap) {
  const c = centroid(outerContour);
  return angles.map((angle) => {
    const rotated = angle === 0
      ? outerContour
      : rotatePoints(outerContour, angle, c.x, c.y);
    const normalized = normalizeToOrigin(rotated);
    const bbox = boundingBox(normalized);
    const gapBbox = {
      minX: bbox.minX - halfGap,
      minY: bbox.minY - halfGap,
      maxX: bbox.maxX + halfGap,
      maxY: bbox.maxY + halfGap,
      w: bbox.w + 2 * halfGap,
      h: bbox.h + 2 * halfGap,
    };
    return { angle, contour: normalized, bbox, gapBbox };
  });
}

/**
 * Attempt to place parts in the given order using the bottom-left-fill heuristic.
 * Returns an array of sheet objects.
 */
function placeParts(preparedParts, effectiveW, effectiveH, edgeMargin, sheetW, sheetH, gap) {
  const sheets = []; // each: { placements, candidatePositions, placedBboxes, placedPolygons }

  function newSheet() {
    const sheet = {
      placements: [],
      candidatePositions: [{ x: 0, y: 0 }],
      placedBboxes: [],    // gap-expanded bboxes at placed positions
      placedPolygons: [],  // actual contours at placed positions
    };
    sheets.push(sheet);
    return sheet;
  }

  for (const part of preparedParts) {
    let bestPlacement = null; // { sheetIdx, x, y, rotIdx, score }

    // Try each existing sheet
    for (let si = 0; si < sheets.length; si++) {
      const sheet = sheets[si];
      const result = findBestPosition(part, sheet, effectiveW, effectiveH, gap);
      if (result) {
        const score = result.y * 1e9 + result.x; // lower is better
        if (!bestPlacement || score < bestPlacement.score) {
          bestPlacement = { sheetIdx: si, x: result.x, y: result.y, rotIdx: result.rotIdx, score };
        }
      }
    }

    if (!bestPlacement) {
      // Start a new sheet
      const sheet = newSheet();
      const si = sheets.length - 1;
      const result = findBestPosition(part, sheet, effectiveW, effectiveH, gap);
      if (result) {
        bestPlacement = { sheetIdx: si, x: result.x, y: result.y, rotIdx: result.rotIdx, score: 0 };
      } else {
        // Part cannot fit even on an empty sheet — skip (warning already recorded)
        continue;
      }
    }

    // Commit placement
    const sheet = sheets[bestPlacement.sheetIdx];
    const rot = part.rotations[bestPlacement.rotIdx];
    const px = bestPlacement.x;
    const py = bestPlacement.y;

    // Placed gap-expanded bbox
    const placedGapBbox = {
      minX: px + rot.gapBbox.minX,
      minY: py + rot.gapBbox.minY,
      maxX: px + rot.gapBbox.maxX,
      maxY: py + rot.gapBbox.maxY,
    };
    sheet.placedBboxes.push(placedGapBbox);

    // Placed polygon (actual contour, no gap expansion)
    const placedPoly = translatePoints(rot.contour, px, py);
    sheet.placedPolygons.push(placedPoly);

    // Add new candidate positions including gap offset
    const rightX = px + rot.bbox.w + gap;
    const topY = py + rot.bbox.h + gap;
    sheet.candidatePositions.push({ x: rightX, y: py });
    sheet.candidatePositions.push({ x: px, y: topY });

    sheet.placements.push({
      partId: part.partId,
      instanceId: part.instanceId,
      instanceIndex: part.instanceIndex,
      position: { x: px + edgeMargin, y: py + edgeMargin },
      rotation: rot.angle,
      bbox: { w: rot.bbox.w, h: rot.bbox.h },
      _area: part.area, // internal, stripped later
    });
  }

  return sheets;
}

/**
 * Find the best valid position for a part on a given sheet.
 * Returns { x, y, rotIdx } or null.
 */
function findBestPosition(part, sheet, effectiveW, effectiveH, gap) {
  let best = null; // { x, y, rotIdx, score }
  const halfGap = gap / 2;

  for (let ri = 0; ri < part.rotations.length; ri++) {
    const rot = part.rotations[ri];
    const bw = rot.gapBbox.w;
    const bh = rot.gapBbox.h;

    // Skip rotation if even the gap-expanded bbox doesn't fit the sheet
    if (bw > effectiveW + gap || bh > effectiveH + gap) continue;

    for (const cp of sheet.candidatePositions) {
      const cx = cp.x;
      const cy = cp.y;

      // Check that the part's actual bbox fits within effective area
      if (cx + rot.bbox.w > effectiveW + 0.01) continue;
      if (cy + rot.bbox.h > effectiveH + 0.01) continue;
      if (cx < -0.01 || cy < -0.01) continue;

      const score = cy * 1e9 + cx;
      if (best && score >= best.score) continue; // prune early

      // Build this part's gap-expanded bbox at this candidate position
      const candidateBbox = {
        minX: cx + rot.gapBbox.minX,
        minY: cy + rot.gapBbox.minY,
        maxX: cx + rot.gapBbox.maxX,
        maxY: cy + rot.gapBbox.maxY,
      };

      // Fast reject: check bbox overlap with all placed parts
      let hasOverlap = false;
      let needsClipperCheck = false;
      for (let pi = 0; pi < sheet.placedBboxes.length; pi++) {
        if (bboxOverlap(candidateBbox, sheet.placedBboxes[pi])) {
          // Bboxes overlap — do precise polygon check
          // We need to check the actual contour (with gap buffer via offset position)
          const candidatePoly = translatePoints(rot.contour, cx, cy);
          // Expand by gap: instead of polygon offset, check against placed polygon
          // The gap is already accounted for by the bbox expansion, but for precise
          // overlap we check the actual polygons. Since the bbox already includes gap,
          // if bboxes overlap the polygons might still not overlap. But if actual
          // polygons overlap, we definitely can't place here.
          if (polygonsOverlap(candidatePoly, sheet.placedPolygons[pi])) {
            hasOverlap = true;
            break;
          }
          // Even if polygons don't overlap, check that the gap is respected:
          // the gap-expanded bboxes overlapping means parts are too close at bbox level.
          // For a practical approach, we treat bbox-gap overlap as a collision to
          // guarantee minimum spacing.
          hasOverlap = true;
          break;
        }
      }

      if (hasOverlap) continue;

      best = { x: cx, y: cy, rotIdx: ri, score };
    }
  }

  return best;
}

/**
 * Score a set of sheets: lower is better.
 * Primary: number of sheets. Secondary: negative utilization of last sheet.
 */
function scoreSolution(sheets, sheetW, sheetH) {
  const sheetArea = sheetW * sheetH;
  const numSheets = sheets.length;
  if (numSheets === 0) return { numSheets: 0, lastUtil: 0 };

  const lastSheet = sheets[numSheets - 1];
  const lastPartArea = lastSheet.placements.reduce((sum, p) => sum + p._area, 0);
  const lastUtil = (lastPartArea / sheetArea) * 100;

  return { numSheets, lastUtil };
}

function isBetterSolution(a, b) {
  if (a.numSheets !== b.numSheets) return a.numSheets < b.numSheets;
  return a.lastUtil > b.lastUtil;
}

/**
 * Nest a group of parts onto sheets.
 *
 * @param {Array} parts - Array of part objects, each with:
 *   { partId, quantity, outerContour: [{x, y}, ...], ... }
 * @param {Object} config - Nesting configuration.
 * @returns {{ sheets: Array }}
 */
export async function nestGroup(parts, config) {
  const {
    sheetW = 2000,
    sheetH = 1000,
    gap = 3,
    edgeMargin = 5,
    rotationMode = '90deg',
    optimizationLevel = 'balanced',
    timeLimitMs = 50000,
  } = config || {};

  // Edge case: empty input
  if (!parts || parts.length === 0) {
    return { sheets: [] };
  }

  const startTime = Date.now();
  const angles = getRotationAngles(rotationMode);
  const halfGap = gap / 2;
  const effectiveW = sheetW - 2 * edgeMargin;
  const effectiveH = sheetH - 2 * edgeMargin;
  const sheetArea = sheetW * sheetH;

  const warnings = [];

  // Build expanded part instances with pre-computed rotation data
  const preparedParts = [];

  for (const part of parts) {
    const qty = part.quantity || 1;
    const outerContour = part.outerContour;
    if (!outerContour || outerContour.length < 3) continue;

    const rotations = precomputeRotations(outerContour, angles, halfGap);

    // Check if the part can fit on the sheet in any rotation
    const canFit = rotations.some(
      (r) => r.bbox.w <= effectiveW + 0.01 && r.bbox.h <= effectiveH + 0.01,
    );

    if (!canFit) {
      warnings.push(
        `Part "${part.partId}" is too large for the sheet (${sheetW}x${sheetH}mm) in any rotation — skipped.`,
      );
      continue;
    }

    const area = Math.abs(polygonArea(outerContour));

    for (let i = 0; i < qty; i++) {
      preparedParts.push({
        partId: part.partId,
        instanceId: `${part.partId}_${i}`,
        instanceIndex: i,
        outerContour,
        rotations,
        area,
      });
    }
  }

  if (preparedParts.length === 0) {
    return { sheets: [], warnings: warnings.length > 0 ? warnings : undefined };
  }

  // Sort by area descending (initial/default ordering)
  const areaSorted = [...preparedParts].sort((a, b) => b.area - a.area);

  // Determine number of attempts based on optimization level
  let numRandomAttempts;
  switch (optimizationLevel) {
    case 'fast':
      numRandomAttempts = 0;
      break;
    case 'best':
      numRandomAttempts = 15;
      break;
    case 'balanced':
    default:
      numRandomAttempts = 5;
      break;
  }

  // Run area-sorted placement first
  let bestSheets = placeParts(areaSorted, effectiveW, effectiveH, edgeMargin, sheetW, sheetH, gap);
  let bestScore = scoreSolution(bestSheets, sheetW, sheetH);

  // Try random permutations
  for (let attempt = 0; attempt < numRandomAttempts; attempt++) {
    // Check time limit
    if (Date.now() - startTime > timeLimitMs - 1000) break;

    const permuted = shuffle([...preparedParts]);
    const sheets = placeParts(permuted, effectiveW, effectiveH, edgeMargin, sheetW, sheetH, gap);
    const score = scoreSolution(sheets, sheetW, sheetH);

    if (isBetterSolution(score, bestScore)) {
      bestSheets = sheets;
      bestScore = score;
    }
  }

  // Build final output
  const resultSheets = bestSheets.map((sheet) => {
    const partArea = sheet.placements.reduce((sum, p) => sum + p._area, 0);
    const utilization = Math.round(((partArea / sheetArea) * 100) * 10) / 10;

    const placements = sheet.placements.map(({ _area, ...rest }) => rest);

    return {
      placements,
      utilization,
      partArea: Math.round(partArea * 100) / 100,
    };
  });

  const result = { sheets: resultSheets };
  if (warnings.length > 0) {
    result.warnings = warnings;
  }
  return result;
}
