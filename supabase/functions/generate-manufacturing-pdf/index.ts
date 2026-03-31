/**
 * Supabase Edge Function: generate-manufacturing-pdf
 *
 * Server-side manufacturing PDF generation from STL files.
 * Parses mesh geometry, detects feature edges + bend lines,
 * and produces a professional A4 vector wireframe bending shop drawing.
 *
 * For STEP files: optionally delegates to a FreeCAD Docker service
 * (set UNFOLD_SERVICE_URL env var) for true B-Rep unfolding.
 *
 * POST body:
 *   { file_url, file_name, part_info: PartInfo }
 *
 * Returns:
 *   { pdf_base64, analysis: { dimensions, volume, surfaceArea, bendCount, triangleCount } }
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { parseSTL } from "./stl-parser.ts";
import { analyzeMesh } from "./mesh-analyzer.ts";
import { buildManufacturingPDF, type PartInfo } from "./pdf-builder.ts";
import { encode as base64Encode } from "https://deno.land/std@0.190.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

function isSTL(name: string): boolean {
  return /\.stl$/i.test(name);
}

function isSTEP(name: string): boolean {
  return /\.(step|stp)$/i.test(name);
}

function isOBJ(name: string): boolean {
  return /\.obj$/i.test(name);
}

/**
 * Try to delegate STEP file unfolding to the FreeCAD Docker service.
 * Returns flat pattern data if available, null otherwise.
 */
async function tryFreeCADUnfold(
  fileUrl: string,
  fileName: string,
  partInfo: PartInfo,
): Promise<{ pdf_base64: string; analysis: Record<string, unknown> } | null> {
  const serviceUrl = Deno.env.get("UNFOLD_SERVICE_URL");
  if (!serviceUrl) return null;

  try {
    console.log(`Delegating STEP unfolding to FreeCAD service: ${serviceUrl}`);
    const response = await fetch(`${serviceUrl}/unfold`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_url: fileUrl, file_name: fileName, part_info: partInfo }),
      signal: AbortSignal.timeout(120_000), // 2 min timeout for CAD processing
    });

    if (!response.ok) {
      console.warn(`FreeCAD service returned ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (err) {
    console.warn("FreeCAD service unavailable:", err);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { file_url, file_name, part_info } = body as {
      file_url: string;
      file_name: string;
      part_info?: PartInfo;
    };

    if (!file_url || !file_name) {
      return new Response(
        JSON.stringify({ error: "file_url and file_name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const info: PartInfo = part_info || { name: file_name.replace(/\.[^.]+$/, "") };

    // ── STEP files: try FreeCAD service first ───────────
    if (isSTEP(file_name)) {
      const result = await tryFreeCADUnfold(file_url, file_name, info);
      if (result) {
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // No FreeCAD service available
      return new Response(
        JSON.stringify({
          error: "STEP file processing requires the FreeCAD unfolding service. Set UNFOLD_SERVICE_URL environment variable.",
          hint: "Deploy the FreeCAD Docker service from scripts/freecad-unfold/ and set UNFOLD_SERVICE_URL.",
          supported_formats: ["STL", "OBJ (with limitations)"],
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── OBJ files: not yet supported server-side ────────
    if (isOBJ(file_name)) {
      return new Response(
        JSON.stringify({
          error: "OBJ files are not yet supported for server-side PDF generation. Use STL format for best results.",
          supported_formats: ["STL"],
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── STL files: native processing ────────────────────
    if (!isSTL(file_name)) {
      return new Response(
        JSON.stringify({
          error: `Unsupported file type: ${file_name}. Supported: STL`,
          supported_formats: ["STL"],
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`Processing STL file: ${file_name}`);

    // 1. Download the file
    const fileResponse = await fetch(file_url);
    if (!fileResponse.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to download file: HTTP ${fileResponse.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const buffer = await fileResponse.arrayBuffer();
    if (buffer.byteLength > MAX_FILE_SIZE) {
      return new Response(
        JSON.stringify({ error: `File too large (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB). Maximum: ${MAX_FILE_SIZE / 1024 / 1024} MB.` }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`File downloaded: ${(buffer.byteLength / 1024).toFixed(0)} KB`);

    // 2. Parse STL
    const stlData = parseSTL(buffer);
    console.log(`Parsed ${stlData.triangles.length} triangles`);

    // 3. Analyze mesh
    const analysis = analyzeMesh(stlData.triangles);
    console.log(
      `Analysis complete: ${analysis.featureEdges.length} feature edges, ${analysis.bendLines.length} bend lines`,
    );

    // 4. Generate PDF
    const pdfBytes = await buildManufacturingPDF(analysis, info, file_name);
    console.log(`PDF generated: ${(pdfBytes.length / 1024).toFixed(0)} KB`);

    // 5. Return as base64
    const pdfBase64 = base64Encode(pdfBytes);

    return new Response(
      JSON.stringify({
        pdf_base64: pdfBase64,
        content_type: "application/pdf",
        file_name: `${(info.name || file_name).replace(/[^a-zA-Z0-9_-]/g, "_")}_Bending_Drawing.pdf`,
        analysis: {
          dimensions: {
            x: analysis.dimensions.x,
            y: analysis.dimensions.y,
            z: analysis.dimensions.z,
          },
          volume_mm3: analysis.volume,
          surface_area_mm2: analysis.surfaceArea,
          triangle_count: analysis.triangleCount,
          feature_edge_count: analysis.featureEdges.length,
          bend_count: analysis.bendLines.length,
          bends: analysis.bendLines.map((bl, i) => ({
            id: `B${i + 1}`,
            angle: bl.angle,
          })),
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error in generate-manufacturing-pdf:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
        type: error instanceof Error ? error.constructor.name : "Unknown",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
