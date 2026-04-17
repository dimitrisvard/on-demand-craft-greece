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

    // Build the part model. When the parser produced multiple pieces (e.g.
    // unfolded sheet metal with disconnected components) emit each piece as
    // its own outer + holes group so the nested DXF preserves the true
    // geometry instead of degrading to the convex-hull bounding shape.
    const partModel = {
      models: {},
      paths: {},
    };

    const pieces =
      part.pieces && Array.isArray(part.pieces) && part.pieces.length > 0
        ? part.pieces
        : [{ outer: part.outer, holes: part.holes || [] }];

    for (let pi = 0; pi < pieces.length; pi++) {
      const piece = pieces[pi];
      if (!piece || !piece.outer || piece.outer.length < 3) continue;

      const outerPoints = piece.outer.map((p) => [p.x, p.y]);
      const outerContour = new makerjs.models.ConnectTheDots(true, outerPoints);
      const pieceKey = pieces.length === 1 ? 'outer' : `outer_${pi}`;
      partModel.models[pieceKey] = outerContour;

      if (piece.holes && piece.holes.length > 0) {
        for (let h = 0; h < piece.holes.length; h++) {
          const holePoints = piece.holes[h].map((p) => [p.x, p.y]);
          const holeContour = new makerjs.models.ConnectTheDots(true, holePoints);
          const holeKey = pieces.length === 1 ? `hole_${h}` : `hole_${pi}_${h}`;
          partModel.models[holeKey] = holeContour;
        }
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
