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

// ── Generate multi-view captures ─────────────────────────────────────────────

function captureViews(
  geometries: THREE.BufferGeometry[],
  center: THREE.Vector3,
  maxDim: number,
): ViewCapture[] {
  const viewWidth = 600;
  const viewHeight = 450;

  const views: { label: string; pos: [number, number, number]; up: [number, number, number] }[] = [
    { label: 'Front View', pos: [0, 0, 1], up: [0, 1, 0] },
    { label: 'Top View', pos: [0, 1, 0], up: [0, 0, -1] },
    { label: 'Right View', pos: [1, 0, 0], up: [0, 1, 0] },
    { label: 'Isometric View', pos: [0.65, 0.5, 0.65], up: [0, 1, 0] },
  ];

  return views.map(v => ({
    label: v.label,
    imageData: renderView(geometries, v.pos, v.up, center, maxDim, viewWidth, viewHeight),
    cameraPosition: v.pos,
    cameraUp: v.up,
  }));
}

// ── Build PDF ────────────────────────────────────────────────────────────────

function buildPdf(
  views: ViewCapture[],
  metrics: { size: THREE.Vector3; volume: number; surfaceArea: number },
  partInfo: PartInfo,
  weight: string | null,
): jsPDF {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 10;

  // ── Border ─────────────────────────────────────────────
  pdf.setDrawColor(0);
  pdf.setLineWidth(0.5);
  pdf.rect(margin, margin, pageW - 2 * margin, pageH - 2 * margin);

  // Inner border for drawing area
  pdf.setLineWidth(0.2);
  pdf.rect(margin + 2, margin + 2, pageW - 2 * margin - 4, pageH - 2 * margin - 55);

  // ── Views layout (2x2 grid) ────────────────────────────
  const drawAreaW = pageW - 2 * margin - 4;
  const drawAreaH = pageH - 2 * margin - 55;
  const halfW = drawAreaW / 2;
  const halfH = drawAreaH / 2;
  const viewStartX = margin + 2;
  const viewStartY = margin + 2;

  const positions = [
    [viewStartX, viewStartY],                         // Top-left: Front
    [viewStartX + halfW, viewStartY],                 // Top-right: Top
    [viewStartX, viewStartY + halfH],                 // Bottom-left: Right
    [viewStartX + halfW, viewStartY + halfH],         // Bottom-right: Isometric
  ];

  views.forEach((view, idx) => {
    const [x, y] = positions[idx];

    // View border
    pdf.setDrawColor(180);
    pdf.setLineWidth(0.1);
    pdf.rect(x, y, halfW, halfH);

    // View image
    const imgPadding = 4;
    const imgW = halfW - imgPadding * 2;
    const imgH = halfH - imgPadding * 2 - 6;
    pdf.addImage(view.imageData, 'PNG', x + imgPadding, y + imgPadding, imgW, imgH);

    // View label
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(30, 35, 126);
    pdf.text(view.label, x + imgPadding, y + halfH - 3);
  });

  // ── Dimension annotations (below each view) ───────────
  const dims = metrics.size;

  // Front view dimensions (X width, Z height)
  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(80);
  const frontX = positions[0][0] + 4;
  const frontY = positions[0][1] + halfH - 8;
  pdf.text(`${dims.x.toFixed(1)} x ${dims.y.toFixed(1)} mm`, frontX, frontY);

  // Top view (X width, Z depth)
  const topX = positions[1][0] + 4;
  const topY = positions[1][1] + halfH - 8;
  pdf.text(`${dims.x.toFixed(1)} x ${dims.z.toFixed(1)} mm`, topX, topY);

  // Right view (Z depth, Y height)
  const rightX = positions[2][0] + 4;
  const rightY = positions[2][1] + halfH - 8;
  pdf.text(`${dims.z.toFixed(1)} x ${dims.y.toFixed(1)} mm`, rightX, rightY);

  // Isometric - overall
  const isoX = positions[3][0] + 4;
  const isoY = positions[3][1] + halfH - 8;
  pdf.text(`${dims.x.toFixed(1)} x ${dims.y.toFixed(1)} x ${dims.z.toFixed(1)} mm`, isoX, isoY);

  // ── Title block ────────────────────────────────────────
  const tbY = pageH - margin - 53;
  const tbH = 51;
  const tbW = pageW - 2 * margin;

  pdf.setDrawColor(0);
  pdf.setLineWidth(0.5);
  pdf.rect(margin, tbY, tbW, tbH);

  // Title block grid
  const col1 = margin;
  const col2 = margin + tbW * 0.35;
  const col3 = margin + tbW * 0.65;

  pdf.setLineWidth(0.2);
  pdf.line(col2, tbY, col2, tbY + tbH);
  pdf.line(col3, tbY, col3, tbY + tbH);

  // Horizontal dividers in each column
  const row1 = tbY + 12;
  const row2 = tbY + 24;
  const row3 = tbY + 36;
  pdf.line(margin, row1, margin + tbW, row1);
  pdf.line(margin, row2, margin + tbW, row2);
  pdf.line(margin, row3, margin + tbW, row3);

  // ── Column 1: Part info ────────────────────────────────
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(30, 35, 126);
  pdf.text('TECHNICAL DRAWING', col1 + 4, tbY + 9);

  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(0);
  pdf.text(partInfo.name || 'Untitled Part', col1 + 4, row1 + 9);

  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(80);
  if (partInfo.material) pdf.text(`Material: ${partInfo.material}`, col1 + 4, row2 + 8);
  if (partInfo.process) pdf.text(`Process: ${partInfo.process}`, col1 + 4, row2 + 14);
  if (partInfo.quantity) pdf.text(`Qty: ${partInfo.quantity}`, col1 + 80, row2 + 8);

  // Row 3
  if (partInfo.thickness) pdf.text(`Thickness: ${partInfo.thickness} mm`, col1 + 4, row3 + 8);
  if (partInfo.needsBending) pdf.text('Bending: Yes', col1 + 60, row3 + 8);
  if (partInfo.surfaceTreatment) pdf.text(`Surface: ${partInfo.surfaceTreatment}`, col1 + 4, row3 + 14);

  // ── Column 2: Dimensions & metrics ─────────────────────
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(30, 35, 126);
  pdf.text('DIMENSIONS & METRICS', col2 + 4, tbY + 9);

  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(0);
  pdf.text(`Bounding Box: ${dims.x.toFixed(1)} x ${dims.y.toFixed(1)} x ${dims.z.toFixed(1)} mm`, col2 + 4, row1 + 8);

  const volText = metrics.volume >= 1000
    ? `${(metrics.volume / 1000).toFixed(2)} cm³`
    : `${metrics.volume.toFixed(1)} mm³`;
  pdf.text(`Volume: ${volText}`, col2 + 4, row1 + 15);

  const saText = metrics.surfaceArea >= 100
    ? `${(metrics.surfaceArea / 100).toFixed(2)} cm²`
    : `${metrics.surfaceArea.toFixed(1)} mm²`;
  pdf.text(`Surface Area: ${saText}`, col2 + 4, row2 + 8);

  if (weight) pdf.text(`Estimated Weight: ${weight}`, col2 + 4, row2 + 15);

  if (partInfo.tolerance) pdf.text(`Tolerance: ${partInfo.tolerance}`, col2 + 4, row3 + 8);
  if (partInfo.surfaceRoughness) pdf.text(`Surface Roughness: ${partInfo.surfaceRoughness}`, col2 + 4, row3 + 14);

  // ── Column 3: Company info ─────────────────────────────
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(30, 35, 126);
  pdf.text('MICRONS HUB DV E.E.', col3 + 4, tbY + 9);

  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(80);
  pdf.text('Industrial Area Street B Number 4', col3 + 4, row1 + 8);
  pdf.text('Heraklion, Greece 71601', col3 + 4, row1 + 14);
  pdf.text('+302104447830', col3 + 4, row2 + 8);
  pdf.text('info@micronshub.eu', col3 + 4, row2 + 14);

  pdf.setFontSize(6);
  pdf.setTextColor(140);
  const now = new Date();
  pdf.text(`Generated: ${now.toLocaleDateString('en-GB')} ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`, col3 + 4, row3 + 8);
  pdf.text('Scale: Not to scale (NTS)', col3 + 4, row3 + 14);
  pdf.text('Third Angle Projection', col3 + 4, tbY + tbH - 3);

  return pdf;
}

// ── Main export: generate technical drawing PDF ──────────────────────────────

export async function generateTechnicalDrawingPdf(
  fileUrl: string,
  fileName: string,
  partInfo: PartInfo,
): Promise<void> {
  // 1. Load geometry
  const geometries = await loadGeometry(fileUrl, fileName);
  if (!geometries.length) throw new Error('No geometry found in file');

  // 2. Calculate metrics
  const metrics = calculateMetrics(geometries);

  // 3. Calculate weight
  let weight: string | null = null;
  if (partInfo.material) {
    const { calculateWeight, formatWeight } = await import('./materialDensity');
    const w = calculateWeight(metrics.volume, partInfo.material);
    if (w != null) weight = formatWeight(w);
  }

  // 4. Capture multi-view renders
  const maxDim = Math.max(metrics.size.x, metrics.size.y, metrics.size.z);
  const views = captureViews(geometries, metrics.center, maxDim);

  // 5. Build PDF
  const pdf = buildPdf(views, metrics, partInfo, weight);

  // 6. Download
  const safeName = (partInfo.name || fileName).replace(/[^a-zA-Z0-9_-]/g, '_');
  pdf.save(`${safeName}_Technical_Drawing.pdf`);
}

// ── Flat pattern: project geometry to 2D (top-down) ──────────────────────────

export async function generateFlatPatternPdf(
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

  // 3. Render top-down (flat pattern) view
  const width = 1200;
  const height = 900;
  const topView = renderView(
    geometries,
    [0, 1, 0],   // camera looking down
    [0, 0, -1],  // up is -Z (so X goes right, Z goes down on screen)
    metrics.center,
    maxDim,
    width,
    height,
  );

  // Also render a front view for reference
  const frontView = renderView(
    geometries,
    [0, 0, 1],
    [0, 1, 0],
    metrics.center,
    maxDim,
    width,
    height,
  );

  // 4. Calculate weight
  let weight: string | null = null;
  if (partInfo.material) {
    const { calculateWeight, formatWeight } = await import('./materialDensity');
    const w = calculateWeight(metrics.volume, partInfo.material);
    if (w != null) weight = formatWeight(w);
  }

  // 5. Build PDF
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const m = 10;

  // Border
  pdf.setDrawColor(0);
  pdf.setLineWidth(0.5);
  pdf.rect(m, m, pageW - 2 * m, pageH - 2 * m);

  // Title
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(30, 35, 126);
  pdf.text('FLAT PATTERN / TOP VIEW PROJECTION', m + 4, m + 10);

  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(80);
  pdf.text(partInfo.name || fileName, m + 4, m + 17);

  // Top-down view (main, large)
  const imgY = m + 22;
  const imgH = pageH - 2 * m - 65;
  const imgW = (pageW - 2 * m - 8) * 0.65;
  pdf.addImage(topView, 'PNG', m + 2, imgY, imgW, imgH);

  // View label
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(30, 35, 126);
  pdf.text('Top View (Flat Pattern)', m + 4, imgY + imgH + 5);

  // Dimension text under main view
  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(0);
  pdf.text(`${dims.x.toFixed(1)} x ${dims.z.toFixed(1)} mm (Width x Depth)`, m + 4, imgY + imgH + 11);

  // Front view (smaller, right side)
  const refX = m + imgW + 8;
  const refW = pageW - 2 * m - imgW - 12;
  const refH = imgH * 0.55;
  pdf.addImage(frontView, 'PNG', refX, imgY, refW, refH);
  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(30, 35, 126);
  pdf.text('Front View (Reference)', refX + 2, imgY + refH + 5);

  // Specs box (right side, below front view)
  const specY = imgY + refH + 12;
  pdf.setDrawColor(180);
  pdf.setLineWidth(0.2);
  pdf.rect(refX, specY, refW, imgH - refH - 12);

  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(30, 35, 126);
  pdf.text('SPECIFICATIONS', refX + 3, specY + 8);

  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(0);
  let specLine = specY + 16;
  const specLineH = 6;

  const specs = [
    partInfo.material && `Material: ${partInfo.material}`,
    partInfo.thickness && `Thickness: ${partInfo.thickness} mm`,
    partInfo.process && `Process: ${partInfo.process}`,
    `Bounding Box: ${dims.x.toFixed(1)} x ${dims.y.toFixed(1)} x ${dims.z.toFixed(1)} mm`,
    weight && `Est. Weight: ${weight}`,
    partInfo.tolerance && `Tolerance: ${partInfo.tolerance}`,
    partInfo.surfaceRoughness && `Surface Roughness: ${partInfo.surfaceRoughness}`,
    partInfo.surfaceTreatment && `Surface Treatment: ${partInfo.surfaceTreatment}`,
    partInfo.needsBending && 'Bending: Required',
    partInfo.quantity && `Quantity: ${partInfo.quantity}`,
  ].filter(Boolean);

  specs.forEach(s => {
    pdf.text(s as string, refX + 3, specLine);
    specLine += specLineH;
  });

  // Title block at bottom
  const tbY = pageH - m - 35;
  pdf.setDrawColor(0);
  pdf.setLineWidth(0.3);
  pdf.rect(m, tbY, pageW - 2 * m, 33);
  pdf.line(m + (pageW - 2 * m) * 0.5, tbY, m + (pageW - 2 * m) * 0.5, tbY + 33);

  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(30, 35, 126);
  pdf.text('MICRONS HUB DV E.E.', m + 4, tbY + 8);
  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(80);
  pdf.text('Industrial Area Street B Number 4, Heraklion, Greece 71601', m + 4, tbY + 15);
  pdf.text('+302104447830 | info@micronshub.eu', m + 4, tbY + 21);

  const rightCol = m + (pageW - 2 * m) * 0.5 + 4;
  pdf.setFontSize(7);
  pdf.setTextColor(80);
  const now = new Date();
  pdf.text(`Date: ${now.toLocaleDateString('en-GB')}`, rightCol, tbY + 8);
  pdf.text('Scale: Not to scale (NTS)', rightCol, tbY + 14);
  pdf.text('Projection: Third Angle / Top-Down', rightCol, tbY + 20);
  pdf.text(`File: ${fileName}`, rightCol, tbY + 26);

  // 6. Download
  const safeName = (partInfo.name || fileName).replace(/[^a-zA-Z0-9_-]/g, '_');
  pdf.save(`${safeName}_Flat_Pattern.pdf`);
}
