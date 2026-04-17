/**
 * Supabase Edge Function: extract-flat-pattern
 *
 * Extracts flat pattern data from 3D CAD files.
 * - STL files: mesh-based analysis (bend detection, flat pattern approximation)
 * - STEP files: delegates to FreeCAD Docker service for true B-Rep unfolding
 *
 * POST body:
 *   { file_url, file_name, order_id?, rfq_id? }
 *
 * Returns:
 *   { flat_pattern: { dimensions, bends, dxf_base64? }, analysis: {...} }
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_FILE_SIZE = 25 * 1024 * 1024;

function isSTL(name: string): boolean {
  return /\.stl$/i.test(name);
}
function isSTEP(name: string): boolean {
  return /\.(step|stp)$/i.test(name);
}

// ── Inline STL parser (lightweight for this endpoint) ───────────────────────

interface Vec3 { x: number; y: number; z: number }
interface Triangle { normal: Vec3; v0: Vec3; v1: Vec3; v2: Vec3 }

function parseSTLBinary(buffer: ArrayBuffer): Triangle[] {
  const view = new DataView(buffer);
  const numTri = view.getUint32(80, true);
  const triangles: Triangle[] = new Array(numTri);
  let off = 84;
  for (let i = 0; i < numTri; i++) {
    triangles[i] = {
      normal: { x: view.getFloat32(off, true), y: view.getFloat32(off + 4, true), z: view.getFloat32(off + 8, true) },
      v0: { x: view.getFloat32(off + 12, true), y: view.getFloat32(off + 16, true), z: view.getFloat32(off + 20, true) },
      v1: { x: view.getFloat32(off + 24, true), y: view.getFloat32(off + 28, true), z: view.getFloat32(off + 32, true) },
      v2: { x: view.getFloat32(off + 36, true), y: view.getFloat32(off + 40, true), z: view.getFloat32(off + 44, true) },
    };
    off += 50;
  }
  return triangles;
}

function v3sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function v3cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function v3dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function v3len(v: Vec3): number { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
function v3normalize(v: Vec3): Vec3 {
  const l = v3len(v);
  return l < 1e-10 ? { x: 0, y: 0, z: 0 } : { x: v.x / l, y: v.y / l, z: v.z / l };
}

const HASH_PREC = 1e4;
function hashV(v: Vec3): string { return `${Math.round(v.x * HASH_PREC)},${Math.round(v.y * HASH_PREC)},${Math.round(v.z * HASH_PREC)}`; }
function edgeKey(a: string, b: string): string { return a < b ? `${a}|${b}` : `${b}|${a}`; }

interface BendInfo { angle: number; length: number; start: Vec3; end: Vec3 }

function analyzeSTL(triangles: Triangle[]): {
  dimensions: Vec3;
  volume: number;
  surfaceArea: number;
  bends: BendInfo[];
} {
  const mn: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  const mx: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
  let volume = 0, surfaceArea = 0;

  for (const t of triangles) {
    for (const v of [t.v0, t.v1, t.v2]) {
      mn.x = Math.min(mn.x, v.x); mn.y = Math.min(mn.y, v.y); mn.z = Math.min(mn.z, v.z);
      mx.x = Math.max(mx.x, v.x); mx.y = Math.max(mx.y, v.y); mx.z = Math.max(mx.z, v.z);
    }
    const { v0, v1, v2 } = t;
    volume += (v0.x * (v1.y * v2.z - v1.z * v2.y) + v0.y * (v1.z * v2.x - v1.x * v2.z) + v0.z * (v1.x * v2.y - v1.y * v2.x)) / 6.0;
    surfaceArea += v3len(v3cross(v3sub(v1, v0), v3sub(v2, v0))) * 0.5;
  }

  // Edge adjacency for bend detection
  const edgeMap = new Map<string, number[]>();
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i];
    const vs = [t.v0, t.v1, t.v2];
    const hs = vs.map(hashV);
    for (let j = 0; j < 3; j++) {
      const k = edgeKey(hs[j], hs[(j + 1) % 3]);
      const arr = edgeMap.get(k);
      if (arr) arr.push(i); else edgeMap.set(k, [i]);
    }
  }

  const bends: BendInfo[] = [];
  const maxDim = Math.max(mx.x - mn.x, mx.y - mn.y, mx.z - mn.z);

  for (const [key, tris] of edgeMap) {
    if (tris.length !== 2) continue;
    const t0 = triangles[tris[0]], t1 = triangles[tris[1]];
    const n0 = v3normalize(v3cross(v3sub(t0.v1, t0.v0), v3sub(t0.v2, t0.v0)));
    const n1 = v3normalize(v3cross(v3sub(t1.v1, t1.v0), v3sub(t1.v2, t1.v0)));
    const dot = v3dot(n0, n1);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;

    if (angle >= 15 && angle <= 160) {
      const [h1, h2] = key.split("|");
      const [x1, y1, z1] = h1.split(",").map(Number);
      const [x2, y2, z2] = h2.split(",").map(Number);
      const start: Vec3 = { x: x1 / HASH_PREC, y: y1 / HASH_PREC, z: z1 / HASH_PREC };
      const end: Vec3 = { x: x2 / HASH_PREC, y: y2 / HASH_PREC, z: z2 / HASH_PREC };
      const len = v3len(v3sub(end, start));
      if (len > maxDim * 0.05) {
        bends.push({ angle, length: len, start, end });
      }
    }
  }

  return {
    dimensions: { x: mx.x - mn.x, y: mx.y - mn.y, z: mx.z - mn.z },
    volume: Math.abs(volume),
    surfaceArea,
    bends,
  };
}

/**
 * Call the unfold service for STEP files. Returns either the parsed body
 * or an error object with a diagnostic string so the caller can surface it
 * to the frontend instead of silently pretending no flat pattern exists.
 */
async function callFreeCADService(
  fileUrl: string,
  fileName: string,
): Promise<Record<string, unknown> | { error: string; detail?: string }> {
  const serviceUrl = Deno.env.get("UNFOLD_SERVICE_URL");
  if (!serviceUrl) {
    return {
      error: "UNFOLD_SERVICE_URL is not configured in Supabase secrets",
    };
  }

  try {
    const resp = await fetch(`${serviceUrl}/flat-pattern`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_url: fileUrl, file_name: fileName }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => "");
      console.error(
        `Unfold service ${resp.status} for ${fileName}: ${bodyText.slice(0, 500)}`,
      );
      return {
        error: `Unfold service returned HTTP ${resp.status}`,
        detail: bodyText.slice(0, 500),
      };
    }
    return await resp.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Unfold service call threw for ${fileName}: ${msg}`);
    return { error: "Unfold service unreachable", detail: msg };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { file_url, file_name, order_id, rfq_id } = await req.json();

    if (!file_url || !file_name) {
      return new Response(
        JSON.stringify({ error: "file_url and file_name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("Flat pattern extraction:", { file_name, order_id, rfq_id });

    // ── STEP files: delegate to the unfold service ──────
    if (isSTEP(file_name)) {
      const result = await callFreeCADService(file_url, file_name);
      const hasError = result && typeof result === "object" && "error" in result;
      if (result && !hasError) {
        return new Response(JSON.stringify({
          status: "completed",
          source: "sheet-metal-service",
          file_name,
          order_id,
          rfq_id,
          ...result,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const errObj = (result as { error?: string; detail?: string }) || {};
      return new Response(JSON.stringify({
        status: "unavailable",
        error: errObj.error ||
          "STEP unfold service unavailable. Set UNFOLD_SERVICE_URL in Supabase secrets and deploy sheet-metal-service/.",
        detail: errObj.detail,
        file_name,
        order_id,
        rfq_id,
      }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── STL files: native analysis ──────────────────────
    if (!isSTL(file_name)) {
      return new Response(JSON.stringify({
        error: `Unsupported file type. Supported: STL, STEP/STP`,
        file_name,
      }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Download file
    const fileResp = await fetch(file_url);
    if (!fileResp.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch file: ${fileResp.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const buffer = await fileResp.arrayBuffer();
    if (buffer.byteLength > MAX_FILE_SIZE) {
      return new Response(
        JSON.stringify({ error: "File too large" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Parse and analyze
    const triangles = parseSTLBinary(buffer);
    const analysis = analyzeSTL(triangles);

    return new Response(JSON.stringify({
      status: "completed",
      source: "mesh_analysis",
      file_name,
      order_id,
      rfq_id,
      flat_pattern: {
        dimensions: {
          width: analysis.dimensions.x,
          height: analysis.dimensions.z,
          thickness: analysis.dimensions.y,
        },
        bends: analysis.bends.map((b, i) => ({
          id: `B${i + 1}`,
          angle: parseFloat(b.angle.toFixed(1)),
          length: parseFloat(b.length.toFixed(2)),
        })),
        bend_count: analysis.bends.length,
      },
      analysis: {
        dimensions: analysis.dimensions,
        volume_mm3: analysis.volume,
        surface_area_mm2: analysis.surfaceArea,
        triangle_count: triangles.length,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in extract-flat-pattern:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
