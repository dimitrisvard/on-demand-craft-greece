import React, { Suspense, useState, useMemo, useRef, useEffect } from 'react';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
// @ts-expect-error: no types for STLLoader
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
// @ts-expect-error: no types for BufferGeometryUtils
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils';
import {
  BufferGeometry,
  Float32BufferAttribute,
  MeshStandardMaterial,
  ACESFilmicToneMapping,
  Color,
  DoubleSide,
  Vector3,
  Box3,
} from 'three';
import { Box as BoxIcon } from 'lucide-react';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PartThumbnail3DMetrics {
  dimensions: { x: number; y: number; z: number };
  volume: number; // mm³
}

interface PartThumbnail3DProps {
  fileUrl: string;
  fileName: string;
  className?: string;
  size?: number; // px, defaults to 200
  onMetrics?: (metrics: PartThumbnail3DMetrics) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const isSTL = (name: string) => /\.stl$/i.test(name);
const isSTEP = (name: string) => /\.(step|stp)$/i.test(name);
const isDXF = (name: string) => /\.dxf$/i.test(name);
const isOBJ = (name: string) => /\.obj$/i.test(name);
const isSupported = (name: string) => isSTL(name) || isSTEP(name) || isDXF(name) || isOBJ(name);

/** Signed-volume method — same algorithm as volumeCalculation.ts but inline to avoid import issues */
function computeVolume(geom: BufferGeometry): number {
  const pos = geom.getAttribute('position');
  if (!pos) return 0;
  const idx = geom.getIndex();
  let vol = 0;
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      a.fromBufferAttribute(pos, idx.getX(i));
      b.fromBufferAttribute(pos, idx.getX(i + 1));
      c.fromBufferAttribute(pos, idx.getX(i + 2));
      vol += a.dot(new Vector3().crossVectors(b, c)) / 6;
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      vol += a.dot(new Vector3().crossVectors(b, c)) / 6;
    }
  }
  return Math.abs(vol);
}

const cadMaterial = new MeshStandardMaterial({
  color: new Color('#546e7a'),
  metalness: 0.15,
  roughness: 0.55,
  side: DoubleSide,
  envMapIntensity: 0.8,
});

// ── Smooth geometry (same as ThreeDViewerModal) ──────────────────────────────

function smoothGeometry(geom: BufferGeometry): BufferGeometry {
  try {
    const merged = mergeVertices(geom);
    merged.computeVertexNormals();
    return merged;
  } catch {
    geom.computeVertexNormals();
    return geom;
  }
}

// ── OCCT loader (shared with ThreeDViewerModal) ──────────────────────────────

let occtPromise: Promise<any> | null = null;

function loadOcct(): Promise<any> {
  if (!occtPromise) {
    occtPromise = new Promise((resolve, reject) => {
      if ((window as any).occtimportjs) {
        resolve((window as any).occtimportjs());
        return;
      }
      const existingScript = document.querySelector('script[src="/occt-import-js.js"]');
      if (existingScript) {
        const check = setInterval(() => {
          if ((window as any).occtimportjs) { clearInterval(check); resolve((window as any).occtimportjs()); }
        }, 100);
        setTimeout(() => { clearInterval(check); reject(new Error('occt-import-js timeout')); }, 15000);
        return;
      }
      const script = document.createElement('script');
      script.src = '/occt-import-js.js';
      script.onload = () => {
        const check = setInterval(() => {
          if ((window as any).occtimportjs) { clearInterval(check); resolve((window as any).occtimportjs()); }
        }, 100);
        setTimeout(() => { clearInterval(check); reject(new Error('occt-import-js timeout')); }, 15000);
      };
      script.onerror = () => reject(new Error('Failed to load occt-import-js.js'));
      document.head.appendChild(script);
    });
  }
  return occtPromise;
}

// ── STL Model sub-component ───────────────────────────────────────────────────

function STLModel({
  url,
  onDimensions,
  onMetrics,
  topDown,
}: {
  url: string;
  onDimensions: (dims: { x: number; y: number; z: number }) => void;
  onMetrics?: (m: PartThumbnail3DMetrics) => void;
  topDown?: boolean;
}) {
  const geometry = useLoader(STLLoader, url) as BufferGeometry;
  const { camera } = useThree();
  const metricsReported = useRef(false);

  const dims = useMemo(() => {
    geometry.computeBoundingBox();
    geometry.center();
    const box = geometry.boundingBox!;
    const size = new Vector3();
    box.getSize(size);
    return { x: size.x, y: size.y, z: size.z };
  }, [geometry]);

  useEffect(() => {
    onDimensions(dims);
    if (onMetrics && !metricsReported.current) {
      metricsReported.current = true;
      const vol = computeVolume(geometry);
      onMetrics({ dimensions: dims, volume: vol });
    }
    const maxDim = Math.max(dims.x, dims.y, dims.z);
    const dist = maxDim * 1.8;
    if (topDown) {
      camera.position.set(0, dist, 0);
    } else {
      camera.position.set(dist, dist * 0.7, dist);
    }
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [dims, camera, onDimensions, topDown]);

  return <mesh geometry={geometry} material={cadMaterial} />;
}

// ── STEP Model sub-component ──────────────────────────────────────────────────

function StepModel({
  url,
  onDimensions,
  onMetrics,
}: {
  url: string;
  onDimensions: (dims: { x: number; y: number; z: number }) => void;
  onMetrics?: (m: PartThumbnail3DMetrics) => void;
}) {
  const [geometries, setGeometries] = useState<BufferGeometry[]>([]);
  const [centerOffset, setCenterOffset] = useState<Vector3 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const { camera } = useThree();
  const groupRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const occt = await loadOcct();
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch');
        const buffer = await response.arrayBuffer();
        const result = occt.ReadStepFile(new Uint8Array(buffer), {
          linearDeflection: 0.001,
          linearDeflectionType: 'bounding_box_ratio',
        });
        if (!result.success) throw new Error('Parse failed');
        if (cancelled) return;

        const geoms = (result.meshes || []).map((mesh: any) => {
          const geom = new BufferGeometry();
          geom.setAttribute('position', new Float32BufferAttribute(mesh.attributes.position.array, 3));
          if (mesh.index) geom.setIndex(Array.from(mesh.index.array));
          return smoothGeometry(geom);
        });
        setGeometries(geoms);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [url]);

  // Compute dimensions and frame camera once geometries are loaded
  useEffect(() => {
    if (geometries.length === 0 || !groupRef.current) return;

    const box = new Box3();
    geometries.forEach((g) => {
      g.computeBoundingBox();
      if (g.boundingBox) box.union(g.boundingBox);
    });

    const center = new Vector3();
    const size = new Vector3();
    box.getCenter(center);
    box.getSize(size);

    // Center the group so the model is at origin
    setCenterOffset(center.clone());

    const dims = { x: size.x, y: size.y, z: size.z };
    onDimensions(dims);

    if (onMetrics) {
      let totalVol = 0;
      geometries.forEach((g) => { totalVol += computeVolume(g); });
      onMetrics({ dimensions: dims, volume: totalVol });
    }

    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 1.8;
    camera.position.set(dist, dist * 0.7, dist);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [geometries, camera, onDimensions]);

  if (loading) return null;
  if (error || geometries.length === 0) return null;

  return (
    <group ref={groupRef} position={centerOffset ? [-centerOffset.x, -centerOffset.y, -centerOffset.z] : [0, 0, 0]}>
      {geometries.map((geom, i) => (
        <mesh key={i} geometry={geom} material={cadMaterial} />
      ))}
    </group>
  );
}

// ── Loading spinner ───────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-full w-full">
      <div className="animate-spin rounded-full h-6 w-6 border-2 border-slate-300 border-t-slate-600" />
    </div>
  );
}

// ── Fallback placeholder ──────────────────────────────────────────────────────

function PlaceholderIcon({ fileName }: { fileName: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-[200px] w-[200px] rounded-lg bg-slate-50 border border-slate-200">
      <BoxIcon className="h-8 w-8 text-slate-400 mb-1" />
      <span className="text-[11px] text-slate-500 text-center px-2 truncate max-w-[180px]">
        {fileName}
      </span>
    </div>
  );
}

// ── Error boundary ────────────────────────────────────────────────────────────

class ThumbnailErrorBoundary extends React.Component<
  { fileName: string; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fileName: string; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return <PlaceholderIcon fileName={this.props.fileName} />;
    }
    return this.props.children;
  }
}

// ── 3D Canvas wrapper ─────────────────────────────────────────────────────────

function ThumbnailCanvas({
  children,
  onDimensions,
  size = 200,
}: {
  children: React.ReactNode;
  onDimensions: { x: number; y: number; z: number } | null;
  size?: number;
}) {
  return (
    <Canvas
      camera={{ position: [5, 5, 5], fov: 45 }}
      style={{ width: size, height: size }}
      dpr={[1.5, 2]}
      gl={{
        antialias: true,
        alpha: true,
        toneMapping: ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
        outputColorSpace: 'srgb',
      }}
    >
      <Environment preset="studio" environmentIntensity={0.5} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[5, 10, 7]} intensity={0.7} color="#fff8f0" />
      <directionalLight position={[-5, -3, -5]} intensity={0.3} color="#e8f0ff" />
      {children}
      <OrbitControls
        enableZoom={false}
        enablePan={false}
        autoRotate
        autoRotateSpeed={2}
      />
    </Canvas>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PartThumbnail3D({ fileUrl, fileName, className, size = 200, onMetrics }: PartThumbnail3DProps) {
  const [dimensions, setDimensions] = useState<{ x: number; y: number; z: number } | null>(null);

  // Unsupported files get a static placeholder
  if (!isSupported(fileName)) {
    return <PlaceholderIcon fileName={fileName} />;
  }

  // DXF files are 2D drawings — show a drawing placeholder
  if (isDXF(fileName)) {
    return (
      <div className={`flex flex-col items-center ${className ?? ''}`}>
        <div className="h-[200px] w-[200px] rounded-lg bg-slate-50 border border-slate-200 flex flex-col items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          <span className="text-[10px] text-slate-500 mt-1.5 font-medium">2D Drawing</span>
          <span className="text-[9px] text-slate-400 truncate max-w-[130px] px-2">{fileName}</span>
        </div>
      </div>
    );
  }

  return (
    <ThumbnailErrorBoundary fileName={fileName}>
      <div className={`flex flex-col items-center ${className ?? ''}`}>
        <div className="rounded-lg overflow-hidden bg-slate-50 border border-slate-200" style={{ width: size, height: size }}>
          <Suspense fallback={<LoadingSpinner />}>
            <ThumbnailCanvas onDimensions={dimensions} size={size}>
              {isSTL(fileName) && (
                <STLModel url={fileUrl} onDimensions={setDimensions} onMetrics={onMetrics} />
              )}
              {isSTEP(fileName) && (
                <StepModel url={fileUrl} onDimensions={setDimensions} onMetrics={onMetrics} />
              )}
              {isOBJ(fileName) && (
                <STLModel url={fileUrl} onDimensions={setDimensions} onMetrics={onMetrics} />
              )}
            </ThumbnailCanvas>
          </Suspense>
        </div>
        {dimensions && (
          <p className="text-xs font-medium text-muted-foreground mt-1.5 text-center leading-tight">
            {dimensions.x.toFixed(1)} x {dimensions.y.toFixed(1)} x {dimensions.z.toFixed(1)} mm
          </p>
        )}
      </div>
    </ThumbnailErrorBoundary>
  );
}
