/**
 * Groups sheet metal parts by material and thickness,
 * and selects appropriate standard sheets.
 */

export const STANDARD_SHEETS = [
  { w: 1000, h: 500, name: "1000x500" },
  { w: 1000, h: 1000, name: "1000x1000" },
  { w: 1250, h: 625, name: "1250x625" },
  { w: 1500, h: 750, name: "1500x750" },
  { w: 2000, h: 1000, name: "2000x1000" },
  { w: 2500, h: 1250, name: "2500x1250" },
  { w: 3000, h: 1500, name: "3000x1500" },
];

/**
 * Group parts by material and thickness, expanding each part by its quantity.
 *
 * @param {Array<{id: string, material: string, thickness: number, quantity?: number}>} parts
 * @returns {Map<string, Array<{instanceId: string, ...part}>>}
 *   Key is "material|thickness", value is array of expanded part instances.
 */
export function groupPartsByMaterialThickness(parts) {
  const groups = new Map();

  for (const part of parts) {
    const key = `${part.material}|${part.thickness}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }

    const qty = part.quantity ?? 1;
    const bucket = groups.get(key);

    for (let i = 0; i < qty; i++) {
      bucket.push({
        ...part,
        instanceId: `${part.id}_${i}`,
      });
    }
  }

  return groups;
}

/**
 * Find the smallest standard sheet that fits the largest part.
 * Both orientations of each part are considered.
 *
 * @param {Array<{bbox: {w: number, h: number}}>} parts
 * @returns {{ w: number, h: number, name: string }}
 */
export function autoSelectSheet(parts) {
  // Determine the minimum bounding requirement across all parts.
  let maxMinW = 0;
  let maxMinH = 0;

  for (const part of parts) {
    const { w, h } = part.bbox;
    // For each part, consider both orientations and pick the one that
    // yields the smaller minimum dimension requirements (min-side, max-side).
    const minSide = Math.min(w, h);
    const maxSide = Math.max(w, h);

    if (minSide > maxMinW) maxMinW = minSide;
    if (maxSide > maxMinH) maxMinH = maxSide;
  }

  // Find the smallest standard sheet (by area) that can contain the largest part.
  // A sheet fits if the required dimensions fit in either orientation.
  const sorted = [...STANDARD_SHEETS].sort((a, b) => a.w * a.h - b.w * b.h);

  for (const sheet of sorted) {
    const fitsNormal = maxMinW <= sheet.w && maxMinH <= sheet.h;
    const fitsRotated = maxMinW <= sheet.h && maxMinH <= sheet.w;

    if (fitsNormal || fitsRotated) {
      return sheet;
    }
  }

  // No standard sheet fits — return the largest one.
  return sorted[sorted.length - 1];
}
