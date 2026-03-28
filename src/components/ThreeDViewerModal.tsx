import React, { Suspense, useEffect, useState, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Canvas, useThree, useFrame, extend } from '@react-three/fiber';
import { useGLTF, Environment, ContactShadows, GizmoHelper, GizmoViewport, Grid } from '@react-three/drei';
// @ts-expect-error: no types for TrackballControls
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls';
import {
  BufferGeometry,
  Float32BufferAttribute,
  MeshPhysicalMaterial,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Vector3,
  Box3,
  Color,
  ACESFilmicToneMapping,
  Group,
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

// HOOPS-style material — darker steel/gunmetal with clearcoat for that polished CAD look
function createCADMaterial() {
  return new MeshPhysicalMaterial({
    color: new Color('#5A6E7F'),
    metalness: 0.25,
    roughness: 0.35,
    clearcoat: 0.3,
    clearcoatRoughness: 0.2,
    envMapIntensity: 0.8,
    side: 2, // DoubleSide
  });
}

// Sharper edge lines — HOOPS uses prominent dark edges
function createEdgeMaterial() {
  return new LineBasicMaterial({
    color: new Color('#1A2A3A'),
    linewidth: 1,
    transparent: true,
    opacity: 0.4,
  });
}

// Register TrackballControls for R3F
extend({ TrackballControls });

// Auto-fit camera + bottom-align model on grid plane
function AutoFrame({ children, onBoundsReady }: { children: React.ReactNode; onBoundsReady?: (size: number) => void }) {
  const groupRef = useRef<Group>(null);
  const { camera } = useThree();
  const hasFramed = useRef(false);

  useFrame(() => {
    if (hasFramed.current || !groupRef.current) return;
    const box = new Box3().setFromObject(groupRef.current);
    if (box.isEmpty()) return;

    hasFramed.current = true;
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    // Shift model so its bottom sits on y=0 (the grid plane)
    groupRef.current.position.y -= box.min.y;
    // Center horizontally
    groupRef.current.position.x -= center.x;
    groupRef.current.position.z -= center.z;

    // Position camera — elevated isometric view
    const distance = maxDim * 2.0;
    const modelCenterY = size.y / 2;
    camera.position.set(
      distance * 0.6,
      modelCenterY + distance * 0.45,
      distance * 0.6
    );
    camera.lookAt(0, modelCenterY, 0);
    camera.updateProjectionMatrix();

    onBoundsReady?.(maxDim);
  });

  return <group ref={groupRef}>{children}</group>;
}

// R3F-compatible TrackballControls — true unrestricted 360° rotation
function FreeControls() {
  const { camera, gl } = useThree();
  const controlsRef = useRef<any>(null);

  useEffect(() => {
    const controls = new TrackballControls(camera, gl.domElement);
    controls.rotateSpeed = 3.0;
    controls.zoomSpeed = 1.5;
    controls.panSpeed = 1.0;
    controls.dynamicDampingFactor = 0.15;
    controls.noPan = false;
    controls.noZoom = false;
    controls.noRotate = false;
    controls.minDistance = 0.1;
    controls.maxDistance = 10000;
    controlsRef.current = controls;

    return () => controls.dispose();
  }, [camera, gl]);

  useFrame(() => {
    controlsRef.current?.update();
  });

  return null;
}

// Mesh with edge lines for crisp CAD look
function CADMesh({ geometry }: { geometry: BufferGeometry }) {
  const edges = useMemo(() => new EdgesGeometry(geometry, 12), [geometry]);

  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
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

// Adaptive grid that scales to model size
function AdaptiveGrid({ modelSize }: { modelSize: number }) {
  const cellSize = modelSize > 0 ? Math.pow(10, Math.floor(Math.log10(modelSize)) - 1) : 1;
  const sectionSize = cellSize * 5;
  const fadeDistance = modelSize * 3;

  return (
    <Grid
      position={[0, 0, 0]}
      args={[200, 200]}
      cellSize={cellSize}
      cellThickness={0.6}
      cellColor="#b8bcc0"
      sectionSize={sectionSize}
      sectionThickness={1.2}
      sectionColor="#909498"
      fadeDistance={fadeDistance}
      fadeStrength={1}
      infiniteGrid
    />
  );
}

// HOOPS-style scene: studio lighting, ground grid, orientation gizmo, free rotation
function ViewerScene({ children }: { children: React.ReactNode }) {
  const [modelSize, setModelSize] = useState(10);

  return (
    <div style={{ height: 500, borderRadius: '8px', overflow: 'hidden', position: 'relative' }}>
      <Canvas
        camera={{ position: [0, 0, 100], fov: 45, near: 0.001, far: 100000 }}
        style={{ height: 500 }}
        dpr={[1, 2]}
        shadows
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
          outputColorSpace: 'srgb',
          pixelRatio: window.devicePixelRatio,
        }}
      >
        {/* HOOPS-style background — light warm gray */}
        <color attach="background" args={['#e8eaed']} />

        {/* Studio lighting setup matching HOOPS Communicator */}
        <hemisphereLight
          args={[new Color('#c4d4e0'), new Color('#a09890'), 0.4]}
        />
        <ambientLight intensity={0.25} />
        {/* Key light — top-right, warm */}
        <directionalLight
          position={[8, 12, 6]}
          intensity={1.2}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-bias={-0.0001}
          shadow-camera-near={0.1}
          shadow-camera-far={1000}
          color={new Color('#fff8f0')}
        />
        {/* Fill light — left side, cool */}
        <directionalLight
          position={[-6, 4, -4]}
          intensity={0.5}
          color={new Color('#e0e8f0')}
        />
        {/* Rim/back light — behind and below */}
        <directionalLight
          position={[0, -3, -8]}
          intensity={0.3}
          color={new Color('#d0d8e0')}
        />
        {/* Bottom fill to reduce harsh shadows underneath */}
        <directionalLight
          position={[0, -8, 4]}
          intensity={0.15}
        />

        {/* HDRI environment for realistic reflections */}
        <Environment preset="studio" />

        <Suspense fallback={null}>
          <AutoFrame onBoundsReady={setModelSize}>
            {children}
          </AutoFrame>
        </Suspense>

        {/* Ground grid — adapts to model scale */}
        <AdaptiveGrid modelSize={modelSize} />

        {/* Contact shadow for grounding */}
        <ContactShadows
          position={[0, 0, 0]}
          opacity={0.35}
          scale={modelSize * 4}
          blur={2.5}
          far={modelSize * 0.5}
        />

        {/* HOOPS-style orientation gizmo (ViewCube equivalent) */}
        <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
          <GizmoViewport
            axisColors={['#e74c3c', '#2ecc71', '#3498db']}
            labelColor="white"
          />
        </GizmoHelper>

        {/* TrackballControls — true unrestricted 360° rotation, no gimbal lock */}
        <FreeControls />
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
      const edgesGeo = new EdgesGeometry(child.geometry, 12);
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
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{fileName}</DialogTitle>
          <DialogDescription>
            Left-click to rotate, scroll to zoom, right-click to pan. Use the orientation gizmo to snap views.
          </DialogDescription>
        </DialogHeader>
        <div style={{ minHeight: 500, minWidth: 400 }}>{content}</div>
      </DialogContent>
    </Dialog>
  );
};

export default ThreeDViewerModal;
