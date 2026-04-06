import makerjs from 'makerjs';
import { rotatePoints, translatePoints } from './geometry.js';

/**
 * Generates a DXF file (base64-encoded) for a nested sheet metal layout.
 *
 * @param {object} sheet - Object with a `placements` array
 * @param {{ w: number, h: number }} sheetSize - Sheet dimensions in mm
 * @param {Array} partsLookup - Original part objects (with outer, holes, name)
 * @returns {string} Base64-encoded DXF string
 */
export function generateNestedDxf(sheet, sheetSize, partsLookup) {
  const model = {
    models: {},
    paths: {},
  };

  // Sheet boundary rectangle on its own layer
  const sheetRect = new makerjs.models.Rectangle(sheetSize.w, sheetSize.h);
  sheetRect.layer = 'SHEET_BOUNDARY';
  model.models['SHEET_BOUNDARY'] = sheetRect;

  const placements = sheet.placements || [];

  for (let i = 0; i < placements.length; i++) {
    const placement = placements[i];
    const part = partsLookup.find((p) => p.partId === placement.partId || p.name === placement.partId);

    if (!part) continue;

    const partName = part.name || `part_${placement.partId}`;
    const layerName = `PART_${partName}`;

    // Build the outer contour model
    const outerPoints = part.outer.map((p) => [p.x, p.y]);
    const partModel = {
      models: {},
      paths: {},
    };

    const outerContour = new makerjs.models.ConnectTheDots(true, outerPoints);
    partModel.models['outer'] = outerContour;

    // Add hole contours
    if (part.holes && part.holes.length > 0) {
      for (let h = 0; h < part.holes.length; h++) {
        const holePoints = part.holes[h].map((p) => [p.x, p.y]);
        const holeContour = new makerjs.models.ConnectTheDots(true, holePoints);
        partModel.models[`hole_${h}`] = holeContour;
      }
    }

    // Apply rotation
    if (placement.rotation) {
      makerjs.model.rotate(partModel, placement.rotation);
    }

    // Apply translation
    if (placement.position) {
      makerjs.model.move(partModel, [placement.position.x, placement.position.y]);
    }

    // Set layer for the entire part model
    partModel.layer = layerName;

    model.models[`placement_${i}`] = partModel;
  }

  const dxfString = makerjs.exporter.toDXF(model);
  return Buffer.from(dxfString).toString('base64');
}
