import React, { Suspense, useEffect, useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import { BufferGeometry, Float32BufferAttribute, ShaderMaterial, Vector3, Color, NoToneMapping } from 'three';
// @ts-expect-error: no types for OBJLoader
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';
// @ts-expect-error: no types for STLLoader
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';

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

// Toon material color palette (darkest to lightest)
const TOON_COLORS = [
  new Color('#1E1E1E'), // Darkest
  new Color('#3A3A3A'), // Dark
  new Color('#6E6E6E'), // Medium
  new Color('#B0B0B0'), // Light
  new Color('#FFFFFF')  // Lightest
];

// Toon material vertex shader
const toonVertexShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Toon material fragment shader
const toonFragmentShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  
  uniform vec3 uColors[5];
  uniform float uThresholds[4];
  
  void main() {
    // Calculate lighting based on normal direction (object-space)
    float intensity = dot(normalize(vNormal), vec3(0.0, 1.0, 0.0));
    
    // Quantize to discrete bands
    vec3 color;
    if (intensity < uThresholds[0]) {
      color = uColors[0]; // Darkest
    } else if (intensity < uThresholds[1]) {
      color = uColors[1]; // Dark
    } else if (intensity < uThresholds[2]) {
      color = uColors[2]; // Medium
    } else if (intensity < uThresholds[3]) {
      color = uColors[3]; // Light
    } else {
      color = uColors[4]; // Lightest
    }
    
    gl_FragColor = vec4(color, 1.0);
  }
`;

// Create toon material
function createToonMaterial() {
  const material = new ShaderMaterial({
    vertexShader: toonVertexShader,
    fragmentShader: toonFragmentShader,
    uniforms: {
      uColors: { value: TOON_COLORS },
      uThresholds: { value: [-0.5, -0.1, 0.1, 0.5] }
    },
    transparent: false,
    side: 2, // DoubleSide
  });
  
  return material;
}

// Helper to load occt-import-js WASM only once
let occtPromise: Promise<any> | null = null;
function loadOcct() {
  if (!occtPromise) {
    occtPromise = new Promise((resolve, reject) => {
      // Check if already loaded
      if ((window as any).occtimportjs) {
        resolve((window as any).occtimportjs());
        return;
      }
      
      // Check if script is already loaded
      const existingScript = document.querySelector('script[src="/occt-import-js.js"]');
      if (existingScript) {
        // Wait for the script to initialize
        const checkInterval = setInterval(() => {
          if ((window as any).occtimportjs) {
            clearInterval(checkInterval);
            resolve((window as any).occtimportjs());
          }
        }, 50);
        
        // Timeout after 5 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
          reject(new Error('occt-import-js failed to initialize after timeout'));
        }, 5000);
        return;
      }
      
      const script = document.createElement('script');
      script.src = '/occt-import-js.js';
      script.onload = () => {
        // Wait for the script to initialize
        const checkInterval = setInterval(() => {
          if ((window as any).occtimportjs) {
            clearInterval(checkInterval);
            resolve((window as any).occtimportjs());
          }
        }, 50);
        
        // Timeout after 5 seconds
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

function STLModel({ url }: { url: string }) {
  try {
    const geometry = useLoader(STLLoader, url);
    return (
      <mesh geometry={geometry} castShadow receiveShadow>
        <primitive object={createToonMaterial()} attach="material" />
      </mesh>
    );
  } catch (error) {
    console.error('Error loading STL model:', error);
    return (
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <primitive object={createToonMaterial()} attach="material" />
      </mesh>
    );
  }
}

function OBJModel({ url }: { url: string }) {
  try {
    const obj = useLoader(OBJLoader, url);
    // Apply toon materials to all meshes in the OBJ
    obj.traverse((child: any) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          child.material = createToonMaterial();
        }
      }
    });
    return <primitive object={obj} />;
  } catch (error) {
    console.error('Error loading OBJ model:', error);
    return (
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <primitive object={createToonMaterial()} attach="material" />
      </mesh>
    );
  }
}

function GLTFModel({ url }: { url: string }) {
  try {
    const { scene } = useGLTF(url);
    // Apply toon materials to all meshes in the GLTF
    scene.traverse((child: any) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          child.material = createToonMaterial();
        }
      }
    });
    return <primitive object={scene} />;
  } catch (error) {
    console.error('Error loading GLTF model:', error);
    return (
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <primitive object={createToonMaterial()} attach="material" />
      </mesh>
    );
  }
}

function StepModel({ url }: { url: string }) {
  const [meshes, setMeshes] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Convert mesh data to three.js BufferGeometry - moved to top to follow Rules of Hooks
  const mesh = meshes[0];
  const geometry = React.useMemo(() => {
    if (!mesh) return null;
    
    const geom = new BufferGeometry();
    geom.setAttribute('position', new Float32BufferAttribute(mesh.attributes.position.array, 3));
    if (mesh.attributes.normal) {
      geom.setAttribute('normal', new Float32BufferAttribute(mesh.attributes.normal.array, 3));
    }
    if (mesh.index) {
      geom.setIndex(mesh.index.array);
    }
    return geom;
  }, [mesh]);

  useEffect(() => {
    let cancelled = false;
    async function loadStep() {
      setLoading(true);
      setError(null);
      try {
        console.log('Loading OCCT library...');
        const occt = await loadOcct();
        console.log('OCCT library loaded, fetching STEP file...');
        
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
        }
        
        const buffer = await response.arrayBuffer();
        const fileBuffer = new Uint8Array(buffer);
        console.log('Parsing STEP file...');
        
        const result = occt.ReadStepFile(fileBuffer, null);
        if (!result.success) {
          throw new Error('Failed to parse STEP file. The file may be corrupted or in an unsupported format.');
        }
        
        console.log('STEP file parsed successfully, meshes:', result.meshes?.length || 0);
        setMeshes(result.meshes || []);
      } catch (e: any) {
        console.error('Error loading STEP file:', e);
        if (!cancelled) {
          setError(e.message || 'Failed to load STEP file. Please check the file format and try again.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadStep();
    return () => { cancelled = true; };
  }, [url]);

  if (loading) return (
    <div style={{padding: 24, textAlign: 'center'}}>
      <div>Loading STEP file...</div>
      <div style={{fontSize: 12, color: '#666', marginTop: 8}}>This may take a few moments for large files</div>
    </div>
  );
  
  if (error) return (
    <div style={{padding: 24, color: '#b91c1c', fontWeight: 500, fontSize: 16, textAlign: 'center'}}>
      <div>Error loading 3D model</div>
      <div style={{fontSize: 14, fontWeight: 400, marginTop: 8}}>{error}</div>
      {error.includes('occt-import-js') && (
        <div style={{fontSize: 12, color: '#666', marginTop: 8}}>
          STEP file support requires the OCCT library. Please try refreshing the page.
        </div>
      )}
    </div>
  );
  
  if (!meshes.length) return (
    <div style={{padding: 24, textAlign: 'center'}}>
      <div>No geometry found in STEP file.</div>
      <div style={{fontSize: 12, color: '#666', marginTop: 8}}>The file may be empty or contain no 3D geometry</div>
    </div>
  );

  return (
    <Canvas 
      camera={{ position: [0, 0, 100], fov: 50 }} 
      style={{ height: 400, background: '#ffffff' }}
      shadows
      gl={{ 
        antialias: true, 
        alpha: false,
        powerPreference: "high-performance"
      }}
    >
      <BackgroundColor />
      {/* Flat, uniform lighting for matte finish */}
      <ambientLight intensity={0.8} />
      <directionalLight 
        position={[0, 1, 0]} 
        intensity={0.3} 
        castShadow={false}
      />
      
      <Suspense fallback={null}>
        {geometry && <mesh geometry={geometry} castShadow receiveShadow>
          <primitive object={createToonMaterial()} attach="material" />
        </mesh>}
      </Suspense>
      

      
      <OrbitControls 
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={1}
        maxDistance={500}
        enableDamping={true}
        dampingFactor={0.05}
        rotateSpeed={0.8}
        zoomSpeed={0.8}
        panSpeed={0.8}
      />
    </Canvas>
  );
}

// Component to set background color
function BackgroundColor() {
  const { gl } = useThree();
  
  useEffect(() => {
    gl.setClearColor('#ffffff', 1);
  }, [gl]);
  
  return null;
}

const ThreeDViewerModal: React.FC<ThreeDViewerModalProps> = ({ open, onClose, fileUrl, fileType, fileName }) => {
  const [viewerError, setViewerError] = useState<string | null>(null);

  let content: React.ReactNode = null;
  
  if (!fileUrl || !fileName) {
    content = (
      <div style={{padding: 24, textAlign: 'center'}}>
        <div>No file selected.</div>
      </div>
    );
  } else if (viewerError) {
    content = (
      <div style={{padding: 24, textAlign: 'center'}}>
        <div style={{color: '#b91c1c', fontWeight: 500, fontSize: 16}}>3D Viewer Error</div>
        <div style={{fontSize: 14, marginTop: 8}}>{viewerError}</div>
        <button 
          onClick={() => setViewerError(null)}
          style={{
            marginTop: 16,
            padding: '8px 16px',
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Try Again
        </button>
      </div>
    );
  } else if (isSTL(fileName)) {
    content = (
      <div style={{ height: 400, background: '#ffffff', borderRadius: '8px', overflow: 'hidden' }}>
        <Canvas 
          camera={{ position: [0, 0, 100], fov: 50 }} 
          style={{ height: 400, background: '#ffffff' }}
          shadows={false}
          gl={{ 
            antialias: true, 
            alpha: false,
            powerPreference: "high-performance",
            toneMapping: NoToneMapping,
            outputColorSpace: 'srgb'
          }}
          onError={(error) => {
            console.error('Canvas error:', error);
            setViewerError('Failed to initialize 3D viewer');
          }}
        >
          <BackgroundColor />
          {/* No lighting needed for unlit toon material */}
          <Suspense fallback={
            <div style={{padding: 24, textAlign: 'center'}}>Loading 3D model...</div>
          }>
            <STLModel url={fileUrl} />
          </Suspense>
          
          <OrbitControls 
            enablePan={true}
            enableZoom={true}
            enableRotate={true}
            minDistance={1}
            maxDistance={500}
            enableDamping={true}
            dampingFactor={0.05}
            rotateSpeed={0.8}
            zoomSpeed={0.8}
            panSpeed={0.8}
          />
        </Canvas>
      </div>
    );
  } else if (isOBJ(fileName)) {
    content = (
      <div style={{ height: 400, background: '#ffffff', borderRadius: '8px', overflow: 'hidden' }}>
        <Canvas 
          camera={{ position: [0, 0, 100], fov: 50 }} 
          style={{ height: 400, background: '#ffffff' }}
          shadows={false}
          gl={{ 
            antialias: true, 
            alpha: false,
            powerPreference: "high-performance",
            toneMapping: NoToneMapping,
            outputColorSpace: 'srgb'
          }}
          onError={(error) => {
            console.error('Canvas error:', error);
            setViewerError('Failed to initialize 3D viewer');
          }}
        >
          <BackgroundColor />
          {/* No lighting needed for unlit toon material */}
          <Suspense fallback={
            <div style={{padding: 24, textAlign: 'center'}}>Loading 3D model...</div>
          }>
            <OBJModel url={fileUrl} />
          </Suspense>
          
          <OrbitControls 
            enablePan={true}
            enableZoom={true}
            enableRotate={true}
            minDistance={1}
            maxDistance={500}
            enableDamping={true}
            dampingFactor={0.05}
            rotateSpeed={0.8}
            zoomSpeed={0.8}
            panSpeed={0.8}
          />
        </Canvas>
      </div>
    );
  } else if (isGLB(fileName) || isGLTF(fileName)) {
    content = (
      <div style={{ height: 400, background: '#ffffff', borderRadius: '8px', overflow: 'hidden' }}>
        <Canvas 
          camera={{ position: [0, 0, 100], fov: 50 }} 
          style={{ height: 400, background: '#ffffff' }}
          shadows={false}
          gl={{ 
            antialias: true, 
            alpha: false,
            powerPreference: "high-performance",
            toneMapping: NoToneMapping,
            outputColorSpace: 'srgb'
          }}
          onError={(error) => {
            console.error('Canvas error:', error);
            setViewerError('Failed to initialize 3D viewer');
          }}
        >
          <BackgroundColor />
          {/* No lighting needed for unlit toon material */}
          <Suspense fallback={
            <div style={{padding: 24, textAlign: 'center'}}>Loading 3D model...</div>
          }>
            <GLTFModel url={fileUrl} />
          </Suspense>
          
          <OrbitControls 
            enablePan={true}
            enableZoom={true}
            enableRotate={true}
            minDistance={1}
            maxDistance={500}
            enableDamping={true}
            dampingFactor={0.05}
            rotateSpeed={0.8}
            zoomSpeed={0.8}
            panSpeed={0.8}
          />
        </Canvas>
      </div>
    );
  } else if (isSTEP(fileName)) {
    content = <StepModel url={fileUrl} />;
  } else {
    content = (
      <div style={{padding: 24, textAlign: 'center'}}>
        <div>Unsupported 3D file type.</div>
        <div style={{fontSize: 12, color: '#666', marginTop: 8}}>
          Supported formats: STL, OBJ, GLB, GLTF, STEP
        </div>
        <div style={{fontSize: 11, color: '#999', marginTop: 4}}>
          STEP files require the OCCT library to load properly
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
            Interactive 3D model viewer for {fileName}. Use mouse to rotate freely, scroll to zoom, and right-click to pan.
          </DialogDescription>
        </DialogHeader>
        <div style={{ minHeight: 420, minWidth: 400 }}>{content}</div>
      </DialogContent>
    </Dialog>
  );
};

export default ThreeDViewerModal; 