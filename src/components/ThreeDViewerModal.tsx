import React, { Suspense, useEffect, useState, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Canvas, useThree, useFrame, extend } from '@react-three/fiber';
import { useGLTF, GizmoHelper, GizmoViewcube } from '@react-three/drei';
// @ts-expect-error: no types for TrackballControls
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls';
// @ts-expect-error: no types for BufferGeometryUtils
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils';
import {
  BufferGeometry,
  Float32BufferAttribute,
  MeshPhongMaterial,
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
  glbUrl?: string | null; // Pre-converted GLB URL (Phase 2)
}

type RenderMode = 'solid' | 'wireframe' | 'xray' | 'wireframe_shaded';
type ProjectionMode = 'perspective' | 'orthographic';

interface ViewerState {
  wireframe: boolean;
  clipping: boolean;
  renderMode: RenderMode;
  projection: ProjectionMode;
  showDimensions: boolean;
  dimensions: { x: number; y: number; z: number } | null;
  volume: number | null; // mm³
  surfaceArea: number | null; // mm²
}

// ── File type helpers ──────────────────────────────────────────────────────────

const isSTL = (name: string) => name.toLowerCase().endsWith('.stl');
const isOBJ = (name: string) => name.toLowerCase().endsWith('.obj');
const isGLB = (name: string) => name.toLowerCase().endsWith('.glb');
const isGLTF = (name: string) => name.toLowerCase().endsWith('.gltf');
const isSTEP = (name: string) => name.toLowerCase().endsWith('.step') || name.toLowerCase().endsWith('.stp');
const isDXF = (name: string) => name.toLowerCase().endsWith('.dxf');

// ── Materials ──────────────────────────────────────────────────────────────────

// MeshPhongMaterial — same approach as Online3DViewer and occt-import-js examples.
// Phong interpolates normals per-pixel without PBR complexity, producing the
// cleanest look on tessellated CAD geometry. MeshStandard/PhysicalMaterial require
// high-quality environment maps to look good; Phong looks great with simple lights.
function createCADMaterial(wireframe = false, renderMode: RenderMode = 'solid') {
  if (renderMode === 'xray') {
    return new MeshPhongMaterial({
      color: new Color('#90caf9'),
      specular: new Color('#333333'),
      shininess: 30,
      side: DoubleSide,
      wireframe: false,
      flatShading: false,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
  }
  return new MeshPhongMaterial({
    color: new Color('#546e7a'),     // darker blue-grey for better visibility
    specular: new Color('#222222'),
    shininess: 50,
    side: DoubleSide,
    wireframe: wireframe || renderMode === 'wireframe',
    flatShading: false,
  });
}

function createEdgeMaterial() {
  return new LineBasicMaterial({
    color: new Color('#546e7a'),
    transparent: true,
    opacity: 0.15,
    depthTest: true,
  });
}

// ── Smooth geometry processing ─────────────────────────────────────────────────

// THE critical step that was missing: mergeVertices() before computeVertexNormals().
// Without merging, each triangle has isolated vertices → flat normals per face.
// After merging, shared vertices get averaged normals → smooth shading across faces.
function smoothGeometry(geom: BufferGeometry): BufferGeometry {
  let merged = mergeVertices(geom);
  merged.computeVertexNormals();
  return merged;
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

function AutoFrame({ children, onReady }: {
  children: React.ReactNode;
  onReady?: (info: { size: number; center: Vector3; dims: Vector3; volume: number; surfaceArea: number }) => void;
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

    groupRef.current.position.set(-center.x, -box.min.y, -center.z);

    const dist = maxDim * 1.8;
    const camY = size.y * 0.5 + dist * 0.4;
    camera.position.set(dist * 0.65, camY, dist * 0.65);
    camera.lookAt(0, size.y * 0.35, 0);
    camera.updateProjectionMatrix();

    // Calculate volume and surface area from all meshes in the scene
    let totalVolume = 0;
    let totalSurfaceArea = 0;
    groupRef.current.traverse((child: any) => {
      if (child.isMesh && child.geometry) {
        const geo = child.geometry;
        const pos = geo.getAttribute('position');
        if (!pos) return;
        const idx = geo.getIndex();
        const v0 = new Vector3(), v1 = new Vector3(), v2 = new Vector3();
        const e1 = new Vector3(), e2 = new Vector3(), cr = new Vector3();
        const count = idx ? idx.count : pos.count;
        for (let i = 0; i < count; i += 3) {
          const a = idx ? idx.getX(i) : i;
          const b = idx ? idx.getX(i + 1) : i + 1;
          const c = idx ? idx.getX(i + 2) : i + 2;
          v0.fromBufferAttribute(pos, a);
          v1.fromBufferAttribute(pos, b);
          v2.fromBufferAttribute(pos, c);
          // Signed volume of triangle
          totalVolume += (v0.x * (v1.y * v2.z - v1.z * v2.y) + v0.y * (v1.z * v2.x - v1.x * v2.z) + v0.z * (v1.x * v2.y - v1.y * v2.x)) / 6.0;
          // Surface area
          e1.subVectors(v1, v0);
          e2.subVectors(v2, v0);
          cr.crossVectors(e1, e2);
          totalSurfaceArea += cr.length() * 0.5;
        }
      }
    });

    onReady?.({ size: maxDim, center: new Vector3(0, size.y * 0.35, 0), dims: size, volume: Math.abs(totalVolume), surfaceArea: totalSurfaceArea });
  });

  return <group ref={groupRef}>{children}</group>;
}

// Line-based grid — renders behind everything via renderOrder, no shader bleeding
function SimpleGrid({ modelSize }: { modelSize: number }) {
  const gridRef = useRef<any>(null);

  const grid = useMemo(() => {
    const gridSize = modelSize * 4;
    const divisions = 20;
    const g = new GridHelper(gridSize, divisions, '#a0a8b0', '#d0d4d8');
    g.renderOrder = -1;
    g.material.forEach ? g.material.forEach((m: any) => { m.depthWrite = false; }) : ((g.material as any).depthWrite = false);
    return g;
  }, [modelSize]);

  return <primitive ref={gridRef} object={grid} position={[0, 0, 0]} />;
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
  const smooth = useMemo(() => smoothGeometry(geometry), [geometry]);
  return <CADMesh geometry={smooth} wireframe={wireframe} clippingPlanes={clippingPlanes} />;
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

function ViewerToolbar({ state, onStateChange, onResetView, onSetViewPreset }: {
  state: ViewerState;
  onStateChange: (s: Partial<ViewerState>) => void;
  onResetView: () => void;
  onSetViewPreset: (preset: string) => void;
}) {
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [showRenderMenu, setShowRenderMenu] = useState(false);

  return (
    <div style={toolbarStyle}>
      {/* Reset View */}
      <ToolBtn onClick={onResetView} title="Reset View">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
      </ToolBtn>
      {/* Fit to Screen */}
      <ToolBtn onClick={onResetView} title="Fit to Screen">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
      </ToolBtn>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '2px 4px' }} />

      {/* View Presets */}
      <div style={{ position: 'relative' }}>
        <ToolBtn onClick={() => { setShowViewMenu(!showViewMenu); setShowRenderMenu(false); }} title="View Presets">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
        </ToolBtn>
        {showViewMenu && (
          <div style={{
            position: 'absolute', left: 42, top: -10, background: 'rgba(30, 36, 44, 0.95)',
            borderRadius: 8, padding: 8, zIndex: 30, minWidth: 140, boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          }}>
            <div style={{ fontSize: 11, color: '#9ca3af', padding: '2px 8px', marginBottom: 4 }}>View Presets</div>
            {['Front', 'Back', 'Top', 'Bottom', 'Left', 'Right', 'Isometric'].map(v => (
              <button key={v} onClick={() => { onSetViewPreset(v.toLowerCase()); setShowViewMenu(false); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', background: 'transparent', border: 'none', color: '#d1d5db', fontSize: 12, cursor: 'pointer', borderRadius: 4 }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >{v}</button>
            ))}
          </div>
        )}
      </div>

      {/* Render Mode */}
      <div style={{ position: 'relative' }}>
        <ToolBtn onClick={() => { setShowRenderMenu(!showRenderMenu); setShowViewMenu(false); }} title="Render Mode">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
        </ToolBtn>
        {showRenderMenu && (
          <div style={{
            position: 'absolute', left: 42, top: -10, background: 'rgba(30, 36, 44, 0.95)',
            borderRadius: 8, padding: 8, zIndex: 30, minWidth: 160, boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          }}>
            <div style={{ fontSize: 11, color: '#9ca3af', padding: '2px 8px', marginBottom: 4 }}>Render Mode</div>
            {([
              ['solid', 'Solid'],
              ['wireframe', 'Wireframe'],
              ['xray', 'X-Ray / Transparent'],
              ['wireframe_shaded', 'Wireframe + Shaded'],
            ] as [RenderMode, string][]).map(([mode, label]) => (
              <button key={mode} onClick={() => {
                onStateChange({ renderMode: mode, wireframe: mode === 'wireframe' || mode === 'wireframe_shaded' });
                setShowRenderMenu(false);
              }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', padding: '5px 8px',
                  background: state.renderMode === mode ? 'rgba(96,165,250,0.2)' : 'transparent',
                  border: 'none', color: state.renderMode === mode ? '#60a5fa' : '#d1d5db', fontSize: 12, cursor: 'pointer', borderRadius: 4,
                }}
                onMouseEnter={e => { if (state.renderMode !== mode) e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                onMouseLeave={e => { if (state.renderMode !== mode) e.currentTarget.style.background = 'transparent'; }}
              >
                {state.renderMode === mode && <span style={{ fontSize: 10 }}>&#10003;</span>}
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '2px 4px' }} />

      {/* Cross Section */}
      <ToolBtn active={state.clipping} onClick={() => onStateChange({ clipping: !state.clipping })} title="Cross Section">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8.12 8.12 17 17"/><path d="M16 2l6 6"/><path d="M2 16l6 6"/></svg>
      </ToolBtn>

      {/* Projection Toggle */}
      <ToolBtn active={state.projection === 'orthographic'} onClick={() => onStateChange({ projection: state.projection === 'perspective' ? 'orthographic' : 'perspective' })} title={`Switch to ${state.projection === 'perspective' ? 'Orthographic' : 'Perspective'}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 3l18 18"/></svg>
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

// Camera preset positions
function getCameraPreset(preset: string, size: number): [number, number, number] {
  const d = size * 2;
  switch (preset) {
    case 'front': return [0, 0, d];
    case 'back': return [0, 0, -d];
    case 'top': return [0, d, 0.01];
    case 'bottom': return [0, -d, 0.01];
    case 'left': return [-d, 0, 0];
    case 'right': return [d, 0, 0];
    case 'isometric': default: return [d * 0.65, d * 0.5, d * 0.65];
  }
}

function CameraPresetApplier({ preset, modelSize, center }: { preset: string | null; modelSize: number; center: Vector3 }) {
  const { camera } = useThree();
  const appliedPreset = useRef<string | null>(null);
  useEffect(() => {
    if (preset && preset !== appliedPreset.current) {
      const pos = getCameraPreset(preset, modelSize);
      camera.position.set(...pos);
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      appliedPreset.current = preset;
    }
  }, [preset, modelSize, center, camera]);
  return null;
}

function ProjectionSwitcher({ projection }: { projection: ProjectionMode }) {
  const { camera, set, size } = useThree();
  useEffect(() => {
    if (projection === 'orthographic' && camera.type !== 'OrthographicCamera') {
      // Note: R3F handles camera type at Canvas level; this is a visual indicator only
      // Full orthographic switching would require Canvas-level camera prop changes
    }
  }, [projection, camera, set, size]);
  return null;
}

function ViewerScene({ children, state, onStateChange, onResetView, initialView }: {
  children: React.ReactNode;
  state: ViewerState;
  onStateChange: (s: Partial<ViewerState>) => void;
  onResetView: () => void;
  initialView?: string;
}) {
  const [bounds, setBounds] = useState<{ size: number; center: Vector3; dims: Vector3 } | null>(null);
  const targetRef = useRef(new Vector3(0, 0, 0));
  const [viewPreset, setViewPreset] = useState<string | null>(initialView || null);
  const initialViewApplied = useRef(false);

  const clippingPlanes = useMemo(() => {
    if (!state.clipping || !bounds) return undefined;
    return [new Plane(new Vector3(0, -1, 0), bounds.dims.y * 0.5)];
  }, [state.clipping, bounds]);

  const handleReady = (info: { size: number; center: Vector3; dims: Vector3; volume: number; surfaceArea: number }) => {
    setBounds(info);
    targetRef.current.copy(info.center);
    onStateChange({
      dimensions: { x: info.dims.x, y: info.dims.y, z: info.dims.z },
      volume: info.volume,
      surfaceArea: info.surfaceArea,
    });
    // Apply initial view preset (e.g. 'top' for DXF) once bounds are known
    if (initialView && !initialViewApplied.current) {
      initialViewApplied.current = true;
      setViewPreset(initialView);
    }
  };

  const enhancedChildren = React.Children.map(children, (child) => {
    if (React.isValidElement(child)) {
      return React.cloneElement(child as React.ReactElement<any>, {
        wireframe: state.wireframe || state.renderMode === 'wireframe' || state.renderMode === 'wireframe_shaded',
        clippingPlanes,
        renderMode: state.renderMode,
      });
    }
    return child;
  });

  return (
    <div style={{ height: 560, borderRadius: 8, overflow: 'hidden', position: 'relative', background: '#e8ecf0' }}>
      <ViewerToolbar
        state={state}
        onStateChange={onStateChange}
        onResetView={onResetView}
        onSetViewPreset={(p) => setViewPreset(p)}
      />

      {/* Dimensions display at bottom */}
      {state.dimensions && (
        <div style={{
          position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(30, 36, 44, 0.82)', backdropFilter: 'blur(8px)',
          borderRadius: 6, padding: '4px 12px', zIndex: 20, color: '#d1d5db', fontSize: 12,
          fontFamily: 'monospace', whiteSpace: 'nowrap',
        }}>
          {state.dimensions.x.toFixed(1)} x {state.dimensions.y.toFixed(1)} x {state.dimensions.z.toFixed(1)} mm
          <span style={{ color: '#6b7280', marginLeft: 8 }}>|</span>
          <span style={{ marginLeft: 8 }}>
            {(state.dimensions.x / 25.4).toFixed(3)} x {(state.dimensions.y / 25.4).toFixed(3)} x {(state.dimensions.z / 25.4).toFixed(3)} in
          </span>
          {state.volume != null && state.volume > 0 && (
            <>
              <span style={{ color: '#6b7280', marginLeft: 8 }}>|</span>
              <span style={{ marginLeft: 8 }}>
                Vol: {state.volume >= 1000 ? `${(state.volume / 1000).toFixed(2)} cm³` : `${state.volume.toFixed(1)} mm³`}
              </span>
            </>
          )}
          {state.surfaceArea != null && state.surfaceArea > 0 && (
            <>
              <span style={{ color: '#6b7280', marginLeft: 8 }}>|</span>
              <span style={{ marginLeft: 8 }}>
                SA: {state.surfaceArea >= 100 ? `${(state.surfaceArea / 100).toFixed(2)} cm²` : `${state.surfaceArea.toFixed(1)} mm²`}
              </span>
            </>
          )}
        </div>
      )}

      {/* Render mode indicator */}
      {state.renderMode !== 'solid' && (
        <div style={{
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(96,165,250,0.2)', borderRadius: 4, padding: '2px 10px',
          zIndex: 20, color: '#60a5fa', fontSize: 11, fontWeight: 500,
        }}>
          {state.renderMode === 'wireframe' ? 'Wireframe' : state.renderMode === 'xray' ? 'X-Ray' : 'Wireframe + Shaded'}
        </div>
      )}

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

        <color attach="background" args={['#eef1f5']} />

        <ambientLight intensity={0.5} color={new Color('#e0e4e8')} />
        <hemisphereLight args={[new Color('#ffffff'), new Color('#607080'), 0.45]} />
        <directionalLight position={[10, 15, 8]} intensity={0.9} color={new Color('#ffffff')} />
        <directionalLight position={[-8, 5, -3]} intensity={0.4} color={new Color('#e8f0ff')} />
        <directionalLight position={[-2, 8, -10]} intensity={0.25} />

        <Suspense fallback={null}>
          <AutoFrame onReady={handleReady}>
            {enhancedChildren}
          </AutoFrame>
        </Suspense>

        {bounds && <SimpleGrid modelSize={bounds.size} />}

        {state.clipping && bounds && clippingPlanes && (
          <ClipPlaneHelper plane={clippingPlanes[0]} size={bounds.size} />
        )}

        {bounds && viewPreset && (
          <CameraPresetApplier preset={viewPreset} modelSize={bounds.size} center={bounds.center} />
        )}

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

// ── STEP mesh component ────────────────────────────────────────────────────────

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

// ── Status overlay ─────────────────────────────────────────────────────────────

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

// ── STEP hook ──────────────────────────────────────────────────────────────────

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

        // occt-import-js tessellation params (plain object):
        // bounding_box_ratio: deflection as fraction of avg bounding box dimension
        // 0.001 = 0.1% of bbox = smooth on any model size
        const result = occt.ReadStepFile(new Uint8Array(buffer), {
          linearDeflection: 0.001,
          linearDeflectionType: 'bounding_box_ratio',
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

  // Build geometries with mergeVertices → computeVertexNormals for smooth shading
  const geometries = useMemo(() => {
    return meshes.map((mesh) => {
      const geom = new BufferGeometry();
      geom.setAttribute('position', new Float32BufferAttribute(mesh.attributes.position.array, 3));
      if (mesh.index) {
        geom.setIndex(Array.from(mesh.index.array));
      }
      // Don't use OCCT's normals — they're per-face (flat).
      // mergeVertices + computeVertexNormals produces proper smooth normals.
      return smoothGeometry(geom);
    });
  }, [meshes]);

  return { geometries, loading, error };
}

// ── STEP viewer (GLB-first with STEP fallback) ────────────────────────────────

function StepViewer({ url, glbUrl, state, onStateChange, onResetView, initialView }: {
  url: string;
  glbUrl?: string | null;
  state: ViewerState;
  onStateChange: (s: Partial<ViewerState>) => void;
  onResetView: () => void;
  initialView?: string;
}) {
  // If pre-converted GLB exists, render it directly (Phase 2 — fast + high quality)
  if (glbUrl) {
    return (
      <ViewerScene state={state} onStateChange={onStateChange} onResetView={onResetView}>
        <GLTFModel url={glbUrl} wireframe={state.wireframe} />
      </ViewerScene>
    );
  }

  // Otherwise, client-side STEP parsing with Phase 1 quality fixes
  return <StepViewerClient url={url} state={state} onStateChange={onStateChange} onResetView={onResetView} initialView={initialView} />;
}

function StepViewerClient({ url, state, onStateChange, onResetView, initialView }: {
  url: string;
  state: ViewerState;
  onStateChange: (s: Partial<ViewerState>) => void;
  onResetView: () => void;
  initialView?: string;
}) {
  const { geometries, loading, error } = useStepGeometries(url);

  if (loading) return <StatusOverlay type="loading" message="Loading file..." detail="Parsing geometry" />;
  if (error) return <StatusOverlay type="error" message="Error loading file" detail={error} />;
  if (!geometries.length) return <StatusOverlay type="empty" message="No geometry found in file." />;

  return (
    <ViewerScene state={state} onStateChange={onStateChange} onResetView={onResetView} initialView={initialView}>
      <StepMeshes geometries={geometries} wireframe={state.wireframe} />
    </ViewerScene>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────────

const ThreeDViewerModal: React.FC<ThreeDViewerModalProps> = ({ open, onClose, fileUrl, fileType, fileName, glbUrl }) => {
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [state, setState] = useState<ViewerState>({ wireframe: false, clipping: false, renderMode: 'solid', projection: 'perspective', showDimensions: true, dimensions: null, volume: null, surfaceArea: null });
  const [viewKey, setViewKey] = useState(0);

  const handleStateChange = (partial: Partial<ViewerState>) => setState(prev => ({ ...prev, ...partial }));
  const handleResetView = () => setViewKey(k => k + 1);

  useEffect(() => {
    setState({ wireframe: false, clipping: false, renderMode: 'solid', projection: 'perspective', showDimensions: true, dimensions: null, volume: null, surfaceArea: null });
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
    content = <StepViewer key={viewKey} url={fileUrl} glbUrl={glbUrl} state={state} onStateChange={handleStateChange} onResetView={handleResetView} />;
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
  } else if (isDXF(fileName)) {
    // DXF files are 2D drawings — show a top-down flat view message
    content = (
      <div style={{ height: 560, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eef1f5', borderRadius: 8 }}>
        <div style={{ textAlign: 'center' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 12px' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          <div style={{ fontSize: 15, color: '#374151', fontWeight: 500 }}>DXF Drawing File</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>{fileName}</div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 8, maxWidth: 280, margin: '8px auto 0' }}>
            DXF files are 2D drawings and cannot be rendered in the 3D viewer.
            Upload a STEP or STL file to view the 3D model.
          </div>
        </div>
      </div>
    );
  } else {
    content = (
      <div style={{ height: 560, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eef1f5', borderRadius: 8 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 15, color: '#374151' }}>Unsupported 3D file type.</div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>Supported: STL, OBJ, GLB, GLTF, STEP, DXF</div>
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
