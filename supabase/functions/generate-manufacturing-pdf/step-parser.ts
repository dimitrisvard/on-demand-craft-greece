/**
 * STEP/STP File Parser for Deno Edge Functions
 *
 * Uses occt-import-js (WebAssembly OpenCascade) to convert STEP files
 * into triangle mesh data compatible with the existing analysis pipeline.
 *
 * The WASM binary is fetched over HTTP from a CDN since Supabase Edge
 * Functions don't have filesystem access for WASM files.
 */

import { type Triangle, type Vec3, type STLData } from "./stl-parser.ts";

const WASM_CDN_URL =
  "https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.wasm";

// Cache the loaded module across requests (warm instances)
let occtModule: any = null;

async function getOCCT(): Promise<any> {
  if (occtModule) return occtModule;

  console.log("Fetching OpenCascade WASM binary from CDN...");
  const wasmResp = await fetch(WASM_CDN_URL);
  if (!wasmResp.ok) {
    throw new Error(`Failed to fetch OpenCascade WASM: HTTP ${wasmResp.status}`);
  }
  const wasmBinary = await wasmResp.arrayBuffer();
  console.log(`WASM downloaded: ${(wasmBinary.byteLength / 1024 / 1024).toFixed(1)} MB`);

  // Import the JS wrapper using browser target to avoid Deno filesystem WASM loading
  const { default: occtimportjs } = await import(
    "https://esm.sh/occt-import-js@0.0.23?target=browser"
  );

  // Pass the WASM binary directly so it doesn't try to read from filesystem
  occtModule = await occtimportjs({
    wasmBinary,
    locateFile: () => WASM_CDN_URL,
  });

  console.log("OpenCascade WASM module initialized");
  return occtModule;
}

/**
 * Parse a STEP/STP file buffer into triangle data.
 *
 * Uses OpenCascade WASM to tessellate the B-Rep geometry into a triangle mesh,
 * then converts to the same Triangle[] format used by the STL parser.
 */
export async function parseSTEP(buffer: ArrayBuffer): Promise<STLData> {
  const occt = await getOCCT();

  const fileContent = new Uint8Array(buffer);
  const result = occt.ReadStepFile(fileContent, null);

  if (!result.success) {
    throw new Error("Failed to parse STEP file with OpenCascade");
  }

  const triangles: Triangle[] = [];

  for (const mesh of result.meshes) {
    const positions = mesh.attributes.position.array;
    const normals = mesh.attributes.normal?.array;
    const indices = mesh.index.array;

    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i] * 3;
      const i1 = indices[i + 1] * 3;
      const i2 = indices[i + 2] * 3;

      const v0: Vec3 = { x: positions[i0], y: positions[i0 + 1], z: positions[i0 + 2] };
      const v1: Vec3 = { x: positions[i1], y: positions[i1 + 1], z: positions[i1 + 2] };
      const v2: Vec3 = { x: positions[i2], y: positions[i2 + 1], z: positions[i2 + 2] };

      // Compute face normal from vertices if normals not available
      let normal: Vec3;
      if (normals) {
        normal = {
          x: (normals[i0] + normals[i1] + normals[i2]) / 3,
          y: (normals[i0 + 1] + normals[i1 + 1] + normals[i2 + 1]) / 3,
          z: (normals[i0 + 2] + normals[i1 + 2] + normals[i2 + 2]) / 3,
        };
      } else {
        const e1x = v1.x - v0.x, e1y = v1.y - v0.y, e1z = v1.z - v0.z;
        const e2x = v2.x - v0.x, e2y = v2.y - v0.y, e2z = v2.z - v0.z;
        normal = {
          x: e1y * e2z - e1z * e2y,
          y: e1z * e2x - e1x * e2z,
          z: e1x * e2y - e1y * e2x,
        };
      }

      triangles.push({ normal, v0, v1, v2 });
    }
  }

  if (triangles.length === 0) {
    throw new Error("STEP file produced no geometry — the file may be empty or contain only assembly structure");
  }

  console.log(`STEP parsed: ${result.meshes.length} bodies → ${triangles.length} triangles`);

  return { triangles, vertexCount: triangles.length * 3 };
}
