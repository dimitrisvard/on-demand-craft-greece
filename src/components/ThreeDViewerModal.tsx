import React, { Suspense, useEffect, useState, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment, ContactShadows, Center } from '@react-three/drei';
import {
  BufferGeometry,
  Float32BufferAttribute,
  MeshStandardMaterial,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Vector3,
  Box3,
  Color,
  ACESFilmicToneMapping,
  Group,
  Mesh,
} from 'three';
// @ts-expect-error: no types for OBJLoader
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';
// @ts-expect-error: no types for STLLoader
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
import { useLoader } from '@react-three/fiber';

interface ThreeDViewerModalProps {
  open: boolean;
  onClose: () => void;
  fileUrl: string | null;
  fileType: string | null;
  fileName: string | null;
}

const isSTL = (name: string) => name.toLowerCase().endsWith('.stl');
const isOBJ = (name: string) => name.toLowerCase().endsWith('.obj');
const isGLB = (name: string) => name.toLowerCase().endsWith('.glb');
const isGLTF = (name: string) => name.toLowerCase().endsWith('.gltf');
const isSTEP = (name: string) => name.toLowerCase().endsWith('.step') || name.toLowerCase().endsWith('.stp');

// Professional CAD material — metallic gray with subtle reflections
function createCADMaterial() {
  return new MeshStandardMaterial({
    color: new Color('#8BADC4'),
    metalness: 0.15,
    roughness: 0.45,
    envMapIntensity: 0.6,
    side: 2, // DoubleSide
  });
}

// Edge line material for CAD-style outlines
function createEdgeMaterial() {
  return new LineBasicMaterial({
    color: new Color('#3A5A7C'),
    linewidth: 1,
    transparent: true,
    opacity: 0.35,
  });
}

// Auto-fit camera to model bounds
function AutoFrame({ children }: { children: React.ReactNode }) {
  const groupRef = useRef<Group>(null);
  const { camera } = useThree();
  const hasFramed = useRef(false);

  useFrame(() => {
    if (hasFramed.current || !groupRef.current) return;
    // Wait one frame for geometry to be ready
    const box = new Box3().setFromObject(groupRef.current);
    if (box.isEmpty()) return;

    hasFramed.current = true;
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const distance = maxDim * 2.2;

    camera.position.set(center.x + distance * 0.5, center.y + distance * 0.4, center.z + distance * 0.7);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  });

  return <group ref={groupRef}>{children}</group>;
}

// Mesh with edge lines for crisp CAD look
function CADMesh({ geometry }: { geometry: BufferGeometry }) {
  const edges = useMemo(() => new EdgesGeometry(geometry, 15), [geometry]);

  return (
    <group>
      <mesh geometry={geometry}>
        <primitive object={createCADMaterial()} attach="material" />
      </mesh>
      <lineSegments geometry={edges}>
        <primitive object={createEdgeMaterial()} attach="material" />
      </lineSegments>
    </group>
  );
}

// Helper to load occt-import-js WASM only once
let occtPromise: Promise<any> | null = null;
function loadOcct() {
  if (!occtPromise) {
    occtPromise = new Promise((resolve, reject) => {
      if ((window as any).occtimportjs) {
        resolve((window as any).occtimportjs());
        return;
      }

      const existingScript = document.querySelector('script[src="/occt-import-js.js"]');
      if (existingScript) {
        const checkInterval = setInterval(() => {
          if ((window as any).occtimportjs) {
            clearInterval(checkInterval);
            resolve((window as any).occtimportjs());
          }
        }, 50);
        setTimeout(() => {
          clearInterval(checkInterval);
          reject(new Error('occt-import-js failed to initialize after timeout'));
        }, 5000);
        return;
      }

      const script = document.createElement('script');
      script.src = '/occt-import-js.js';
      script.onload = () => {
        const checkInterval = setInterval(() => {
          if ((window as any).occtimportjs) {
            clearInterval(checkInterval);
            resolve((window as any).occtimportjs());
          }
        }, 50);
        setTimeout(() => {
          clearInterval(checkInterval);
          reject(new Error('occt-import-js failed to initialize after timeout'));
        }, 5000);
      };
      script.onerror = () => reject(new Error('Failed to load occt-import-js.js'));
      document.body.appendChild(script);
    });
  }
  return occtPromise;
}

// Shared scene wrapper with lighting, controls, background
function ViewerScene({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: 450, borderRadius: '8px', overflow: 'hidden' }}>
      <Canvas
        camera={{ position: [0, 0, 100], fov: 45 }}
        style={{ height: 450 }}
        shadows
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
          outputColorSpace: 'srgb',
        }}
      >
        {/* Gradient background */}
        <color attach="background" args={['#f0f4f8']} />

        {/* Lighting — 3-point + hemisphere for natural fill */}
        <hemisphereLight
          args={[new Color('#b1d8f5'), new Color('#e8e0d4'), 0.5]}
        />
        <ambientLight intensity={0.3} />
        <directionalLight
          position={[5, 8, 5]}
          intensity={1.0}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-bias={-0.0001}
        />
        <directionalLight position={[-4, 3, -3]} intensity={0.4} />
        <directionalLight position={[0, -2, 5]} intensity={0.2} />

        {/* Soft environment reflections */}
        <Environment preset="city" />

        <Suspense fallback={null}>
          <AutoFrame>
            <Center>{children}</Center>
          </AutoFrame>
        </Suspense>

        {/* Contact shadow for grounding */}
        <ContactShadows
          position={[0, -0.5, 0]}
          opacity={0.3}
          scale={20}
          blur={2}
          far={4}
        />

        <OrbitControls
          enablePan
          enableZoom
          enableRotate
          minDistance={0.5}
          maxDistance={1000}
          enableDamping
          dampingFactor={0.08}
          rotateSpeed={0.7}
          zoomSpeed={1.0}
          panSpeed={0.7}
          makeDefault
        />
      </Canvas>
    </div>
  );
}

function applyCADMaterial(obj: any) {
  obj.traverse((child: any) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.material = createCADMaterial();
      // Add edge lines
      const edgesGeo = new EdgesGeometry(child.geometry, 15);
      const edgeLines = new LineSegments(edgesGeo, createEdgeMaterial());
      child.add(edgeLines);
    }
  });
}

function STLModel({ url }: { url: string }) {
  const geometry = useLoader(STLLoader, url);
  geometry.computeVertexNormals();
  return <CADMesh geometry={geometry} />;
}

function OBJModel({ url }: { url: string }) {
  const obj = useLoader(OBJLoader, url);
  useMemo(() => applyCADMaterial(obj), [obj]);
  return <primitive object={obj} />;
}

function GLTFModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  useMemo(() => applyCADMaterial(scene), [scene]);
  return <primitive object={scene} />;
}

function StepModelInner({ url }: { url: string }) {
  const [meshes, setMeshes] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadStep() {
      setLoading(true);
      setError(null);
      try {
        const occt = await loadOcct();
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        const result = occt.ReadStepFile(new Uint8Array(buffer), null);
        if (!result.success) {
          throw new Error('Failed to parse STEP file. The file may be corrupted or in an unsupported format.');
        }
        if (!cancelled) setMeshes(result.meshes || []);
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load STEP file.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadStep();
    return () => { cancelled = true; };
  }, [url]);

  // Build ALL geometries from the STEP file (not just first mesh)
  const geometries = useMemo(() => {
    return meshes.map((mesh) => {
      const geom = new BufferGeometry();
      geom.setAttribute('position', new Float32BufferAttribute(mesh.attributes.position.array, 3));
      if (mesh.attributes.normal) {
        geom.setAttribute('normal', new Float32BufferAttribute(mesh.attributes.normal.array, 3));
      } else {
        geom.computeVertexNormals();
      }
      if (mesh.index) {
        geom.setIndex(Array.from(mesh.index.array));
      }
      return geom;
    });
  }, [meshes]);

  if (loading) return (
    <div style={{ padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 500, color: '#374151' }}>Loading STEP file...</div>
      <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>This may take a few moments for large files</div>
    </div>
  );

  if (error) return (
    <div style={{ padding: 32, textAlign: 'center' }}>
      <div style={{ color: '#b91c1c', fontWeight: 600, fontSize: 16 }}>Error loading 3D model</div>
      <div style={{ fontSize: 14, color: '#6b7280', marginTop: 8 }}>{error}</div>
      {error.includes('occt-import-js') && (
        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>
          STEP file support requires the OCCT library. Please try refreshing the page.
        </div>
      )}
    </div>
  );

  if (!geometries.length) return (
    <div style={{ padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 16, color: '#374151' }}>No geometry found in STEP file.</div>
      <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>The file may be empty or contain no 3D geometry</div>
    </div>
  );

  return (
    <ViewerScene>
      {geometries.map((geom, i) => (
        <CADMesh key={i} geometry={geom} />
      ))}
    </ViewerScene>
  );
}

const ThreeDViewerModal: React.FC<ThreeDViewerModalProps> = ({ open, onClose, fileUrl, fileType, fileName }) => {
  const [viewerError, setViewerError] = useState<string | null>(null);

  let content: React.ReactNode = null;

  if (!fileUrl || !fileName) {
    content = (
      <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>
        No file selected.
      </div>
    );
  } else if (viewerError) {
    content = (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ color: '#b91c1c', fontWeight: 600, fontSize: 16 }}>3D Viewer Error</div>
        <div style={{ fontSize: 14, color: '#6b7280', marginTop: 8 }}>{viewerError}</div>
        <button
          onClick={() => setViewerError(null)}
          style={{
            marginTop: 16,
            padding: '8px 20px',
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Try Again
        </button>
      </div>
    );
  } else if (isSTEP(fileName)) {
    // STEP has its own loading flow outside ViewerScene
    content = <StepModelInner url={fileUrl} />;
  } else if (isSTL(fileName)) {
    content = (
      <ViewerScene>
        <STLModel url={fileUrl} />
      </ViewerScene>
    );
  } else if (isOBJ(fileName)) {
    content = (
      <ViewerScene>
        <OBJModel url={fileUrl} />
      </ViewerScene>
    );
  } else if (isGLB(fileName) || isGLTF(fileName)) {
    content = (
      <ViewerScene>
        <GLTFModel url={fileUrl} />
      </ViewerScene>
    );
  } else {
    content = (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 16, color: '#374151' }}>Unsupported 3D file type.</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>
          Supported formats: STL, OBJ, GLB, GLTF, STEP
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>3D Viewer: {fileName}</DialogTitle>
          <DialogDescription>
            Rotate with left-click, zoom with scroll, pan with right-click.
          </DialogDescription>
        </DialogHeader>
        <div style={{ minHeight: 450, minWidth: 400 }}>{content}</div>
      </DialogContent>
    </Dialog>
  );
};

export default ThreeDViewerModal;
