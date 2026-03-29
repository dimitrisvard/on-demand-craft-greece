import React, { Suspense, useState, useMemo, useRef, useEffect } from 'react';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
// @ts-expect-error: no types for STLLoader
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
// @ts-expect-error: no types for BufferGeometryUtils
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils';
import {
  BufferGeometry,
  Float32BufferAttribute,
  MeshPhongMaterial,
  Color,
  DoubleSide,
  Vector3,
  Box3,
} from 'three';
import { Box as BoxIcon } from 'lucide-react';

// ── Props ─────────────────────────────────────────────────────────────────────

interface PartThumbnail3DProps {
  fileUrl: string;
  fileName: string;
  className?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const isSTL = (name: string) => /\.stl$/i.test(name);
const isSTEP = (name: string) => /\.(step|stp)$/i.test(name);
const isDXF = (name: string) => /\.dxf$/i.test(name);
const isOBJ = (name: string) => /\.obj$/i.test(name);
const isSupported = (name: string) => isSTL(name) || isSTEP(name) || isDXF(name) || isOBJ(name);

const cadMaterial = new MeshPhongMaterial({
  color: new Color('#b0bec5'),
  specular: new Color('#333333'),
  shininess: 45,
  side: DoubleSide,
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
  topDown,
}: {
  url: string;
  onDimensions: (dims: { x: number; y: number; z: number }) => void;
  topDown?: boolean;
}) {
  const geometry = useLoader(STLLoader, url) as BufferGeometry;
  const { camera } = useThree();

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
    const maxDim = Math.max(dims.x, dims.y, dims.z);
    const dist = maxDim * 1.8;
    if (topDown) {
      // Top-down view for DXF-like flat parts
      camera.position.set(0, dist, 0);
    } else {
      // Isometric view
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
}: {
  url: string;
  onDimensions: (dims: { x: number; y: number; z: number }) => void;
}) {
  const [geometries, setGeometries] = useState<BufferGeometry[]>([]);
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

    onDimensions({ x: size.x, y: size.y, z: size.z });

    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 1.8;
    camera.position.set(dist, dist * 0.7, dist);
    camera.lookAt(center.x, center.y, center.z);
    camera.updateProjectionMatrix();
  }, [geometries, camera, onDimensions]);

  if (loading) return null;
  if (error || geometries.length === 0) return null;

  return (
    <group ref={groupRef}>
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
    <div className="flex flex-col items-center justify-center h-[150px] w-[150px] rounded-lg bg-slate-50 border border-slate-200">
      <BoxIcon className="h-8 w-8 text-slate-400 mb-1" />
      <span className="text-[10px] text-slate-500 text-center px-2 truncate max-w-[130px]">
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
}: {
  children: React.ReactNode;
  onDimensions: { x: number; y: number; z: number } | null;
}) {
  return (
    <Canvas
      camera={{ position: [5, 5, 5], fov: 40 }}
      style={{ width: 150, height: 150 }}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 7]} intensity={1} />
      <directionalLight position={[-5, -3, -5]} intensity={0.3} />
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

export default function PartThumbnail3D({ fileUrl, fileName, className }: PartThumbnail3DProps) {
  const [dimensions, setDimensions] = useState<{ x: number; y: number; z: number } | null>(null);

  // Unsupported files get a static placeholder
  if (!isSupported(fileName)) {
    return <PlaceholderIcon fileName={fileName} />;
  }

  const topDown = isDXF(fileName);

  return (
    <ThumbnailErrorBoundary fileName={fileName}>
      <div className={`flex flex-col items-center ${className ?? ''}`}>
        <div className="h-[150px] w-[150px] rounded-lg overflow-hidden bg-slate-50 border border-slate-200">
          <Suspense fallback={<LoadingSpinner />}>
            <ThumbnailCanvas onDimensions={dimensions}>
              {isSTL(fileName) && (
                <STLModel url={fileUrl} onDimensions={setDimensions} topDown={topDown} />
              )}
              {isSTEP(fileName) && (
                <StepModel url={fileUrl} onDimensions={setDimensions} />
              )}
              {(isOBJ(fileName) || isDXF(fileName)) && (
                <STLModel url={fileUrl} onDimensions={setDimensions} topDown={topDown} />
              )}
            </ThumbnailCanvas>
          </Suspense>
        </div>
        {dimensions && (
          <p className="text-[10px] text-muted-foreground mt-1 text-center leading-tight">
            {dimensions.x.toFixed(1)} x {dimensions.y.toFixed(1)} x {dimensions.z.toFixed(1)} mm
          </p>
        )}
      </div>
    </ThumbnailErrorBoundary>
  );
}
