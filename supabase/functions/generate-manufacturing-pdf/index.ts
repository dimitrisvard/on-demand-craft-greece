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
import { analyzeMesh, type UnfoldData } from "./mesh-analyzer.ts";
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

/**
 * Call the FreeCAD unfold service for STEP files.
 * Returns unfold data with real bend positions or null if unavailable.
 */
async function callUnfoldService(
  fileUrl: string,
  fileName: string,
  partInfo: PartInfo,
): Promise<UnfoldData | null> {
  const serviceUrl = Deno.env.get("UNFOLD_SERVICE_URL");
  if (!serviceUrl) {
    console.log("UNFOLD_SERVICE_URL not configured — skipping FreeCAD unfold");
    return null;
  }

  try {
    console.log(`Calling FreeCAD service at ${serviceUrl}/flat-pattern for ${fileName}`);
    // Try the new FastAPI /unfold endpoint first (returns JSON metadata)
    // We call /flat-pattern for backward compat with the Flask service
    const resp = await fetch(`${serviceUrl}/flat-pattern`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_url: fileUrl,
        file_name: fileName,
        part_info: {
          material: partInfo.material || "Steel",
          thickness: partInfo.thickness ? parseFloat(partInfo.thickness) : 0,
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const errorBody = await resp.text().catch(() => "");
      console.log(`FreeCAD service returned ${resp.status}: ${errorBody.slice(0, 200)}`);
      return null;
    }

    const data = await resp.json();

    // Normalize response to UnfoldData format
    if (data.flat_pattern) {
      return {
        success: true,
        part_name: data.part_name || fileName.replace(/\.[^.]+$/, ""),
        thickness_mm: data.flat_pattern?.dimensions?.thickness || data.thickness_mm || 0,
        flat_pattern: {
          width_mm: data.flat_pattern?.dimensions?.width || data.flat_pattern?.width_mm || 0,
          height_mm: data.flat_pattern?.dimensions?.height || data.flat_pattern?.height_mm || 0,
          outline_edges: data.flat_pattern?.outline_edges || [],
        },
        bends: (data.flat_pattern?.bends || data.bends || []).map(
          (b: Record<string, unknown>, i: number) => ({
            index: (b.index as number) || i + 1,
            angle_deg: (b.angle_deg as number) || (b.angle as number) || 90,
            inner_radius_mm: (b.inner_radius_mm as number) || (b.radius as number) || 0,
            direction: (b.direction as string) || "UP",
            length_mm: (b.length_mm as number) || (b.length as number) || 0,
            k_factor: (b.k_factor as number) || 0.44,
            bend_allowance_mm: (b.bend_allowance_mm as number) || 0,
            bend_deduction_mm: (b.bend_deduction_mm as number) || 0,
            bend_line_on_flat: b.bend_line_on_flat || undefined,
            distance_from_left_edge_mm: (b.distance_from_left_edge_mm as number) || 0,
          }),
        ),
        linear_dimensions: data.linear_dimensions || [],
        unfold_method: data.unfold_method || data.flat_pattern?.source || "unknown",
      };
    }

    return null;
  } catch (err) {
    console.log(`FreeCAD service call failed: ${err}. Service URL: ${serviceUrl}`);
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
    let unfoldData: UnfoldData | null = null;

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
        `STEP analysis complete: ${analysis.featureEdges.length} edges, ${analysis.bendLines.length} bend lines`,
      );

      // Try calling FreeCAD unfold service for enhanced bend data
      unfoldData = await callUnfoldService(file_url, file_name, info);
      if (unfoldData?.success) {
        console.log(`FreeCAD unfold succeeded: ${unfoldData.bends?.length || 0} bends, method: ${unfoldData.unfold_method}`);

        // Use FreeCAD bend lines if available (more accurate than STEP text parsing)
        if (unfoldData.bends && unfoldData.bends.length > 0) {
          // Override parsed bend lines with FreeCAD data
          analysis.bendLines = unfoldData.bends.map((b) => ({
            start: { x: b.bend_line_on_flat?.start?.[0] ?? 0, y: 0, z: b.bend_line_on_flat?.start?.[1] ?? 0 },
            end: { x: b.bend_line_on_flat?.end?.[0] ?? 0, y: 0, z: b.bend_line_on_flat?.end?.[1] ?? 0 },
            angle: b.angle_deg,
          }));
        }

        // Use flat pattern dimensions from unfold if available
        if (unfoldData.flat_pattern && unfoldData.flat_pattern.width_mm > 0) {
          analysis.dimensions = {
            ...analysis.dimensions,
            x: unfoldData.flat_pattern.width_mm,
            z: unfoldData.flat_pattern.height_mm,
          };
        }

        // Use thickness from unfold if available
        if (unfoldData.thickness_mm && unfoldData.thickness_mm > 0) {
          analysis.dimensions.y = unfoldData.thickness_mm;
        }
      } else {
        console.log("FreeCAD unfold not available or failed, using STEP text parsing only");
        // Surface unfold status in the response for debugging
        unfoldData = {
          success: false,
          part_name: file_name,
          thickness_mm: 0,
          flat_pattern: { width_mm: 0, height_mm: 0, outline_edges: [] },
          bends: [],
          linear_dimensions: [],
          unfold_method: "unavailable",
          _debug_reason: Deno.env.get("UNFOLD_SERVICE_URL")
            ? "FreeCAD service returned error or timed out"
            : "UNFOLD_SERVICE_URL not configured in edge function secrets",
        } as UnfoldData & { _debug_reason: string };
      }
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
    const pdfBytes = await buildManufacturingPDF(analysis, info, file_name, unfoldData);
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
          unfold_status: unfoldData?.success ? "enhanced" : "basic",
          unfold_method: unfoldData?.unfold_method || "none",
          unfold_debug: (unfoldData as Record<string, unknown>)?._debug_reason || undefined,
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
