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

// ── Main export: generate manufacturing drawing PDF ─────────────────────────
//
// Single PDF layout:
//   Top-left (~25%): Isometric 3D view with shading
//   Main area (~75%): Large top-down orthographic view (flat pattern / sketch)
//   Right column: Front view reference + specs panel
//   Bottom: Title block with part info, dimensions, company info
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

  // 4. Render views
  // Isometric (small, for top-left)
  const isoView = renderViewSafe(geometries, [0.65, 0.5, 0.65], [0, 1, 0], metrics.center, maxDim, 600, 600);
  // Top-down flat pattern (large, main area)
  const topView = renderViewSafe(geometries, [0, 1, 0], [0, 0, -1], metrics.center, maxDim, 1200, 900);
  // Front reference view
  const frontView = renderViewSafe(geometries, [0, 0, 1], [0, 1, 0], metrics.center, maxDim, 600, 450);

  // 5. Build PDF
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const m = 10;

  // ── Outer border ──────────────────────────────────
  pdf.setDrawColor(0);
  pdf.setLineWidth(0.5);
  pdf.rect(m, m, pageW - 2 * m, pageH - 2 * m);

  // Layout constants
  const titleBarH = 14;
  const titleBlockH = 42;
  const drawAreaTop = m + titleBarH;
  const drawAreaBottom = pageH - m - titleBlockH;
  const drawAreaH = drawAreaBottom - drawAreaTop;
  const leftColW = (pageW - 2 * m) * 0.28; // ~28% for isometric + front
  const mainW = (pageW - 2 * m) - leftColW; // ~72% for flat pattern

  // ── Title bar ─────────────────────────────────────
  pdf.setFillColor(30, 35, 126);
  pdf.rect(m, m, pageW - 2 * m, titleBarH, 'F');
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(255, 255, 255);
  pdf.text('MANUFACTURING DRAWING', m + 6, m + 10);
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.text(partInfo.name || fileName.replace(/\.[^.]+$/, ''), m + 120, m + 10);
  if (partInfo.needsBending) {
    pdf.setFillColor(255, 140, 0);
    pdf.roundedRect(pageW - m - 55, m + 2, 50, 10, 2, 2, 'F');
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(255, 255, 255);
    pdf.text('BENDING REQUIRED', pageW - m - 53, m + 9);
  }

  // ── Left column: Isometric view (top-left) ────────
  const isoX = m;
  const isoY = drawAreaTop;
  const isoH = drawAreaH * 0.55;

  // Isometric view box
  pdf.setDrawColor(180);
  pdf.setLineWidth(0.2);
  pdf.rect(isoX, isoY, leftColW, isoH);
  pdf.addImage(isoView, 'PNG', isoX + 3, isoY + 3, leftColW - 6, isoH - 14);
  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(30, 35, 126);
  pdf.text('ISOMETRIC VIEW', isoX + 4, isoY + isoH - 4);

  // ── Left column: Front view (below isometric) ─────
  const frontY = isoY + isoH;
  const frontH = drawAreaH - isoH;
  pdf.setDrawColor(180);
  pdf.rect(isoX, frontY, leftColW, frontH);
  pdf.addImage(frontView, 'PNG', isoX + 3, frontY + 3, leftColW - 6, frontH - 14);
  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(30, 35, 126);
  pdf.text('FRONT VIEW', isoX + 4, frontY + frontH - 4);

  // ── Main area: Top-down flat pattern ──────────────
  const mainX = m + leftColW;
  const mainY = drawAreaTop;
  pdf.setDrawColor(0);
  pdf.setLineWidth(0.3);
  pdf.rect(mainX, mainY, mainW, drawAreaH);
  pdf.addImage(topView, 'PNG', mainX + 4, mainY + 4, mainW - 8, drawAreaH - 20);

  // View label
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(30, 35, 126);
  pdf.text('TOP VIEW \u2014 FLAT PATTERN', mainX + 6, mainY + drawAreaH - 6);

  // ── Dimension annotations on the flat pattern ─────
  pdf.setDrawColor(200, 0, 0);
  pdf.setLineWidth(0.3);
  pdf.setTextColor(200, 0, 0);
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'bold');

  // Horizontal dimension (X) — below the flat pattern image
  const dimLineY = mainY + drawAreaH - 14;
  const dimStartX = mainX + mainW * 0.15;
  const dimEndX = mainX + mainW * 0.85;
  pdf.line(dimStartX, dimLineY, dimEndX, dimLineY);
  // Arrow heads
  pdf.line(dimStartX, dimLineY, dimStartX + 3, dimLineY - 1.5);
  pdf.line(dimStartX, dimLineY, dimStartX + 3, dimLineY + 1.5);
  pdf.line(dimEndX, dimLineY, dimEndX - 3, dimLineY - 1.5);
  pdf.line(dimEndX, dimLineY, dimEndX - 3, dimLineY + 1.5);
  // Dimension text
  const xDimText = `${dims.x.toFixed(1)} mm`;
  pdf.text(xDimText, (dimStartX + dimEndX) / 2 - pdf.getTextWidth(xDimText) / 2, dimLineY - 2);

  // Vertical dimension (Z for top view) — right of image
  const vDimX = mainX + mainW - 12;
  const vDimStartY = mainY + drawAreaH * 0.12;
  const vDimEndY = mainY + drawAreaH * 0.82;
  pdf.line(vDimX, vDimStartY, vDimX, vDimEndY);
  pdf.line(vDimX, vDimStartY, vDimX - 1.5, vDimStartY + 3);
  pdf.line(vDimX, vDimStartY, vDimX + 1.5, vDimStartY + 3);
  pdf.line(vDimX, vDimEndY, vDimX - 1.5, vDimEndY - 3);
  pdf.line(vDimX, vDimEndY, vDimX + 1.5, vDimEndY - 3);
  const zDimText = `${dims.z.toFixed(1)} mm`;
  pdf.text(zDimText, vDimX + 3, (vDimStartY + vDimEndY) / 2, { angle: 90 });

  // ── Title block ───────────────────────────────────
  const tbY = drawAreaBottom;
  const tbW = pageW - 2 * m;
  pdf.setDrawColor(0);
  pdf.setLineWidth(0.5);
  pdf.rect(m, tbY, tbW, titleBlockH);

  // 3-column layout
  const col1 = m;
  const col2 = m + tbW * 0.35;
  const col3 = m + tbW * 0.67;
  pdf.setLineWidth(0.2);
  pdf.line(col2, tbY, col2, tbY + titleBlockH);
  pdf.line(col3, tbY, col3, tbY + titleBlockH);

  // Row dividers
  const r1 = tbY + 10;
  const r2 = tbY + 21;
  const r3 = tbY + 32;
  pdf.line(m, r1, m + tbW, r1);
  pdf.line(m, r2, m + tbW, r2);

  // ── Col 1: Part info ──────────────────────────────
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(30, 35, 126);
  pdf.text('PART INFORMATION', col1 + 4, tbY + 7);

  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(0);
  pdf.text(partInfo.name || 'Untitled Part', col1 + 4, r1 + 7);

  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(80);
  const partSpecs = [
    partInfo.material && `Material: ${partInfo.material}`,
    partInfo.process && `Process: ${partInfo.process}`,
    partInfo.thickness && `Thickness: ${partInfo.thickness} mm`,
    partInfo.surfaceTreatment && partInfo.surfaceTreatment !== 'none' && `Finish: ${partInfo.surfaceTreatment}`,
    partInfo.needsBending && 'Bending: REQUIRED',
    partInfo.quantity && `Qty: ${partInfo.quantity}`,
  ].filter(Boolean) as string[];
  partSpecs.forEach((s, i) => {
    const col = i % 2 === 0 ? col1 + 4 : col1 + 80;
    const row = r2 + 7 + Math.floor(i / 2) * 6;
    if (row < tbY + titleBlockH - 2) pdf.text(s, col, row);
  });

  // ── Col 2: Dimensions & metrics ───────────────────
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(30, 35, 126);
  pdf.text('DIMENSIONS & METRICS', col2 + 4, tbY + 7);

  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(0);
  pdf.text(`Bounding Box: ${dims.x.toFixed(1)} \u00d7 ${dims.y.toFixed(1)} \u00d7 ${dims.z.toFixed(1)} mm`, col2 + 4, r1 + 7);

  const volText = metrics.volume >= 1000
    ? `${(metrics.volume / 1000).toFixed(2)} cm\u00b3`
    : `${metrics.volume.toFixed(1)} mm\u00b3`;
  pdf.text(`Volume: ${volText}`, col2 + 4, r1 + 14);

  if (weight) pdf.text(`Est. Weight: ${weight}`, col2 + 4, r2 + 7);
  if (partInfo.tolerance) pdf.text(`Tolerance: ${partInfo.tolerance}`, col2 + 4, r2 + 14);
  if (partInfo.surfaceRoughness) pdf.text(`Ra: ${partInfo.surfaceRoughness}`, col2 + 80, r2 + 7);

  const saText = metrics.surfaceArea >= 100
    ? `${(metrics.surfaceArea / 100).toFixed(2)} cm\u00b2`
    : `${metrics.surfaceArea.toFixed(1)} mm\u00b2`;
  pdf.text(`Surface Area: ${saText}`, col2 + 4, r3 + 7);

  // ── Col 3: Company info ───────────────────────────
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(30, 35, 126);
  pdf.text('MICRONS HUB DV E.E.', col3 + 4, tbY + 7);

  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(80);
  pdf.text('Industrial Area Street B Number 4', col3 + 4, r1 + 7);
  pdf.text('Heraklion, Greece 71601', col3 + 4, r1 + 13);
  pdf.text('+302104447830 | info@micronshub.eu', col3 + 4, r2 + 7);

  pdf.setFontSize(6);
  pdf.setTextColor(140);
  const now = new Date();
  pdf.text(`Generated: ${now.toLocaleDateString('en-GB')} ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`, col3 + 4, r2 + 14);
  pdf.text('Scale: NTS | Third Angle Projection', col3 + 4, r3 + 7);
  pdf.text(`File: ${fileName}`, col3 + 4, r3 + 13);

  // 6. Download
  const safeName = (partInfo.name || fileName).replace(/[^a-zA-Z0-9_-]/g, '_');
  pdf.save(`${safeName}_Manufacturing_Drawing.pdf`);

  // Cleanup geometries
  geometries.forEach(g => g.dispose());
}
