import React, { Suspense, useState, useMemo, useRef, useEffect } from 'react';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
// @ts-expect-error: no types for STLLoader
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
import {
  BufferGeometry,
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

const isSTL = (name: string) => name.toLowerCase().endsWith('.stl');

const cadMaterial = new MeshPhongMaterial({
  color: new Color('#b0bec5'),
  specular: new Color('#333333'),
  shininess: 45,
  side: DoubleSide,
});

// ── STL Model sub-component ───────────────────────────────────────────────────

function STLModel({
  url,
  onDimensions,
}: {
  url: string;
  onDimensions: (dims: { x: number; y: number; z: number }) => void;
}) {
  const geometry = useLoader(STLLoader, url) as BufferGeometry;
  const { camera } = useThree();
  const meshRef = useRef<any>(null);

  // Center geometry and compute dimensions once
  const dims = useMemo(() => {
    geometry.computeBoundingBox();
    geometry.center();
    const box = geometry.boundingBox!;
    const size = new Vector3();
    box.getSize(size);
    return { x: size.x, y: size.y, z: size.z };
  }, [geometry]);

  // Auto-frame: position orthographic-style camera to fit model
  useEffect(() => {
    onDimensions(dims);
    const maxDim = Math.max(dims.x, dims.y, dims.z);
    const dist = maxDim * 1.8;
    // Isometric-ish angle: 45 deg azimuth, ~35 deg elevation
    camera.position.set(dist, dist * 0.7, dist);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [dims, camera, onDimensions]);

  return <mesh ref={meshRef} geometry={geometry} material={cadMaterial} />;
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

// ── Main component ────────────────────────────────────────────────────────────

export default function PartThumbnail3D({ fileUrl, fileName, className }: PartThumbnail3DProps) {
  const [dimensions, setDimensions] = useState<{ x: number; y: number; z: number } | null>(null);

  // Non-STL files get a static placeholder
  if (!isSTL(fileName)) {
    return <PlaceholderIcon fileName={fileName} />;
  }

  return (
    <ThumbnailErrorBoundary fileName={fileName}>
      <div className={`flex flex-col items-center ${className ?? ''}`}>
        <div className="h-[150px] w-[150px] rounded-lg overflow-hidden bg-slate-50 border border-slate-200">
          <Suspense fallback={<LoadingSpinner />}>
            <Canvas
              camera={{ position: [5, 5, 5], fov: 40 }}
              style={{ width: 150, height: 150 }}
              gl={{ antialias: true, alpha: true }}
            >
              <ambientLight intensity={0.5} />
              <directionalLight position={[5, 10, 7]} intensity={1} />
              <directionalLight position={[-5, -3, -5]} intensity={0.3} />
              <STLModel url={fileUrl} onDimensions={setDimensions} />
              <OrbitControls
                enableZoom={false}
                enablePan={false}
                autoRotate
                autoRotateSpeed={2}
              />
            </Canvas>
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
