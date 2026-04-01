/**
 * Sheet Metal Nesting API
 *
 * POST /api/nest
 * Content-Type: application/json
 * Body: {
 *   files: string[],          // DXF file contents (one per unique part)
 *   metadata: {
 *     parts: [{ fileIndex, name, material, thickness, quantity }],
 *     config: { sheetSize?, gap?, edgeMargin?, rotationMode?, optimizationLevel? }
 *   }
 * }
 *
 * NOTE: For multipart/form-data with actual file uploads, you'd need
 * additional parsing. This endpoint accepts JSON with DXF strings directly,
 * which works for both API-to-API calls and frontend integration.
 */

import { nestOrder, NestingError } from '../lib/nesting/index.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
  }

  try {
    const { files, metadata } = req.body || {};

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing or empty "files" array. Provide DXF file contents as strings.',
      });
    }

    if (!metadata || !metadata.parts || !Array.isArray(metadata.parts) || metadata.parts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing or empty "metadata.parts" array.',
      });
    }

    // Validate each part entry
    for (const part of metadata.parts) {
      if (part.fileIndex === undefined || part.fileIndex < 0 || part.fileIndex >= files.length) {
        return res.status(400).json({
          success: false,
          error: `Invalid fileIndex ${part.fileIndex} for part "${part.name}". Must be 0-${files.length - 1}.`,
        });
      }
      if (!part.material) {
        return res.status(400).json({
          success: false,
          error: `Missing "material" for part "${part.name}".`,
        });
      }
      if (!part.thickness || part.thickness <= 0) {
        return res.status(400).json({
          success: false,
          error: `Invalid "thickness" for part "${part.name}". Must be > 0.`,
        });
      }
    }

    const result = await nestOrder(files, metadata);

    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof NestingError) {
      const statusMap = {
        INVALID_DXF: 400,
        NO_CLOSED_CONTOURS: 400,
        PART_TOO_LARGE: 400,
        EMPTY_ORDER: 400,
        INVALID_METADATA: 400,
        TIMEOUT: 504,
      };
      return res.status(statusMap[err.code] || 500).json({
        success: false,
        error: err.message,
        code: err.code,
        details: err.details,
      });
    }

    console.error('Nesting API error:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error during nesting.',
    });
  }
}
