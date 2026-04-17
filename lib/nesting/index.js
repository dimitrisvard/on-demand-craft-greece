/**
 * Nesting orchestrator — ties together DXF import, grouping, nesting,
 * SVG preview generation, and DXF export into a single nestOrder() call.
 */

import { parseDXF, NestingError } from './dxf-import.js';
import { groupPartsByMaterialThickness, autoSelectSheet } from './grouper.js';
import { nestGroup } from './nester.js';
import { generateSvgPreview } from './preview.js';
import { generateNestedDxf } from './dxf-export.js';

export { NestingError };

/**
 * Material density table in kg/m³ (used for weight estimation).
 */
const MATERIAL_DENSITY = {
  steel: 7850,
  'stainless steel': 7930,
  'carbon steel': 7850,
  aluminum: 2710,
  aluminium: 2710,
  copper: 8960,
  brass: 8530,
  titanium: 4510,
  zinc: 7130,
  iron: 7870,
  galvanized: 7850,
};

/**
 * Look up material density (kg/m³) by name, case-insensitive partial match.
 */
function getMaterialDensity(materialName) {
  const lower = (materialName || '').toLowerCase();
  for (const [key, density] of Object.entries(MATERIAL_DENSITY)) {
    if (lower.includes(key)) return density;
  }
  return 7850; // default to steel
}

/**
 * Nest an order of sheet-metal parts onto sheets grouped by material+thickness.
 *
 * @param {string[]} files — array of DXF file content strings (one per unique part)
 * @param {object} metadata — { parts: [...], config?: {...} }
 * @returns {Promise<object>} nesting result
 */
export async function nestOrder(files, metadata) {
  const warnings = [];

  try {
    // -----------------------------------------------------------------------
    // 1. Validate input
    // -----------------------------------------------------------------------
    if (!metadata || !metadata.parts || metadata.parts.length === 0) {
      throw new NestingError('No parts provided in the order', 'EMPTY_ORDER');
    }

    const startTime = Date.now();
    const config = metadata.config || {};

    // -----------------------------------------------------------------------
    // 2. Parse DXF files for each part
    // -----------------------------------------------------------------------
    const parsedParts = [];

    for (const partDef of metadata.parts) {
      try {
        const dxfContent = files[partDef.fileIndex];
        if (!dxfContent) {
          warnings.push(`Part "${partDef.name}": DXF file at index ${partDef.fileIndex} is missing or empty — skipped.`);
          continue;
        }

        const parsed = parseDXF(dxfContent, {
          id: partDef.name,
          name: partDef.name,
          material: partDef.material,
          thickness: partDef.thickness,
          quantity: partDef.quantity,
        });

        parsedParts.push(parsed);
      } catch (err) {
        warnings.push(`Part "${partDef.name}": failed to parse DXF — ${err.message}`);
      }
    }

    if (parsedParts.length === 0) {
      throw new NestingError(
        'All parts failed to parse — cannot proceed with nesting',
        'ALL_PARTS_FAILED',
      );
    }

    // -----------------------------------------------------------------------
    // 3. Group by material + thickness
    // -----------------------------------------------------------------------
    const groups = groupPartsByMaterialThickness(parsedParts);

    // -----------------------------------------------------------------------
    // 4. Nest each group
    // -----------------------------------------------------------------------
    const resultGroups = [];
    let totalPartsPlaced = 0;
    let totalSheetsUsed = 0;
    let totalPartArea = 0;
    let totalSheetArea = 0;

    for (const [groupKey, instances] of groups) {
      const [material, thicknessStr] = groupKey.split('|');
      const thickness = parseFloat(thicknessStr);

      try {
        // Determine sheet size
        const sheetSize = config.sheetSize
          ? { w: config.sheetSize.w, h: config.sheetSize.h }
          : autoSelectSheet(instances);

        // Build the parts array for the nester — use the original parsed parts
        // (before quantity expansion) with outerContour set to the outer polygon.
        // The grouper already expanded by quantity, so each instance carries the
        // full part geometry. We need to de-duplicate back to unique parts with
        // their quantities for the nester (which does its own expansion).
        const uniquePartsMap = new Map();
        for (const inst of instances) {
          const baseId = inst.id || inst.name;
          if (!uniquePartsMap.has(baseId)) {
            uniquePartsMap.set(baseId, {
              partId: baseId,
              outerContour: inst.outer,
              outer: inst.outer,
              holes: inst.holes,
              bendLines: inst.bendLines || [],
              name: inst.name,
              bbox: inst.bbox,
              area: inst.area,
              quantity: inst.quantity || 1,
            });
          }
        }
        const uniqueParts = [...uniquePartsMap.values()];

        // Call the nester
        const nestResult = await nestGroup(uniqueParts, {
          sheetW: sheetSize.w,
          sheetH: sheetSize.h,
          gap: config.gap ?? 3,
          edgeMargin: config.edgeMargin ?? 5,
          rotationMode: config.rotationMode || '90deg',
          optimizationLevel: config.optimizationLevel || 'balanced',
        });

        // Collect any nester warnings
        if (nestResult.warnings) {
          warnings.push(...nestResult.warnings);
        }

        // Build the partsLookup for preview/export — the original parsed parts
        // keyed by partId so the generators can find geometry.
        const partsLookup = uniqueParts;

        // Process each sheet
        const sheets = [];
        const sheetArea = sheetSize.w * sheetSize.h;
        const density = getMaterialDensity(material); // kg/m³

        let groupPartsArea = 0; // sum of net part areas across all sheets in this group

        for (let si = 0; si < nestResult.sheets.length; si++) {
          const sheetData = nestResult.sheets[si];

          // Generate SVG preview
          const previewSvg = generateSvgPreview(sheetData, sheetSize, partsLookup);

          // Generate DXF export (base64)
          const nestedDxfBase64 = generateNestedDxf(sheetData, sheetSize, partsLookup);

          // Calculate utilization stats
          const partArea = sheetData.partArea || 0; // net part area (outer minus holes)
          const utilization = sheetData.utilization || 0;
          const wasteArea = sheetArea - partArea;

          // Actual used bounding area on the sheet (rectangular envelope around placements)
          const usedBbox = sheetData.usedBbox || { w: 0, h: 0 };
          const usedAreaMm2 = usedBbox.w * usedBbox.h;
          const usedAreaM2 = Math.round(usedAreaMm2 / 1e6 * 10000) / 10000;

          // Weight of the parts actually cut from this sheet (based on net part area,
          // not the bounding box — a bbox includes gaps between parts and is not
          // representative of how much steel ends up in the finished parts).
          const partsVolumeM3 = (partArea * thickness) / 1e9;
          const partsWeightKg = Math.round(partsVolumeM3 * density * 100) / 100;

          // Weight of the raw sheet consumed from stock.
          const sheetVolumeM3 = (sheetArea * thickness) / 1e9;
          const sheetWeightKg = Math.round(sheetVolumeM3 * density * 100) / 100;

          const usedUtilization = usedAreaMm2 > 0
            ? Math.round((partArea / usedAreaMm2) * 1000) / 10
            : 0;

          sheets.push({
            sheetIndex: si,
            placements: sheetData.placements,
            utilization,
            partArea,
            sheetArea,
            wasteArea,
            previewSvg,
            nestedDxfBase64,
            usedBbox,
            usedAreaMm2: Math.round(usedAreaMm2),
            usedAreaM2,
            // Weight of the parts that come off this sheet (finished weight).
            partsWeightKg,
            // Weight of the full raw sheet consumed from stock.
            sheetWeightKg,
            // Kept for backward compatibility with earlier consumers — equals the
            // finished parts weight now that the bbox-based value has been retired.
            usedWeightKg: partsWeightKg,
            usedUtilization,
          });

          totalPartArea += partArea;
          totalSheetArea += sheetArea;
          groupPartsArea += partArea;
          totalPartsPlaced += sheetData.placements.length;
        }

        totalSheetsUsed += sheets.length;

        // Compute group-level stats
        const avgUtilization = sheets.length > 0
          ? Math.round((sheets.reduce((sum, s) => sum + s.utilization, 0) / sheets.length) * 10) / 10
          : 0;

        // Raw material pulled from stock for this group: N full sheets.
        const groupTotalSheetArea = sheets.length * sheetArea; // mm²
        const sheetsVolumeM3 = (groupTotalSheetArea * thickness) / 1e9;
        const sheetsWeightKg = Math.round(sheetsVolumeM3 * density * 100) / 100;

        // Actual weight of the parts produced (net, after subtracting holes).
        const partsVolumeM3 = (groupPartsArea * thickness) / 1e9;
        const partsWeightKg = Math.round(partsVolumeM3 * density * 100) / 100;

        const totalMaterialDimensions = {
          sheetsW: sheetSize.w,
          sheetsH: sheetSize.h,
          totalSheets: sheets.length,
          totalAreaMm2: Math.round(groupTotalSheetArea),
          totalAreaM2: Math.round(groupTotalSheetArea / 1e6 * 1000) / 1000,
          partsAreaMm2: Math.round(groupPartsArea),
          partsAreaM2: Math.round(groupPartsArea / 1e6 * 10000) / 10000,
        };

        resultGroups.push({
          material,
          thickness,
          sheetSize,
          sheets,
          totalSheets: sheets.length,
          avgUtilization,
          totalMaterialDimensions,
          // Total raw-sheet weight consumed from stock.
          sheetsWeightKg,
          // Net weight of the finished parts.
          partsWeightKg,
          // Backwards-compatible alias — previously this was the raw-sheet weight.
          weightKg: sheetsWeightKg,
          densityKgM3: density,
        });
      } catch (err) {
        warnings.push(`Group "${material} ${thickness}mm": nesting failed — ${err.message}`);
      }
    }

    // -----------------------------------------------------------------------
    // 5. Build summary
    // -----------------------------------------------------------------------
    const nestingTimeMs = Date.now() - startTime;
    const overallUtilization = totalSheetArea > 0
      ? Math.round(((totalPartArea / totalSheetArea) * 100) * 10) / 10
      : 0;

    // Aggregate weights across all groups. Two separate totals are exposed:
    //  - totalSheetsWeightKg: what you pull from stock (full sheets × thickness)
    //  - totalPartsWeightKg:  what the finished parts actually weigh (net area)
    const totalSheetsWeightKg = Math.round(
      resultGroups.reduce((sum, g) => sum + (g.sheetsWeightKg || 0), 0) * 100
    ) / 100;
    const totalPartsWeightKg = Math.round(
      resultGroups.reduce((sum, g) => sum + (g.partsWeightKg || 0), 0) * 100
    ) / 100;

    return {
      success: true,
      groups: resultGroups,
      summary: {
        totalParts: totalPartsPlaced,
        totalSheets: totalSheetsUsed,
        materialGroups: resultGroups.length,
        overallUtilization,
        totalSheetsWeightKg,
        totalPartsWeightKg,
        // Backwards-compatible alias — historically this was the raw sheet weight.
        totalWeightKg: totalSheetsWeightKg,
        nestingTimeMs,
      },
      warnings,
    };
  } catch (err) {
    // Re-throw NestingErrors as-is
    if (err instanceof NestingError) {
      throw err;
    }
    // Wrap unexpected errors
    throw new NestingError(
      `Unexpected nesting error: ${err.message}`,
      'INTERNAL_ERROR',
      { originalError: err.message },
    );
  }
}
