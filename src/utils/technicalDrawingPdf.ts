/**
 * Technical Drawing PDF Generator
 *
 * Generates a professional mechanical drawing PDF from a 3D model file.
 * Creates multi-view orthographic projections (front, top, right, isometric)
 * with dimensions, title block, and part specifications.
 *
 * Works entirely client-side using Three.js for rendering and jsPDF for PDF output.
 */

import * as THREE from 'three';
// @ts-expect-error: no types for STLLoader
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
// @ts-expect-error: no types for OBJLoader
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';
// @ts-expect-error: no types for BufferGeometryUtils
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils';
import jsPDF from 'jspdf';
import type { FlatPatternResponse } from './serverManufacturingPdf';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PartInfo {
  name: string;
  material?: string;
  process?: string;
  thickness?: string;
  tolerance?: string;
  surfaceRoughness?: string;
  surfaceTreatment?: string;
  quantity?: number;
  needsBending?: boolean;
}

interface ViewCapture {
  label: string;
  imageData: string;
  cameraPosition: [number, number, number];
  cameraUp: [number, number, number];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const isSTL = (name: string) => /\.stl$/i.test(name);
const isOBJ = (name: string) => /\.obj$/i.test(name);
const isSTEP = (name: string) => /\.(step|stp)$/i.test(name);

function smoothGeometry(geom: THREE.BufferGeometry): THREE.BufferGeometry {
  try {
    const merged = mergeVertices(geom);
    merged.computeVertexNormals();
    return merged;
  } catch {
    geom.computeVertexNormals();
    return geom;
  }
}

// ── Load OCCT for STEP files ─────────────────────────────────────────────────

async function loadOcctModule(): Promise<any> {
  return new Promise((resolve, reject) => {
    if ((window as any).occtimportjs) {
      resolve((window as any).occtimportjs());
      return;
    }
    const check = setInterval(() => {
      if ((window as any).occtimportjs) {
        clearInterval(check);
        resolve((window as any).occtimportjs());
      }
    }, 100);
    setTimeout(() => { clearInterval(check); reject(new Error('OCCT not loaded')); }, 15000);
  });
}

// ── Load geometry from URL ───────────────────────────────────────────────────

async function loadGeometry(fileUrl: string, fileName: string): Promise<THREE.BufferGeometry[]> {
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error(`Failed to fetch file: ${response.status}`);

  if (isSTL(fileName)) {
    const buffer = await response.arrayBuffer();
    const loader = new STLLoader();
    const geom = loader.parse(buffer);
    return [smoothGeometry(geom)];
  }

  if (isOBJ(fileName)) {
    const text = await response.text();
    const loader = new OBJLoader();
    const group = loader.parse(text);
    const geometries: THREE.BufferGeometry[] = [];
    group.traverse((child: any) => {
      if (child.isMesh && child.geometry) {
        geometries.push(smoothGeometry(child.geometry));
      }
    });
    return geometries;
  }

  if (isSTEP(fileName)) {
    const occt = await loadOcctModule();
    const buffer = await response.arrayBuffer();
    const result = occt.ReadStepFile(new Uint8Array(buffer), {
      linearDeflection: 0.001,
      linearDeflectionType: 'bounding_box_ratio',
    });
    if (!result.success) throw new Error('Failed to parse STEP file');
    return (result.meshes || []).map((mesh: any) => {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(mesh.attributes.position.array, 3));
      if (mesh.index) {
        geom.setIndex(Array.from(mesh.index.array));
      }
      return smoothGeometry(geom);
    });
  }

  throw new Error(`Unsupported file type: ${fileName}`);
}

// ── Calculate geometry metrics ───────────────────────────────────────────────

function calculateMetrics(geometries: THREE.BufferGeometry[]) {
  const group = new THREE.Group();
  geometries.forEach(geom => {
    const mesh = new THREE.Mesh(geom);
    group.add(mesh);
  });

  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  let volume = 0;
  let surfaceArea = 0;

  geometries.forEach(geom => {
    const pos = geom.getAttribute('position');
    if (!pos) return;
    const idx = geom.getIndex();
    const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), cr = new THREE.Vector3();
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const a = idx ? idx.getX(i) : i;
      const b = idx ? idx.getX(i + 1) : i + 1;
      const c = idx ? idx.getX(i + 2) : i + 2;
      v0.fromBufferAttribute(pos, a);
      v1.fromBufferAttribute(pos, b);
      v2.fromBufferAttribute(pos, c);
      volume += (v0.x * (v1.y * v2.z - v1.z * v2.y) + v0.y * (v1.z * v2.x - v1.x * v2.z) + v0.z * (v1.x * v2.y - v1.y * v2.x)) / 6.0;
      e1.subVectors(v1, v0);
      e2.subVectors(v2, v0);
      cr.crossVectors(e1, e2);
      surfaceArea += cr.length() * 0.5;
    }
  });

  return { size, center, volume: Math.abs(volume), surfaceArea };
}

// ── Render a single view ─────────────────────────────────────────────────────

function renderView(
  geometries: THREE.BufferGeometry[],
  cameraPosition: [number, number, number],
  cameraUp: [number, number, number],
  center: THREE.Vector3,
  maxDim: number,
  width: number,
  height: number,
): string {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#ffffff');

  // Lights
  scene.add(new THREE.AmbientLight(0xe0e4e8, 0.6));
  const hemi = new THREE.HemisphereLight(0xffffff, 0x607080, 0.45);
  scene.add(hemi);
  const dir1 = new THREE.DirectionalLight(0xffffff, 0.9);
  dir1.position.set(10, 15, 8);
  scene.add(dir1);
  const dir2 = new THREE.DirectionalLight(0xe8f0ff, 0.4);
  dir2.position.set(-8, 5, -3);
  scene.add(dir2);

  // Material
  const material = new THREE.MeshPhongMaterial({
    color: new THREE.Color('#546e7a'),
    specular: new THREE.Color('#222222'),
    shininess: 50,
    side: THREE.DoubleSide,
  });

  // Add meshes
  const group = new THREE.Group();
  geometries.forEach(geom => {
    const mesh = new THREE.Mesh(geom, material);
    group.add(mesh);
    // Add edges for technical look
    const edges = new THREE.EdgesGeometry(geom, 30);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: '#1a237e', opacity: 0.3, transparent: true }));
    group.add(line);
  });
  group.position.set(-center.x, -center.y, -center.z);
  scene.add(group);

  // Camera
  const dist = maxDim * 2;
  const camera = new THREE.OrthographicCamera(
    -maxDim * 0.7, maxDim * 0.7,
    maxDim * 0.7 * (height / width), -maxDim * 0.7 * (height / width),
    0.01, maxDim * 10
  );
  camera.position.set(
    cameraPosition[0] * dist,
    cameraPosition[1] * dist,
    cameraPosition[2] * dist,
  );
  camera.up.set(cameraUp[0], cameraUp[1], cameraUp[2]);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(2);
  renderer.render(scene, camera);

  const dataUrl = renderer.domElement.toDataURL('image/png');

  // Cleanup
  renderer.dispose();
  material.dispose();
  geometries.forEach(g => g.dispose());

  return dataUrl;
}

// ── Render a single view (clone geometries to avoid disposal issues) ────────

function renderViewSafe(
  geometries: THREE.BufferGeometry[],
  cameraPosition: [number, number, number],
  cameraUp: [number, number, number],
  center: THREE.Vector3,
  maxDim: number,
  width: number,
  height: number,
): string {
  // Clone geometries so original are not disposed
  const clones = geometries.map(g => g.clone());
  return renderView(clones, cameraPosition, cameraUp, center, maxDim, width, height);
}

// ── Main export: generate bending shop drawing PDF ──────────────────────────
//
// Layout (A4 Landscape):
//   ┌──────────────────────────────────────────────────┐
//   │  HEADER: MICRONS HUB  ·  BENDING SHOP DRAWING   │
//   ├────────────┬─────────────────────────────────────┤
//   │ ISOMETRIC  │  PART INFORMATION                   │
//   │   VIEW     │  Material / Thickness / Bends       │
//   │  (3D img)  │  Overall flat dimensions            │
//   ├────────────┴─────────────────────────────────────┤
//   │                                                  │
//   │          FLAT PATTERN with:                      │
//   │          • Linear dimensions (mm)                │
//   │          • Bend lines (red dashed)               │
//   │          • Front view reference (right)          │
//   │                                                  │
//   ├──────────────────────────────────────────────────┤
//   │  TITLE BLOCK: Part | Dims & Metrics | Company    │
//   └──────────────────────────────────────────────────┘
//

export async function generateManufacturingDrawingPdf(
  fileUrl: string,
  fileName: string,
  partInfo: PartInfo,
): Promise<void> {
  // 1. Load geometry
  const geometries = await loadGeometry(fileUrl, fileName);
  if (!geometries.length) throw new Error('No geometry found in file');

  // 2. Calculate metrics
  const metrics = calculateMetrics(geometries);
  const dims = metrics.size;
  const maxDim = Math.max(dims.x, dims.y, dims.z);

  // 3. Calculate weight
  let weight: string | null = null;
  if (partInfo.material) {
    const { calculateWeight: calcW, formatWeight: fmtW } = await import('./materialDensity');
    const w = calcW(metrics.volume, partInfo.material);
    if (w != null) weight = fmtW(w);
  }

  // 3b. Extract flat pattern data (real outline + bend geometry) from the
  // server-side analysis. Keep the full payload so the drawing can use the
  // actual blank outline and true bend-line positions, not approximations.
  let flatPatternData: NonNullable<FlatPatternResponse['flat_pattern']> | null = null;
  try {
    const { extractFlatPattern } = await import('./serverManufacturingPdf');
    const fpResult = await extractFlatPattern(fileUrl, fileName);
    if (fpResult?.status === 'completed' && fpResult.flat_pattern) {
      flatPatternData = fpResult.flat_pattern;
    }
  } catch {
    // Flat pattern extraction failed, continue with fallback
  }

  // Use flat pattern dimensions if available, otherwise use 3D bounding box
  const flatW = flatPatternData?.dimensions?.width ?? dims.x;
  const flatH = flatPatternData?.dimensions?.height ?? dims.z;
  const flatThickness = flatPatternData?.dimensions?.thickness ?? dims.y;
  const realBendCount = flatPatternData?.bend_count ?? 0;
  const hasBends = partInfo.needsBending || realBendCount > 0;

  // 4. Render views
  const isoView = renderViewSafe(geometries, [0.65, 0.5, 0.65], [0, 1, 0], metrics.center, maxDim, 600, 600);
  const topView = renderViewSafe(geometries, [0, 1, 0], [0, 0, -1], metrics.center, maxDim, 1200, 900);
  const frontView = renderViewSafe(geometries, [0, 0, 1], [0, 1, 0], metrics.center, maxDim, 500, 400);

  // 5. Build PDF (A4 Landscape)
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const m = 8; // margin

  // ── Colors ──────────────────────────────────────────
  const DARK_BLUE: [number, number, number] = [27, 42, 74];
  const ACCENT_BLUE: [number, number, number] = [46, 110, 166];
  const RED: [number, number, number] = [192, 57, 43];
  const WHITE: [number, number, number] = [255, 255, 255];
  const LIGHT_GRAY: [number, number, number] = [240, 242, 245];

  const contentW = pageW - 2 * m;
  let y = m;

  // ── HEADER BAR ────────────────────────────────────
  const headerH = 12;
  pdf.setFillColor(...DARK_BLUE);
  pdf.rect(m, y, contentW, headerH, 'F');
  pdf.setTextColor(...WHITE);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text('MICRONS HUB', m + 5, y + 8);
  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'normal');
  pdf.text('micronshub.eu', m + 5, y + 11);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text('BENDING SHOP DRAWING', pageW - m - 5, y + 8, { align: 'right' });
  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Part: ${partInfo.name || fileName.replace(/\.[^.]+$/, '')}`, pageW - m - 5, y + 11, { align: 'right' });
  y += headerH + 2;

  // ── TOP ROW: Isometric View + Part Info ────────────
  const topRowH = 48;
  const isoBoxW = 56;
  const infoBoxW = contentW - isoBoxW - 3;

  // Isometric view box
  pdf.setDrawColor(200);
  pdf.setLineWidth(0.3);
  pdf.setFillColor(...LIGHT_GRAY);
  pdf.rect(m, y, isoBoxW, topRowH, 'FD');
  pdf.addImage(isoView, 'PNG', m + 2, y + 2, isoBoxW - 4, topRowH - 10);
  pdf.setFontSize(6);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...ACCENT_BLUE);
  pdf.text('ISOMETRIC VIEW', m + isoBoxW / 2, y + topRowH - 3, { align: 'center' });

  // Part info box
  const infoX = m + isoBoxW + 3;
  pdf.setFillColor(255, 255, 255);
  pdf.setDrawColor(200);
  pdf.rect(infoX, y, infoBoxW, topRowH, 'FD');

  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...ACCENT_BLUE);
  pdf.text('PART INFORMATION', infoX + 4, y + 6);

  // Info fields in 2 columns
  pdf.setFontSize(7);
  const infoFields: [string, string][] = [
    ['Part Name:', partInfo.name || 'Untitled'],
    ['Material:', partInfo.material || '—'],
    ['Thickness:', partInfo.thickness ? `${partInfo.thickness} mm` : '—'],
    ['Process:', partInfo.process || '—'],
    ['Bending:', hasBends ? `REQUIRED (${realBendCount || '?'} bends)` : 'No'],
    ['Quantity:', partInfo.quantity ? String(partInfo.quantity) : '—'],
    ['Flat Size:', `${flatW.toFixed(1)} × ${flatH.toFixed(1)} mm`],
    ['Bounding Box:', `${dims.x.toFixed(1)} × ${dims.y.toFixed(1)} × ${dims.z.toFixed(1)} mm`],
  ];
  let infoY = y + 11;
  const colMid = infoX + infoBoxW / 2;
  infoFields.forEach(([label, value], i) => {
    const cx = i % 2 === 0 ? infoX + 4 : colMid + 2;
    const cy = infoY + Math.floor(i / 2) * 5.5;
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(100);
    pdf.text(label, cx, cy);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(30);
    pdf.text(value, cx + 24, cy);
  });

  // Weight + surface treatment on last row
  infoY = infoY + Math.ceil(infoFields.length / 2) * 5.5;
  if (weight) {
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(100);
    pdf.text('Est. Weight:', infoX + 4, infoY);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(30);
    pdf.text(weight, infoX + 28, infoY);
  }
  if (partInfo.surfaceTreatment && partInfo.surfaceTreatment !== 'none') {
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(100);
    pdf.text('Finish:', colMid + 2, infoY);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(30);
    pdf.text(partInfo.surfaceTreatment, colMid + 18, infoY);
  }

  // Bending badge
  if (hasBends) {
    pdf.setFillColor(255, 140, 0);
    pdf.roundedRect(pageW - m - 38, y + 2, 35, 7, 1.5, 1.5, 'F');
    pdf.setFontSize(6);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...WHITE);
    pdf.text('BENDING REQUIRED', pageW - m - 36, y + 7);
  }

  y += topRowH + 2;

  // ── FLAT PATTERN VIEW ─────────────────────────────
  const titleBlockH = 16;
  const flatSectionH = pageH - y - m - titleBlockH - 2;

  pdf.setDrawColor(200);
  pdf.setFillColor(255, 255, 255);
  pdf.rect(m, y, contentW, flatSectionH, 'FD');

  // Section label
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...ACCENT_BLUE);
  pdf.text('FLAT PATTERN', m + 4, y + 6);
  pdf.setFontSize(6);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(140);
  pdf.text(flatPatternData ? 'Bend lines from analysis — dimensions in mm' : 'Bend lines shown as red dashed lines — dimensions in mm', m + 35, y + 6);

  // Main flat pattern (left ~72%): draw the REAL vector blank outline
  // (incl. holes) when the analysis returned one — that is what CAD shows.
  // Only fall back to the rendered 3D top view when no outline exists.
  const flatImgW = contentW * 0.72;
  const flatImgH = flatSectionH - 18;
  const outlineEdges = flatPatternData?.outline_edges ?? [];
  const drewVector = outlineEdges.length > 0;
  // Vector-drawing frame state (used by dimensions below)
  let vox = 0, voy = 0, vDrawW = 0, vDrawH = 0, vW = 1, vH = 1;
  if (drewVector) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const e of outlineEdges) {
      minX = Math.min(minX, e.start[0], e.end[0]);
      minY = Math.min(minY, e.start[1], e.end[1]);
      maxX = Math.max(maxX, e.start[0], e.end[0]);
      maxY = Math.max(maxY, e.start[1], e.end[1]);
    }
    vW = maxX - minX || 1;
    vH = maxY - minY || 1;
    // Reserve margins for the dimension rows (bottom) and height dim (right)
    const areaX = m + 8, areaY = y + 12;
    const areaW = flatImgW - 34, areaH = flatImgH - 24;
    const vScale = Math.min(areaW / vW, areaH / vH);
    vDrawW = vW * vScale;
    vDrawH = vH * vScale;
    vox = areaX + (areaW - vDrawW) / 2;
    voy = areaY + (areaH - vDrawH) / 2;
    // Flat pattern is +Y-up; jsPDF is +Y-down → flip Y.
    const VX = (mx: number) => vox + (mx - minX) * vScale;
    const VY = (my: number) => voy + (maxY - my) * vScale;

    pdf.setDrawColor(26, 26, 46);
    pdf.setLineWidth(0.3);
    for (const e of outlineEdges) {
      pdf.line(VX(e.start[0]), VY(e.start[1]), VX(e.end[0]), VY(e.end[1]));
    }

    // Real bend lines — direction-coded like the analysis SVG (red = UP,
    // blue = DOWN). Lines outside the blank (bad service coords) are dropped.
    const guard = Math.max(vW, vH) * 0.05;
    const inFrame = (p: [number, number]) =>
      p[0] >= minX - guard && p[0] <= maxX + guard &&
      p[1] >= minY - guard && p[1] <= maxY + guard;
    (flatPatternData?.bends ?? []).forEach((b, i) => {
      const bl = b.bend_line_on_flat;
      if (!bl || !inFrame(bl.start) || !inFrame(bl.end)) return;
      const up = (b.direction || 'UP') === 'UP';
      if (up) pdf.setDrawColor(...RED); else pdf.setDrawColor(...ACCENT_BLUE);
      pdf.setLineWidth(0.4);
      pdf.setLineDashPattern([2, 1.2], 0);
      pdf.line(VX(bl.start[0]), VY(bl.start[1]), VX(bl.end[0]), VY(bl.end[1]));
      pdf.setLineDashPattern([], 0);
      const ang = b.angle_deg ?? b.angle ?? 90;
      pdf.setFontSize(6);
      pdf.setFont('helvetica', 'bold');
      if (up) pdf.setTextColor(...RED); else pdf.setTextColor(...ACCENT_BLUE);
      const lx = Math.min(VX(bl.start[0]), VX(bl.end[0]));
      const ly = Math.min(VY(bl.start[1]), VY(bl.end[1])) - 1.5;
      pdf.text(`B${b.index ?? i + 1} ${Math.round(ang)}° ${b.direction || ''}`.trim(), lx - 2, ly);
    });
  } else {
    pdf.addImage(topView, 'PNG', m + 4, y + 9, flatImgW - 8, flatImgH);
  }

  // Front view reference (right ~25%)
  const refX = m + flatImgW + 2;
  const refW = contentW - flatImgW - 4;
  const refH = flatImgH * 0.55;
  pdf.setDrawColor(220);
  pdf.setLineWidth(0.2);
  pdf.rect(refX, y + 9, refW, refH, 'D');
  pdf.addImage(frontView, 'PNG', refX + 2, y + 11, refW - 4, refH - 10);
  pdf.setFontSize(6);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...ACCENT_BLUE);
  pdf.text('FRONT VIEW', refX + refW / 2, y + 9 + refH - 3, { align: 'center' });

  // Specs summary below front view
  const specsY = y + 9 + refH + 4;
  pdf.setFontSize(6.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(60);
  const specLines = [
    partInfo.tolerance && `Tolerance: ${partInfo.tolerance}`,
    partInfo.surfaceRoughness && `Surface Ra: ${partInfo.surfaceRoughness}`,
    weight && `Weight: ${weight}`,
    `Volume: ${metrics.volume >= 1000 ? `${(metrics.volume / 1000).toFixed(2)} cm³` : `${metrics.volume.toFixed(1)} mm³`}`,
    `Surface Area: ${metrics.surfaceArea >= 100 ? `${(metrics.surfaceArea / 100).toFixed(2)} cm²` : `${metrics.surfaceArea.toFixed(1)} mm²`}`,
  ].filter(Boolean) as string[];
  specLines.forEach((line, i) => {
    pdf.text(line, refX + 3, specsY + i * 4.5);
  });

  // ── Dimension arrows on flat pattern ──────────────
  pdf.setDrawColor(...RED);
  pdf.setLineWidth(0.35);
  pdf.setTextColor(...RED);
  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'bold');

  if (drewVector) {
    // Dimensions aligned to the actual drawn outline (CAD-style)
    const wLabel = (flatPatternData?.dimensions?.width || vW).toFixed(1);
    const hLabel = (flatPatternData?.dimensions?.height || vH).toFixed(1);

    // Width below the part
    const dimY = voy + vDrawH + 5;
    pdf.line(vox, dimY, vox + vDrawW, dimY);
    pdf.line(vox, dimY, vox + 2.5, dimY - 1.2);
    pdf.line(vox, dimY, vox + 2.5, dimY + 1.2);
    pdf.line(vox + vDrawW, dimY, vox + vDrawW - 2.5, dimY - 1.2);
    pdf.line(vox + vDrawW, dimY, vox + vDrawW - 2.5, dimY + 1.2);
    pdf.text(wLabel, vox + vDrawW / 2 - pdf.getTextWidth(wLabel) / 2, dimY - 1.2);

    // Height to the right of the part
    const dimX = vox + vDrawW + 5;
    pdf.line(dimX, voy, dimX, voy + vDrawH);
    pdf.line(dimX, voy, dimX - 1.2, voy + 2.5);
    pdf.line(dimX, voy, dimX + 1.2, voy + 2.5);
    pdf.line(dimX, voy + vDrawH, dimX - 1.2, voy + vDrawH - 2.5);
    pdf.line(dimX, voy + vDrawH, dimX + 1.2, voy + vDrawH - 2.5);
    pdf.text(hLabel, dimX + 3, voy + vDrawH / 2, { angle: 90 });

    // Bend-position dimension chain: 0 → B1 → … → width
    const flatWmm = flatPatternData?.dimensions?.width || vW;
    const interior = (flatPatternData?.bends ?? [])
      .map((b) => b.distance_from_left_edge_mm ?? -1)
      .filter((d) => d > 0.5 && d < flatWmm - 0.5)
      .sort((a, b) => a - b);
    if (interior.length > 0) {
      const chain = [0, ...interior, flatWmm];
      const chainY = dimY + 5.5;
      pdf.setFontSize(6);
      pdf.setFont('helvetica', 'normal');
      for (let pi = 0; pi < chain.length - 1; pi++) {
        const seg = chain[pi + 1] - chain[pi];
        if (seg < 0.5) continue;
        const x1 = vox + (chain[pi] / flatWmm) * vDrawW;
        const x2 = vox + (chain[pi + 1] / flatWmm) * vDrawW;
        pdf.line(x1, chainY, x2, chainY);
        pdf.line(x1, chainY - 1, x1, chainY + 1);
        pdf.line(x2, chainY - 1, x2, chainY + 1);
        const segLabel = seg.toFixed(1);
        pdf.text(segLabel, (x1 + x2) / 2 - pdf.getTextWidth(segLabel) / 2, chainY - 1);
      }
    }
  } else {
    // Approximate dimensions over the rendered image (legacy behaviour)
    const dimLineY = y + flatSectionH - 7;
    const dimStartX = m + flatImgW * 0.12;
    const dimEndX = m + flatImgW * 0.88;
    pdf.line(dimStartX, dimLineY, dimEndX, dimLineY);
    pdf.line(dimStartX, dimLineY, dimStartX + 2.5, dimLineY - 1.2);
    pdf.line(dimStartX, dimLineY, dimStartX + 2.5, dimLineY + 1.2);
    pdf.line(dimEndX, dimLineY, dimEndX - 2.5, dimLineY - 1.2);
    pdf.line(dimEndX, dimLineY, dimEndX - 2.5, dimLineY + 1.2);
    const xDimText = `${flatW.toFixed(1)}`;
    pdf.text(xDimText, (dimStartX + dimEndX) / 2 - pdf.getTextWidth(xDimText) / 2, dimLineY - 1.5);

    const vDimX = m + flatImgW - 6;
    const vDimStartY = y + 14;
    const vDimEndY = y + flatSectionH - 14;
    pdf.line(vDimX, vDimStartY, vDimX, vDimEndY);
    pdf.line(vDimX, vDimStartY, vDimX - 1.2, vDimStartY + 2.5);
    pdf.line(vDimX, vDimStartY, vDimX + 1.2, vDimStartY + 2.5);
    pdf.line(vDimX, vDimEndY, vDimX - 1.2, vDimEndY - 2.5);
    pdf.line(vDimX, vDimEndY, vDimX + 1.2, vDimEndY - 2.5);
    const zDimText = `${flatH.toFixed(1)}`;
    pdf.text(zDimText, vDimX + 2, (vDimStartY + vDimEndY) / 2, { angle: 90 });
  }

  // Thickness annotation
  if (flatThickness > 0.1) {
    pdf.setFontSize(6);
    pdf.setTextColor(...ACCENT_BLUE);
    pdf.text(`t = ${flatThickness.toFixed(1)} mm`, m + 6, y + flatSectionH - 2);
  }

  // Bend lines: only REAL positions are ever drawn (vector path above).
  // Never fabricate bend positions on a manufacturing drawing — when bending
  // is required but no geometry came back, state that explicitly instead.
  if (!drewVector && hasBends) {
    pdf.setFontSize(6);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...RED);
    pdf.text(
      `Bend line positions unavailable (${realBendCount || '?'} bend${realBendCount === 1 ? '' : 's'} detected) — refer to the server drawing or 3D model`,
      m + 6,
      y + 11,
    );
  }

  y += flatSectionH + 2;

  // ── TITLE BLOCK ───────────────────────────────────
  pdf.setFillColor(...DARK_BLUE);
  pdf.rect(m, y, contentW, titleBlockH, 'F');

  pdf.setTextColor(...WHITE);
  pdf.setFontSize(6.5);
  pdf.setFont('helvetica', 'normal');
  const now = new Date();
  pdf.text(`Part: ${partInfo.name || 'Untitled'}`, m + 4, y + 6);
  pdf.text(`Generated: ${now.toLocaleDateString('en-GB')} ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`, m + 4, y + 11);

  pdf.text(`Thickness: ${partInfo.thickness || '—'} mm  |  Material: ${partInfo.material || '—'}  |  Bends: ${hasBends ? `Yes (${realBendCount || '?'})` : 'No'}`, contentW / 2 + m, y + 6, { align: 'center' });
  pdf.text(`Flat size: ${flatW.toFixed(1)} × ${flatH.toFixed(1)} mm  |  Weight: ${weight || '—'}`, contentW / 2 + m, y + 11, { align: 'center' });

  pdf.setFont('helvetica', 'bold');
  pdf.text('MICRONS HUB DV E.E.', pageW - m - 4, y + 6, { align: 'right' });
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Scale: NTS  |  Sheet 1/1  |  File: ${fileName}`, pageW - m - 4, y + 11, { align: 'right' });

  // Note line
  pdf.setFontSize(5);
  pdf.setTextColor(180, 180, 200);
  pdf.text('NOTE: Verify all dimensions before production. Bend allowances must be calculated per material K-factor. All dimensions in mm.', m + 4, y + 15);

  // 6. Download
  const safeName = (partInfo.name || fileName).replace(/[^a-zA-Z0-9_-]/g, '_');
  pdf.save(`${safeName}_Bending_Drawing.pdf`);

  // Cleanup geometries
  geometries.forEach(g => g.dispose());
}
