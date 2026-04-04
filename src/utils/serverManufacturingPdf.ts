/**
 * Server-Side Manufacturing PDF Service
 *
 * Calls the generate-manufacturing-pdf Supabase Edge Function for
 * server-side PDF generation with vector wireframe projections.
 *
 * Falls back to client-side Three.js rendering if the server is unavailable.
 */

import { supabase } from '@/integrations/supabase/client';
import { type PartInfo } from './technicalDrawingPdf';

interface ServerPdfResponse {
  pdf_base64: string;
  content_type: string;
  file_name: string;
  analysis: {
    dimensions: { x: number; y: number; z: number };
    volume_mm3: number;
    surface_area_mm2: number;
    triangle_count: number;
    feature_edge_count: number;
    bend_count: number;
    bends: Array<{ id: string; angle: number }>;
  };
}

interface FlatPatternResponse {
  status: string;
  source: string;
  flat_pattern?: {
    dimensions: { width: number; height: number; thickness: number };
    bends: Array<{ id: string; angle: number; length: number }>;
    bend_count: number;
  };
  analysis?: {
    dimensions: { x: number; y: number; z: number };
    volume_mm3: number;
    surface_area_mm2: number;
    triangle_count: number;
  };
  dxf_base64?: string;
  error?: string;
}

/**
 * Download base64 PDF as a file
 */
function downloadBase64Pdf(base64: string, fileName: string): void {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Check if the file type is supported by the server-side edge function.
 * Supports STL, STEP/STP, and DXF files.
 */
function isServerSupported(fileName: string): boolean {
  return /\.(stl|step|stp|dxf)$/i.test(fileName);
}

/**
 * Generate manufacturing PDF via server-side edge function.
 * Returns true if successful, false if the caller should fall back to client-side.
 */
export async function generateServerManufacturingPdf(
  fileUrl: string,
  fileName: string,
  partInfo: PartInfo,
): Promise<boolean> {
  // Skip server call for file types not supported server-side
  if (!isServerSupported(fileName)) {
    console.log(`File type not supported server-side (${fileName}), using client-side generation`);
    return false;
  }
  try {
    const { data, error } = await supabase.functions.invoke(
      'generate-manufacturing-pdf',
      {
        body: {
          file_url: fileUrl,
          file_name: fileName,
          part_info: partInfo,
        },
      },
    );

    if (error) {
      console.warn('Server PDF generation failed:', error);
      return false;
    }

    const response = data as ServerPdfResponse;
    if (!response?.pdf_base64) {
      console.warn('Server returned no PDF data');
      return false;
    }

    // Download the PDF
    downloadBase64Pdf(response.pdf_base64, response.file_name);

    console.log('Server-side PDF generated:', {
      dimensions: response.analysis.dimensions,
      bends: response.analysis.bend_count,
      edges: response.analysis.feature_edge_count,
    });

    return true;
  } catch (err) {
    console.warn('Server PDF generation error:', err);
    return false;
  }
}

/**
 * Generate manufacturing PDF with server-side fallback to client-side.
 *
 * 1. Tries server-side edge function first (vector wireframe PDF)
 * 2. Falls back to client-side Three.js rendering if server unavailable
 *    (only for STL/OBJ — DXF and STEP require server-side processing)
 */
export async function generateManufacturingPdfWithFallback(
  fileUrl: string,
  fileName: string,
  partInfo: PartInfo,
): Promise<void> {
  // Try server-side first
  const serverSuccess = await generateServerManufacturingPdf(fileUrl, fileName, partInfo);
  if (serverSuccess) return;

  // DXF files cannot be rendered client-side — provide clear error
  if (/\.dxf$/i.test(fileName)) {
    throw new Error(
      'DXF manufacturing drawing requires the server-side service. ' +
      'The server may be temporarily unavailable. Please try again or check the edge function logs.'
    );
  }

  // STEP files: client-side fallback is fragile, warn clearly on failure
  if (/\.(step|stp)$/i.test(fileName)) {
    console.warn('Server-side STEP processing failed. Attempting client-side fallback (may be limited).');
  }

  // Fall back to client-side for STL/OBJ
  console.log('Falling back to client-side PDF generation');
  try {
    const { generateManufacturingDrawingPdf } = await import('./technicalDrawingPdf');
    await generateManufacturingDrawingPdf(fileUrl, fileName, partInfo);
  } catch (err: any) {
    const isStep = /\.(step|stp)$/i.test(fileName);
    throw new Error(
      isStep
        ? `STEP file processing failed on both server and client. Server-side FreeCAD service may need attention. Error: ${err.message}`
        : `Client-side PDF generation failed: ${err.message}`
    );
  }
}

/**
 * Extract flat pattern data from a 3D file via the edge function.
 */
export async function extractFlatPattern(
  fileUrl: string,
  fileName: string,
  orderId?: string,
  rfqId?: string,
): Promise<FlatPatternResponse | null> {
  try {
    const { data, error } = await supabase.functions.invoke(
      'extract-flat-pattern',
      {
        body: {
          file_url: fileUrl,
          file_name: fileName,
          order_id: orderId,
          rfq_id: rfqId,
        },
      },
    );

    if (error) {
      console.warn('Flat pattern extraction failed:', error);
      return null;
    }

    return data as FlatPatternResponse;
  } catch (err) {
    console.warn('Flat pattern extraction error:', err);
    return null;
  }
}

/**
 * Download a DXF flat pattern file (if available from the FreeCAD service).
 */
export function downloadDxfFlatPattern(
  dxfBase64: string,
  fileName: string,
): void {
  const binaryStr = atob(dxfBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  const dxfFileName = fileName.replace(/\.[^.]+$/, '_flat_pattern.dxf');
  const blob = new Blob([bytes], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = dxfFileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
