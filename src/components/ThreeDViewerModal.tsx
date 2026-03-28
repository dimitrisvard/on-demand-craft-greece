import React, { Suspense, useEffect, useState, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Canvas, useThree, useFrame, extend } from '@react-three/fiber';
import { useGLTF, Environment, GizmoHelper, GizmoViewcube } from '@react-three/drei';
// @ts-expect-error: no types for TrackballControls
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls';
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
  Plane,
  DoubleSide,
  GridHelper,
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
}

// ── File type helpers ──────────────────────────────────────────────────────────

const isSTL = (name: string) => name.toLowerCase().endsWith('.stl');
const isOBJ = (name: string) => name.toLowerCase().endsWith('.obj');
const isGLB = (name: string) => name.toLowerCase().endsWith('.glb');
const isGLTF = (name: string) => name.toLowerCase().endsWith('.gltf');
const isSTEP = (name: string) => name.toLowerCase().endsWith('.step') || name.toLowerCase().endsWith('.stp');

// ── Materials ──────────────────────────────────────────────────────────────────

// MeshStandardMaterial — proven combo for CAD. Same approach as Online3DViewer.
// MeshPhysicalMaterial was causing visual artifacts on low-poly OCCT tessellation.
function createCADMaterial(wireframe = false) {
  return new MeshStandardMaterial({
    color: new Color('#b0bec5'),    // machined aluminum blue-grey
    metalness: 0.3,
    roughness: 0.55,
    envMapIntensity: 1.0,
    side: DoubleSide,
    wireframe,
    flatShading: false,
  });
}

function createEdgeMaterial() {
  return new LineBasicMaterial({
    color: new Color('#546e7a'),
    transparent: true,
    opacity: 0.2,
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
    controls.target.copy(targetRef.current);
    controlsRef.current = controls;
    return () => controls.dispose();
  }, [camera, gl, targetRef]);

  useFrame(() => { controlsRef.current?.update(); });
  return null;
}

// Auto-fit camera to model, bottom-align on grid
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

    // Isometric default camera
    const dist = maxDim * 1.8;
    const camY = size.y * 0.5 + dist * 0.4;
    camera.position.set(dist * 0.65, camY, dist * 0.65);
    camera.lookAt(0, size.y * 0.35, 0);
    camera.updateProjectionMatrix();

    onReady?.({ size: maxDim, center: new Vector3(0, size.y * 0.35, 0), dims: size });
  });

  return <group ref={groupRef}>{children}</group>;
}

// THREE.GridHelper — simple line-based grid that renders behind everything.
// Replaces drei <Grid> which uses a custom shader that bleeds through model surfaces.
function SimpleGrid({ modelSize }: { modelSize: number }) {
  const ref = useRef<any>(null);

  useEffect(() => {
    if (!ref.current) return;
    // Push grid to render first (behind everything)
    ref.current.renderOrder = -1;
    ref.current.material.depthWrite = false;
  }, []);

  const gridSize = modelSize * 4;
  const divisions = 20;

  return (
    <primitive
      ref={ref}
      object={new GridHelper(gridSize, divisions, '#a0a8b0', '#c8ccd0')}
      position={[0, 0, 0]}
    />
  );
}

// CAD mesh with edge lines
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
      <mesh geometry={geometry}>
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

const btnBase: React.CSSProperties = {
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
};

function ToolBtn({ active, onClick, title, children }: {
  active?: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      style={{ ...btnBase, ...(active ? { background: 'rgba(96,165,250,0.25)', color: '#60a5fa' } : {}) }}
      onClick={onClick}
      title={title}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}

function ViewerToolbar({ state, onToggleWireframe, onToggleClipping, onResetView }: {
  state: ViewerState;
  onToggleWireframe: () => void;
  onToggleClipping: () => void;
  onResetView: () => void;
}) {
  return (
    <div style={toolbarStyle}>
      <ToolBtn onClick={onResetView} title="Reset View">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
      </ToolBtn>
      <ToolBtn onClick={onResetView} title="Fit to Screen">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
      </ToolBtn>
      <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '2px 4px' }} />
      <ToolBtn active={state.wireframe} onClick={onToggleWireframe} title="Toggle Wireframe">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>
      </ToolBtn>
      <ToolBtn active={state.clipping} onClick={onToggleClipping} title="Cross Section">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8.12 8.12 17 17"/><path d="M16 2l6 6"/><path d="M2 16l6 6"/></svg>
      </ToolBtn>
    </div>
  );
}

// ── Clipping ───────────────────────────────────────────────────────────────────

function ClipPlaneHelper({ plane, size }: { plane: Plane; size: number }) {
  return (
    <mesh position={[0, plane.constant * -plane.normal.y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[size * 2, size * 2]} />
      <meshBasicMaterial color="#ef4444" transparent opacity={0.06} side={DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function EnableClipping({ enabled }: { enabled: boolean }) {
  const { gl } = useThree();
  useEffect(() => { gl.localClippingEnabled = enabled; }, [gl, enabled]);
  return null;
}

// ── Main scene ─────────────────────────────────────────────────────────────────

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
    <div style={{ height: 560, borderRadius: 8, overflow: 'hidden', position: 'relative', background: '#e8ecf0' }}>
      <ViewerToolbar
        state={state}
        onToggleWireframe={() => onStateChange({ wireframe: !state.wireframe })}
        onToggleClipping={() => onStateChange({ clipping: !state.clipping })}
        onResetView={onResetView}
      />

      <Canvas
        camera={{ position: [0, 0, 100], fov: 45, near: 0.001, far: 100000 }}
        style={{ height: 560 }}
        dpr={[1.5, 2]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
          outputColorSpace: 'srgb',
        }}
      >
        <EnableClipping enabled={state.clipping} />

        {/* Clean gradient-style background */}
        <color attach="background" args={['#eef1f5']} />

        {/* Hemisphere for natural sky/ground fill */}
        <hemisphereLight args={[new Color('#ffffff'), new Color('#8090a0'), 0.6]} />
        <ambientLight intensity={0.4} />

        {/* Key light — upper-right-front, slightly warm */}
        <directionalLight position={[10, 15, 8]} intensity={1.0} color={new Color('#fffaf5')} />
        {/* Fill light — left, cool */}
        <directionalLight position={[-8, 5, -3]} intensity={0.4} color={new Color('#e8f0f8')} />
        {/* Rim light — behind and above */}
        <directionalLight position={[-2, 8, -10]} intensity={0.3} />
        {/* Bottom fill */}
        <directionalLight position={[0, -8, 5]} intensity={0.15} />

        {/* Environment map for PBR reflections — critical for MeshStandardMaterial */}
        <Environment preset="city" />

        <Suspense fallback={null}>
          <AutoFrame onReady={handleReady}>
            {enhancedChildren}
          </AutoFrame>
        </Suspense>

        {/* Simple line-based grid — renders behind everything, no shader bleeding */}
        {bounds && <SimpleGrid modelSize={bounds.size} />}

        {/* Clipping plane visual */}
        {state.clipping && bounds && clippingPlanes && (
          <ClipPlaneHelper plane={clippingPlanes[0]} size={bounds.size} />
        )}

        {/* NavCube */}
        <GizmoHelper alignment="top-right" margin={[70, 70]}>
          <GizmoViewcube
            color="#e8eaed"
            strokeColor="#9ca3af"
            textColor="#374151"
            opacity={0.92}
            hoverColor="#bfdbfe"
          />
        </GizmoHelper>

        <FreeControls targetRef={targetRef} />
      </Canvas>
    </div>
  );
}

// ── STEP mesh component (Canvas-safe) ──────────────────────────────────────────

function StepMeshes({ geometries, wireframe, clippingPlanes }: {
  geometries: BufferGeometry[];
  wireframe: boolean;
  clippingPlanes?: Plane[];
}) {
  return (
    <>
      {geometries.map((geom, i) => (
        <CADMesh key={i} geometry={geom} wireframe={wireframe} clippingPlanes={clippingPlanes} />
      ))}
    </>
  );
}

// ── Status overlay (plain HTML, outside Canvas) ────────────────────────────────

function StatusOverlay({ type, message, detail }: { type: 'loading' | 'error' | 'empty'; message: string; detail?: string }) {
  return (
    <div style={{ height: 560, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eef1f5', borderRadius: 8 }}>
      <div style={{ textAlign: 'center', maxWidth: 320 }}>
        {type === 'loading' && (
          <div style={{
            width: 36, height: 36,
            border: '3px solid #d1d5db', borderTopColor: '#6b7280',
            borderRadius: '50%',
            margin: '0 auto 14px',
            animation: 'viewer-spin 0.8s linear infinite',
          }} />
        )}
        <div style={{
          fontSize: 14,
          fontWeight: type === 'error' ? 600 : 500,
          color: type === 'error' ? '#dc2626' : '#374151',
        }}>
          {message}
        </div>
        {detail && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>{detail}</div>}
        <style>{`@keyframes viewer-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

// ── STEP hook + viewer ─────────────────────────────────────────────────────────

function useStepGeometries(url: string) {
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

        // occt-import-js accepts a plain object for tessellation params:
        //   linearDeflection: smaller = smoother mesh (default ~0.5 of bbox)
        //   linearDeflectionType: "absolute_value" for direct control
        //   angularDeflection: in radians, smaller = smoother curves
        const result = occt.ReadStepFile(new Uint8Array(buffer), {
          linearDeflection: 0.1,
          linearDeflectionType: 'absolute_value',
          angularDeflection: 0.3,
        });

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
      }
      if (mesh.index) {
        geom.setIndex(Array.from(mesh.index.array));
      }
      // Recompute smooth normals — critical for non-faceted appearance
      geom.computeVertexNormals();
      return geom;
    });
  }, [meshes]);

  return { geometries, loading, error };
}

function StepViewer({ url, state, onStateChange, onResetView }: {
  url: string;
  state: ViewerState;
  onStateChange: (s: Partial<ViewerState>) => void;
  onResetView: () => void;
}) {
  const { geometries, loading, error } = useStepGeometries(url);

  if (loading) return <StatusOverlay type="loading" message="Loading STEP file..." detail="Parsing geometry" />;
  if (error) return <StatusOverlay type="error" message="Error loading 3D model" detail={error} />;
  if (!geometries.length) return <StatusOverlay type="empty" message="No geometry found in STEP file." />;

  return (
    <ViewerScene state={state} onStateChange={onStateChange} onResetView={onResetView}>
      <StepMeshes geometries={geometries} wireframe={state.wireframe} />
    </ViewerScene>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────────

const ThreeDViewerModal: React.FC<ThreeDViewerModalProps> = ({ open, onClose, fileUrl, fileType, fileName }) => {
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [state, setState] = useState<ViewerState>({ wireframe: false, clipping: false });
  const [viewKey, setViewKey] = useState(0);

  const handleStateChange = (partial: Partial<ViewerState>) => setState(prev => ({ ...prev, ...partial }));
  const handleResetView = () => setViewKey(k => k + 1);

  useEffect(() => {
    setState({ wireframe: false, clipping: false });
    setViewKey(0);
    setViewerError(null);
  }, [fileUrl]);

  let content: React.ReactNode = null;

  if (!fileUrl || !fileName) {
    content = (
      <div style={{ height: 560, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eef1f5', borderRadius: 8, color: '#9ca3af' }}>
        No file selected.
      </div>
    );
  } else if (viewerError) {
    content = (
      <div style={{ height: 560, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eef1f5', borderRadius: 8 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#dc2626', fontWeight: 600 }}>3D Viewer Error</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8, maxWidth: 280 }}>{viewerError}</div>
          <button
            onClick={() => { setViewerError(null); handleResetView(); }}
            style={{ marginTop: 14, padding: '7px 18px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 500, fontSize: 13 }}
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
      <div style={{ height: 560, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eef1f5', borderRadius: 8 }}>
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
            Left-click drag to rotate, scroll to zoom, right-click drag to pan.
          </DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
};

export default ThreeDViewerModal;
