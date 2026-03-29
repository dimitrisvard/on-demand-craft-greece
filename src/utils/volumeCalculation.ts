import * as THREE from 'three';

/**
 * Calculate the volume of a mesh using the signed volume method.
 * Works for closed (watertight) meshes. For non-watertight meshes,
 * the result is an approximation.
 *
 * Uses the divergence theorem: V = (1/6) * sum of (v0 . (v1 x v2)) for each triangle
 */
export function calculateMeshVolume(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position');
  if (!position) return 0;

  const index = geometry.getIndex();
  let volume = 0;

  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();

  if (index) {
    // Indexed geometry
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);

      v0.fromBufferAttribute(position, a);
      v1.fromBufferAttribute(position, b);
      v2.fromBufferAttribute(position, c);

      volume += signedVolumeOfTriangle(v0, v1, v2);
    }
  } else {
    // Non-indexed geometry
    for (let i = 0; i < position.count; i += 3) {
      v0.fromBufferAttribute(position, i);
      v1.fromBufferAttribute(position, i + 1);
      v2.fromBufferAttribute(position, i + 2);

      volume += signedVolumeOfTriangle(v0, v1, v2);
    }
  }

  return Math.abs(volume);
}

/**
 * Signed volume contribution of a single triangle
 * V = (1/6) * v0 . (v1 x v2)
 */
function signedVolumeOfTriangle(v0: THREE.Vector3, v1: THREE.Vector3, v2: THREE.Vector3): number {
  return (
    v0.x * (v1.y * v2.z - v1.z * v2.y) +
    v0.y * (v1.z * v2.x - v1.x * v2.z) +
    v0.z * (v1.x * v2.y - v1.y * v2.x)
  ) / 6.0;
}

/**
 * Calculate the surface area of a mesh
 */
export function calculateMeshSurfaceArea(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position');
  if (!position) return 0;

  const index = geometry.getIndex();
  let area = 0;

  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const cross = new THREE.Vector3();

  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      v0.fromBufferAttribute(position, index.getX(i));
      v1.fromBufferAttribute(position, index.getX(i + 1));
      v2.fromBufferAttribute(position, index.getX(i + 2));

      edge1.subVectors(v1, v0);
      edge2.subVectors(v2, v0);
      cross.crossVectors(edge1, edge2);
      area += cross.length() * 0.5;
    }
  } else {
    for (let i = 0; i < position.count; i += 3) {
      v0.fromBufferAttribute(position, i);
      v1.fromBufferAttribute(position, i + 1);
      v2.fromBufferAttribute(position, i + 2);

      edge1.subVectors(v1, v0);
      edge2.subVectors(v2, v0);
      cross.crossVectors(edge1, edge2);
      area += cross.length() * 0.5;
    }
  }

  return area;
}

/**
 * Calculate volume from a Three.js scene (handles groups and multiple meshes)
 */
export function calculateSceneVolume(scene: THREE.Object3D): number {
  let totalVolume = 0;

  scene.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const geo = child.geometry.clone();
      // Apply world transform to get correct volume
      geo.applyMatrix4(child.matrixWorld);
      totalVolume += calculateMeshVolume(geo);
      geo.dispose();
    }
  });

  return totalVolume;
}

/**
 * Calculate surface area from a Three.js scene
 */
export function calculateSceneSurfaceArea(scene: THREE.Object3D): number {
  let totalArea = 0;

  scene.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const geo = child.geometry.clone();
      geo.applyMatrix4(child.matrixWorld);
      totalArea += calculateMeshSurfaceArea(geo);
      geo.dispose();
    }
  });

  return totalArea;
}

/**
 * Format surface area for display
 */
export function formatSurfaceArea(areaMm2: number): string {
  if (areaMm2 >= 1_000_000) {
    return `${(areaMm2 / 1_000_000).toFixed(2)} m²`;
  }
  if (areaMm2 >= 100) {
    return `${(areaMm2 / 100).toFixed(2)} cm²`;
  }
  return `${areaMm2.toFixed(1)} mm²`;
}

/**
 * Get triangle count from geometry
 */
export function getTriangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  if (index) {
    return index.count / 3;
  }
  const position = geometry.getAttribute('position');
  return position ? position.count / 3 : 0;
}
