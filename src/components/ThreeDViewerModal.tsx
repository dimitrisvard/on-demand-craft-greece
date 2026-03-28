import React, { Suspense, useEffect, useState, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Canvas, useThree, useFrame, extend } from '@react-three/fiber';
import { useGLTF, Environment, ContactShadows, GizmoHelper, GizmoViewcube, Grid } from '@react-three/drei';
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
  Plane,
  DoubleSide,
  FrontSide,
} from 'three';
// @ts-expect-error: no types for OBJLoader
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';
// @ts-expect-error: no types for STLLoader
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
import { useLoader } from '@react-three/fiber';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ThreeDViewerModalProps {
  open: boolean;
  onClose: () => void;
  fileUrl: string | null;
  fileType: string | null;
  fileName: string | null;
}

interface ViewerState {
  wireframe: boolean;
  clipping: boolean;
  projection: 'perspective' | 'orthographic';
}

// ── File type helpers ──────────────────────────────────────────────────────────

const isSTL = (name: string) => name.toLowerCase().endsWith('.stl');
const isOBJ = (name: string) => name.toLowerCase().endsWith('.obj');
const isGLB = (name: string) => name.toLowerCase().endsWith('.glb');
const isGLTF = (name: string) => name.toLowerCase().endsWith('.gltf');
const isSTEP = (name: string) => name.toLowerCase().endsWith('.step') || name.toLowerCase().endsWith('.stp');

// ── Materials ──────────────────────────────────────────────────────────────────

// Machined aluminum — Xometry-style blue-grey with subtle metallic reflectivity
function createCADMaterial(wireframe = false) {
  return new MeshPhysicalMaterial({
    color: new Color('#a8b8c8'),
    metalness: 0.35,
    roughness: 0.55,
    clearcoat: 0.15,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.8,
    side: DoubleSide,
    wireframe,
    flatShading: false,
  });
}

function createEdgeMaterial() {
  return new LineBasicMaterial({
    color: new Color('#4a5568'),
    transparent: true,
    opacity: 0.18,
    depthTest: true,
  });
}

// ── OCCT WASM loader ──────────────────────────────────────────────────────────

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
        const check = setInterval(() => {
          if ((window as any).occtimportjs) { clearInterval(check); resolve((window as any).occtimportjs()); }
        }, 50);
        setTimeout(() => { clearInterval(check); reject(new Error('occt-import-js timeout')); }, 10000);
        return;
      }
      const script = document.createElement('script');
      script.src = '/occt-import-js.js';
      script.onload = () => {
        const check = setInterval(() => {
          if ((window as any).occtimportjs) { clearInterval(check); resolve((window as any).occtimportjs()); }
        }, 50);
        setTimeout(() => { clearInterval(check); reject(new Error('occt-import-js timeout')); }, 10000);
      };
      script.onerror = () => reject(new Error('Failed to load occt-import-js.js'));
      document.body.appendChild(script);
    });
  }
  return occtPromise;
}

// ── Register TrackballControls ─────────────────────────────────────────────────

extend({ TrackballControls });

// ── Scene internals ────────────────────────────────────────────────────────────

// Unrestricted 360° rotation with no gimbal lock
function FreeControls({ targetRef }: { targetRef: React.MutableRefObject<Vector3> }) {
  const { camera, gl } = useThree();
  const controlsRef = useRef<any>(null);

  useEffect(() => {
    const controls = new TrackballControls(camera, gl.domElement);
    controls.rotateSpeed = 2.5;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 0.8;
    controls.dynamicDampingFactor = 0.12;
    controls.noPan = false;
    controls.noZoom = false;
    controls.noRotate = false;
    controls.minDistance = 0.01;
    controls.maxDistance = 50000;
    // Set target to model center
    controls.target.copy(targetRef.current);
    controlsRef.current = controls;
    return () => controls.dispose();
  }, [camera, gl, targetRef]);

  useFrame(() => { controlsRef.current?.update(); });

  return null;
}

// Auto-fit camera to model, bottom-align on grid, report bounds
function AutoFrame({ children, onReady }: {
  children: React.ReactNode;
  onReady?: (info: { size: number; center: Vector3; dims: Vector3 }) => void;
}) {
  const groupRef = useRef<Group>(null);
  const { camera } = useThree();
  const done = useRef(false);

  useFrame(() => {
    if (done.current || !groupRef.current) return;
    const box = new Box3().setFromObject(groupRef.current);
    if (box.isEmpty()) return;
    done.current = true;

    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    // Bottom-align on y=0, center horizontally
    groupRef.current.position.set(-center.x, -box.min.y, -center.z);

    // Isometric-ish default camera — 45° azimuth, 30° elevation
    const dist = maxDim * 1.8;
    const camY = size.y * 0.5 + dist * 0.4;
    camera.position.set(dist * 0.65, camY, dist * 0.65);
    camera.lookAt(0, size.y * 0.35, 0);
    camera.updateProjectionMatrix();

    onReady?.({ size: maxDim, center: new Vector3(0, size.y * 0.35, 0), dims: size });
  });

  return <group ref={groupRef}>{children}</group>;
}

// CAD mesh with optional edge lines and clipping
function CADMesh({ geometry, wireframe, clippingPlanes }: {
  geometry: BufferGeometry;
  wireframe: boolean;
  clippingPlanes?: Plane[];
}) {
  const edges = useMemo(() => new EdgesGeometry(geometry, 15), [geometry]);

  const material = useMemo(() => {
    const mat = createCADMaterial(wireframe);
    if (clippingPlanes?.length) mat.clippingPlanes = clippingPlanes;
    return mat;
  }, [wireframe, clippingPlanes]);

  const edgeMat = useMemo(() => {
    const mat = createEdgeMaterial();
    if (clippingPlanes?.length) mat.clippingPlanes = clippingPlanes;
    return mat;
  }, [clippingPlanes]);

  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
        <primitive object={material} attach="material" />
      </mesh>
      {!wireframe && (
        <lineSegments geometry={edges}>
          <primitive object={edgeMat} attach="material" />
        </lineSegments>
      )}
    </group>
  );
}

function applyCADMaterialToObj(obj: any, wireframe: boolean, clippingPlanes?: Plane[]) {
  obj.traverse((child: any) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      const mat = createCADMaterial(wireframe);
      if (clippingPlanes?.length) mat.clippingPlanes = clippingPlanes;
      child.material = mat;
      if (!wireframe) {
        const edgesGeo = new EdgesGeometry(child.geometry, 15);
        const edgeMat = createEdgeMaterial();
        if (clippingPlanes?.length) edgeMat.clippingPlanes = clippingPlanes;
        child.add(new LineSegments(edgesGeo, edgeMat));
      }
    }
  });
}

// ── Model components ───────────────────────────────────────────────────────────

function STLModel({ url, wireframe, clippingPlanes }: { url: string; wireframe: boolean; clippingPlanes?: Plane[] }) {
  const geometry = useLoader(STLLoader, url);
  geometry.computeVertexNormals();
  return <CADMesh geometry={geometry} wireframe={wireframe} clippingPlanes={clippingPlanes} />;
}

function OBJModel({ url, wireframe, clippingPlanes }: { url: string; wireframe: boolean; clippingPlanes?: Plane[] }) {
  const obj = useLoader(OBJLoader, url);
  useMemo(() => applyCADMaterialToObj(obj, wireframe, clippingPlanes), [obj, wireframe, clippingPlanes]);
  return <primitive object={obj} />;
}

function GLTFModel({ url, wireframe, clippingPlanes }: { url: string; wireframe: boolean; clippingPlanes?: Plane[] }) {
  const { scene } = useGLTF(url);
  useMemo(() => applyCADMaterialToObj(scene, wireframe, clippingPlanes), [scene, wireframe, clippingPlanes]);
  return <primitive object={scene} />;
}

// ── Toolbar ────────────────────────────────────────────────────────────────────

const toolbarStyle: React.CSSProperties = {
  position: 'absolute',
  left: 10,
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  background: 'rgba(30, 36, 44, 0.82)',
  backdropFilter: 'blur(8px)',
  borderRadius: 8,
  padding: '6px 5px',
  zIndex: 20,
  boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
};

const btnStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  borderRadius: 6,
  color: '#d1d5db',
  cursor: 'pointer',
  fontSize: 16,
  transition: 'background 0.15s, color 0.15s',
};

const btnActiveStyle: React.CSSProperties = {
  ...btnStyle,
  background: 'rgba(96, 165, 250, 0.25)',
  color: '#60a5fa',
};

function ViewerToolbar({
  state,
  onToggleWireframe,
  onToggleClipping,
  onToggleProjection,
  onResetView,
  onFitToScreen,
}: {
  state: ViewerState;
  onToggleWireframe: () => void;
  onToggleClipping: () => void;
  onToggleProjection: () => void;
  onResetView: () => void;
  onFitToScreen: () => void;
}) {
  return (
    <div style={toolbarStyle}>
      <button
        style={btnStyle}
        onClick={onResetView}
        title="Reset View"
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
      </button>
      <button
        style={btnStyle}
        onClick={onFitToScreen}
        title="Fit to Screen"
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
      </button>
      <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '2px 4px' }} />
      <button
        style={state.wireframe ? btnActiveStyle : btnStyle}
        onClick={onToggleWireframe}
        title="Toggle Wireframe"
        onMouseEnter={e => { if (!state.wireframe) e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
        onMouseLeave={e => { if (!state.wireframe) e.currentTarget.style.background = 'transparent'; }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>
      </button>
      <button
        style={state.clipping ? btnActiveStyle : btnStyle}
        onClick={onToggleClipping}
        title="Cross Section"
        onMouseEnter={e => { if (!state.clipping) e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
        onMouseLeave={e => { if (!state.clipping) e.currentTarget.style.background = 'transparent'; }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8.12 8.12 17 17"/><path d="M16 2l6 6"/><path d="M2 16l6 6"/></svg>
      </button>
      <button
        style={state.projection === 'orthographic' ? btnActiveStyle : btnStyle}
        onClick={onToggleProjection}
        title={state.projection === 'perspective' ? 'Orthographic View' : 'Perspective View'}
        onMouseEnter={e => { if (state.projection === 'perspective') e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
        onMouseLeave={e => { if (state.projection === 'perspective') e.currentTarget.style.background = 'transparent'; }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05"/><path d="M12 22.08V12"/></svg>
      </button>
    </div>
  );
}

// ── Clipping plane helper ──────────────────────────────────────────────────────

function ClipPlaneHelper({ plane, size }: { plane: Plane; size: number }) {
  return (
    <mesh position={[0, plane.constant * -plane.normal.y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[size * 2, size * 2]} />
      <meshBasicMaterial color="#ef4444" transparent opacity={0.06} side={DoubleSide} depthWrite={false} />
    </mesh>
  );
}

// ── Enable GL clipping ─────────────────────────────────────────────────────────

function EnableClipping({ enabled }: { enabled: boolean }) {
  const { gl } = useThree();
  useEffect(() => { gl.localClippingEnabled = enabled; }, [gl, enabled]);
  return null;
}

// ── Adaptive ground grid ───────────────────────────────────────────────────────

function AdaptiveGrid({ modelSize }: { modelSize: number }) {
  const cellSize = modelSize > 0 ? Math.pow(10, Math.floor(Math.log10(modelSize)) - 1) : 1;
  const sectionSize = cellSize * 5;
  return (
    <Grid
      position={[0, -0.001, 0]}
      args={[200, 200]}
      cellSize={cellSize}
      cellThickness={0.5}
      cellColor="#c8ccd0"
      sectionSize={sectionSize}
      sectionThickness={1}
      sectionColor="#a0a8b0"
      fadeDistance={modelSize * 4}
      fadeStrength={1.2}
      infiniteGrid
    />
  );
}

// ── Main scene wrapper ─────────────────────────────────────────────────────────

function ViewerScene({ children, state, onStateChange, onResetView }: {
  children: React.ReactNode;
  state: ViewerState;
  onStateChange: (s: Partial<ViewerState>) => void;
  onResetView: () => void;
}) {
  const [bounds, setBounds] = useState<{ size: number; center: Vector3; dims: Vector3 } | null>(null);
  const targetRef = useRef(new Vector3(0, 0, 0));

  const clippingPlanes = useMemo(() => {
    if (!state.clipping || !bounds) return undefined;
    return [new Plane(new Vector3(0, -1, 0), bounds.dims.y * 0.5)];
  }, [state.clipping, bounds]);

  const handleReady = (info: { size: number; center: Vector3; dims: Vector3 }) => {
    setBounds(info);
    targetRef.current.copy(info.center);
  };

  // Clone children with wireframe/clipping props
  const enhancedChildren = React.Children.map(children, (child) => {
    if (React.isValidElement(child)) {
      return React.cloneElement(child as React.ReactElement<any>, {
        wireframe: state.wireframe,
        clippingPlanes,
      });
    }
    return child;
  });

  return (
    <div style={{ height: 560, borderRadius: 8, overflow: 'hidden', position: 'relative', background: '#dde0e4' }}>
      {/* Toolbar overlay */}
      <ViewerToolbar
        state={state}
        onToggleWireframe={() => onStateChange({ wireframe: !state.wireframe })}
        onToggleClipping={() => onStateChange({ clipping: !state.clipping })}
        onToggleProjection={() => onStateChange({ projection: state.projection === 'perspective' ? 'orthographic' : 'perspective' })}
        onResetView={onResetView}
        onFitToScreen={onResetView}
      />

      <Canvas
        camera={{ position: [0, 0, 100], fov: 45, near: 0.001, far: 100000 }}
        style={{ height: 560 }}
        dpr={[1.5, 2]}
        shadows
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
          outputColorSpace: 'srgb',
        }}
      >
        <EnableClipping enabled={state.clipping} />

        {/* Gradient-style background — clean light grey */}
        <color attach="background" args={['#e4e7eb']} />

        {/* 3-point lighting + hemisphere fill */}
        <hemisphereLight args={[new Color('#dce4ec'), new Color('#b0a898'), 0.35]} />
        <ambientLight intensity={0.35} />
        {/* Key light — upper-right-front, warm */}
        <directionalLight
          position={[10, 15, 8]}
          intensity={1.1}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-bias={-0.0001}
          shadow-camera-near={0.1}
          shadow-camera-far={500}
          color={new Color('#fff6ee')}
        />
        {/* Fill light — left, cooler */}
        <directionalLight position={[-8, 5, -3]} intensity={0.45} color={new Color('#e4ecf4')} />
        {/* Rim light — behind */}
        <directionalLight position={[-2, -4, -10]} intensity={0.25} color={new Color('#d8e0e8')} />
        {/* Subtle bottom fill */}
        <directionalLight position={[0, -10, 5]} intensity={0.12} />

        {/* Studio HDRI for reflections */}
        <Environment preset="studio" />

        <Suspense fallback={null}>
          <AutoFrame onReady={handleReady}>
            {enhancedChildren}
          </AutoFrame>
        </Suspense>

        {/* Ground grid */}
        {bounds && <AdaptiveGrid modelSize={bounds.size} />}

        {/* Contact shadow */}
        {bounds && (
          <ContactShadows
            position={[0, 0, 0]}
            opacity={0.3}
            scale={bounds.size * 3}
            blur={2}
            far={bounds.size * 0.4}
          />
        )}

        {/* Clipping plane visual */}
        {state.clipping && bounds && clippingPlanes && (
          <ClipPlaneHelper plane={clippingPlanes[0]} size={bounds.size} />
        )}

        {/* NavCube — Xometry-style orientation cube */}
        <GizmoHelper alignment="top-right" margin={[70, 70]}>
          <GizmoViewcube
            color="#e8eaed"
            strokeColor="#9ca3af"
            textColor="#374151"
            opacity={0.92}
            hoverColor="#bfdbfe"
          />
        </GizmoHelper>

        {/* Unrestricted orbit */}
        <FreeControls targetRef={targetRef} />
      </Canvas>
    </div>
  );
}

// ── STEP loader + viewer ───────────────────────────────────────────────────────

function StepModelInner({ url, wireframe, clippingPlanes }: { url: string; wireframe?: boolean; clippingPlanes?: Plane[] }) {
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
        if (!response.ok) throw new Error(`Failed to fetch file: ${response.status}`);
        const buffer = await response.arrayBuffer();

        // Pass tessellation params for higher quality meshing
        const params = new (occt.ReadStepFileParams || Object.constructor)();
        if (params.setLinearDeflection) params.setLinearDeflection(0.1);
        if (params.setAngularDeflection) params.setAngularDeflection(0.5);

        const result = (params.setLinearDeflection)
          ? occt.ReadStepFile(new Uint8Array(buffer), params)
          : occt.ReadStepFile(new Uint8Array(buffer), null);

        if (!result.success) throw new Error('Failed to parse STEP file.');
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
      // Always recompute for smooth shading even if normals exist
      geom.computeVertexNormals();
      return geom;
    });
  }, [meshes]);

  if (loading) return (
    <div style={{ height: 560, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e4e7eb', borderRadius: 8 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, border: '3px solid #d1d5db', borderTopColor: '#6b7280', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
        <div style={{ fontSize: 15, fontWeight: 500, color: '#374151' }}>Loading STEP file...</div>
        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>Parsing geometry</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );

  if (error) return (
    <div style={{ height: 560, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e4e7eb', borderRadius: 8 }}>
      <div style={{ textAlign: 'center', maxWidth: 320 }}>
        <div style={{ color: '#dc2626', fontWeight: 600, fontSize: 15 }}>Error loading 3D model</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>{error}</div>
      </div>
    </div>
  );

  if (!geometries.length) return (
    <div style={{ height: 560, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e4e7eb', borderRadius: 8 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 15, color: '#374151' }}>No geometry found in STEP file.</div>
      </div>
    </div>
  );

  return (
    <>
      {geometries.map((geom, i) => (
        <CADMesh key={i} geometry={geom} wireframe={wireframe || false} clippingPlanes={clippingPlanes} />
      ))}
    </>
  );
}

// ── Wrapper that handles STEP's async loading outside Canvas ───────────────────

function StepViewer({ url, state, onStateChange, onResetView }: {
  url: string;
  state: ViewerState;
  onStateChange: (s: Partial<ViewerState>) => void;
  onResetView: () => void;
}) {
  return (
    <ViewerScene state={state} onStateChange={onStateChange} onResetView={onResetView}>
      <StepModelInner url={url} />
    </ViewerScene>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────────

const ThreeDViewerModal: React.FC<ThreeDViewerModalProps> = ({ open, onClose, fileUrl, fileType, fileName }) => {
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [state, setState] = useState<ViewerState>({ wireframe: false, clipping: false, projection: 'perspective' });
  const [viewKey, setViewKey] = useState(0);

  const handleStateChange = (partial: Partial<ViewerState>) => setState(prev => ({ ...prev, ...partial }));
  const handleResetView = () => setViewKey(k => k + 1);

  // Reset state when file changes
  useEffect(() => {
    setState({ wireframe: false, clipping: false, projection: 'perspective' });
    setViewKey(0);
    setViewerError(null);
  }, [fileUrl]);

  let content: React.ReactNode = null;

  if (!fileUrl || !fileName) {
    content = (
      <div style={{ height: 560, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e4e7eb', borderRadius: 8, color: '#9ca3af' }}>
        No file selected.
      </div>
    );
  } else if (viewerError) {
    content = (
      <div style={{ height: 560, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e4e7eb', borderRadius: 8 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#dc2626', fontWeight: 600 }}>3D Viewer Error</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8, maxWidth: 280 }}>{viewerError}</div>
          <button
            onClick={() => { setViewerError(null); handleResetView(); }}
            style={{
              marginTop: 14, padding: '7px 18px', backgroundColor: '#3b82f6', color: 'white',
              border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 500, fontSize: 13,
            }}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  } else if (isSTEP(fileName)) {
    content = <StepViewer key={viewKey} url={fileUrl} state={state} onStateChange={handleStateChange} onResetView={handleResetView} />;
  } else if (isSTL(fileName)) {
    content = (
      <ViewerScene key={viewKey} state={state} onStateChange={handleStateChange} onResetView={handleResetView}>
        <STLModel url={fileUrl} wireframe={state.wireframe} />
      </ViewerScene>
    );
  } else if (isOBJ(fileName)) {
    content = (
      <ViewerScene key={viewKey} state={state} onStateChange={handleStateChange} onResetView={handleResetView}>
        <OBJModel url={fileUrl} wireframe={state.wireframe} />
      </ViewerScene>
    );
  } else if (isGLB(fileName) || isGLTF(fileName)) {
    content = (
      <ViewerScene key={viewKey} state={state} onStateChange={handleStateChange} onResetView={handleResetView}>
        <GLTFModel url={fileUrl} wireframe={state.wireframe} />
      </ViewerScene>
    );
  } else {
    content = (
      <div style={{ height: 560, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e4e7eb', borderRadius: 8 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 15, color: '#374151' }}>Unsupported 3D file type.</div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>Supported: STL, OBJ, GLB, GLTF, STEP</div>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl" style={{ padding: '16px 16px 12px' }}>
        <DialogHeader style={{ paddingBottom: 6 }}>
          <DialogTitle style={{ fontSize: 15 }}>{fileName}</DialogTitle>
          <DialogDescription style={{ fontSize: 12, color: '#9ca3af' }}>
            Left-click drag to rotate freely, scroll to zoom, right-click drag to pan.
          </DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
};

export default ThreeDViewerModal;
