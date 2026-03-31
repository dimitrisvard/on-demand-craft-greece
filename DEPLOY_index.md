# index.ts — Copy everything below this line into Supabase Dashboard

```ts
/**
 * Supabase Edge Function: generate-manufacturing-pdf
 *
 * Server-side manufacturing PDF generation from STL, STEP, and DXF files.
 * Parses geometry, detects feature edges + bend lines,
 * and produces a professional A4 vector wireframe bending shop drawing.
 *
 * Supported formats:
 *   - STL: Native binary/ASCII mesh parsing
 *   - STEP/STP: Pure-text geometry extraction from ISO 10303-21 format
 *   - DXF: 2D entity extraction (LINE, ARC, CIRCLE, LWPOLYLINE)
 *
 * POST body:
 *   { file_url, file_name, part_info: PartInfo }
 *
 * Returns:
 *   { pdf_base64, analysis: { dimensions, volume, surfaceArea, bendCount, triangleCount } }
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { parseSTL } from "./stl-parser.ts";
import { parseSTEP } from "./step-parser.ts";
import { parseDXF, dxfToMeshAnalysis } from "./dxf-parser.ts";
import { analyzeMesh } from "./mesh-analyzer.ts";
import { buildManufacturingPDF, type PartInfo } from "./pdf-builder.ts";
import { encode as base64Encode } from "https://deno.land/std@0.190.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

function getFileType(name: string): "stl" | "step" | "dxf" | "obj" | null {
  if (/\.stl$/i.test(name)) return "stl";
  if (/\.(step|stp)$/i.test(name)) return "step";
  if (/\.dxf$/i.test(name)) return "dxf";
  if (/\.obj$/i.test(name)) return "obj";
  return null;
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
    const fileType = getFileType(file_name);

    if (!fileType || fileType === "obj") {
      return new Response(
        JSON.stringify({
          error: `Unsupported file type: ${file_name}. Supported formats: STL, STEP/STP, DXF`,
          supported_formats: ["STL", "STEP", "STP", "DXF"],
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`Processing ${fileType.toUpperCase()} file: ${file_name}`);

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

    // 2. Parse file and analyze geometry based on type
    let analysis;

    if (fileType === "dxf") {
      // DXF: parse 2D entities directly → MeshAnalysis
      const dxfData = parseDXF(buffer);
      analysis = dxfToMeshAnalysis(dxfData);
      console.log(`DXF analysis complete: ${dxfData.entityCount} entities, ${dxfData.bendLines.length} bends`);
    } else if (fileType === "step") {
      // STEP: pure-text geometry extraction → MeshAnalysis
      console.log("Parsing STEP file geometry...");
      analysis = await parseSTEP(buffer);
      console.log(
        `STEP analysis complete: ${analysis.featureEdges.length} edges`,
      );
    } else {
      // STL: parse triangles → mesh analysis
      const stlData = parseSTL(buffer);
      console.log(`Parsed ${stlData.triangles.length} triangles`);

      analysis = analyzeMesh(stlData.triangles);
      console.log(
        `Analysis complete: ${analysis.featureEdges.length} feature edges, ${analysis.bendLines.length} bend lines`,
      );
    }

    // 3. Generate PDF
    const pdfBytes = await buildManufacturingPDF(analysis, info, file_name);
    console.log(`PDF generated: ${(pdfBytes.length / 1024).toFixed(0)} KB`);

    // 4. Return as base64
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
```
