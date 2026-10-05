/**
 * STL Binary/ASCII Parser for Deno Edge Functions
 *
 * Parses STL files into triangle arrays with normals.
 * Works without Three.js — pure math, no DOM dependencies.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Triangle {
  normal: Vec3;
  v0: Vec3;
  v1: Vec3;
  v2: Vec3;
}

export interface STLData {
  triangles: Triangle[];
  vertexCount: number;
}

/** Detect whether buffer is ASCII STL (starts with "solid") */
function isASCII(buffer: ArrayBuffer): boolean {
  const header = new Uint8Array(buffer, 0, Math.min(80, buffer.byteLength));
  const text = new TextDecoder().decode(header).trim();
  // ASCII STL starts with "solid" but binary can too — check if there's a "facet" keyword
  if (!text.startsWith("solid")) return false;
  const full = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(1000, buffer.byteLength)));
  return full.includes("facet");
}

/** Parse binary STL */
function parseBinary(buffer: ArrayBuffer): STLData {
  const view = new DataView(buffer);
  const numTriangles = view.getUint32(80, true);

  if (numTriangles === 0 || numTriangles > 5_000_000) {
    throw new Error(`Invalid triangle count: ${numTriangles}`);
  }

  const triangles: Triangle[] = new Array(numTriangles);
  let offset = 84; // Skip 80-byte header + 4-byte count

  for (let i = 0; i < numTriangles; i++) {
    triangles[i] = {
      normal: {
        x: view.getFloat32(offset, true),
        y: view.getFloat32(offset + 4, true),
        z: view.getFloat32(offset + 8, true),
      },
      v0: {
        x: view.getFloat32(offset + 12, true),
        y: view.getFloat32(offset + 16, true),
        z: view.getFloat32(offset + 20, true),
      },
      v1: {
        x: view.getFloat32(offset + 24, true),
        y: view.getFloat32(offset + 28, true),
        z: view.getFloat32(offset + 32, true),
      },
      v2: {
        x: view.getFloat32(offset + 36, true),
        y: view.getFloat32(offset + 40, true),
        z: view.getFloat32(offset + 44, true),
      },
    };
    offset += 50; // 12 floats * 4 bytes + 2 attribute bytes
  }

  return { triangles, vertexCount: numTriangles * 3 };
}

/** Parse ASCII STL */
function parseASCII(buffer: ArrayBuffer): STLData {
  const text = new TextDecoder().decode(new Uint8Array(buffer));
  const triangles: Triangle[] = [];

  const facetRegex =
    /facet\s+normal\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+outer\s+loop\s+vertex\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+vertex\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+vertex\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+endloop\s+endfacet/gi;

  let match: RegExpExecArray | null;
  while ((match = facetRegex.exec(text)) !== null) {
    const f = match.map(Number);
    triangles.push({
      normal: { x: f[1], y: f[2], z: f[3] },
      v0: { x: f[4], y: f[5], z: f[6] },
      v1: { x: f[7], y: f[8], z: f[9] },
      v2: { x: f[10], y: f[11], z: f[12] },
    });
  }

  if (triangles.length === 0) {
    throw new Error("No triangles found in ASCII STL");
  }

  return { triangles, vertexCount: triangles.length * 3 };
}

/** Parse an STL file (binary or ASCII) */
export function parseSTL(buffer: ArrayBuffer): STLData {
  if (buffer.byteLength < 84) {
    throw new Error("STL file too small");
  }
  return isASCII(buffer) ? parseASCII(buffer) : parseBinary(buffer);
}
