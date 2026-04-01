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

        for (let si = 0; si < nestResult.sheets.length; si++) {
          const sheetData = nestResult.sheets[si];

          // Generate SVG preview
          const previewSvg = generateSvgPreview(sheetData, sheetSize, partsLookup);

          // Generate DXF export (base64)
          const nestedDxfBase64 = generateNestedDxf(sheetData, sheetSize, partsLookup);

          // Calculate utilization stats
          const partArea = sheetData.partArea || 0;
          const utilization = sheetData.utilization || 0;
          const wasteArea = sheetArea - partArea;

          sheets.push({
            sheetIndex: si,
            placements: sheetData.placements,
            utilization,
            partArea,
            sheetArea,
            wasteArea,
            previewSvg,
            nestedDxfBase64,
          });

          totalPartArea += partArea;
          totalSheetArea += sheetArea;
          totalPartsPlaced += sheetData.placements.length;
        }

        totalSheetsUsed += sheets.length;

        // Compute group-level stats
        const avgUtilization = sheets.length > 0
          ? Math.round((sheets.reduce((sum, s) => sum + s.utilization, 0) / sheets.length) * 10) / 10
          : 0;

        resultGroups.push({
          material,
          thickness,
          sheetSize,
          sheets,
          totalSheets: sheets.length,
          avgUtilization,
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

    return {
      success: true,
      groups: resultGroups,
      summary: {
        totalParts: totalPartsPlaced,
        totalSheets: totalSheetsUsed,
        materialGroups: resultGroups.length,
        overallUtilization,
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
