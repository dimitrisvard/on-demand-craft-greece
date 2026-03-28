/**
 * Server-side STEP → GLB conversion
 *
 * Triggered async after STEP file upload. Converts STEP to high-quality GLB
 * using occt-import-js (Node.js compatible) and stores alongside the original
 * in the same S3 folder.
 *
 * POST /api/convert-step
 * Body: { filePath: "RFQ-xxx/part-yyy/file.step" }
 * Returns: { success, glbPath, error? }
 */

import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

// GLB binary format constants
const GLB_MAGIC = 0x46546C67;  // 'glTF'
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4E4F534A;  // 'JSON'
const BIN_CHUNK_TYPE = 0x004E4942;   // 'BIN\0'

function setCors(res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getS3Client() {
  return new S3Client({
    region: process.env.AWS_REGION || process.env.VITE_AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: (process.env.AWS_ACCESS_KEY_ID || process.env.VITE_AWS_ACCESS_KEY_ID || '').trim(),
      secretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY || process.env.VITE_AWS_SECRET_ACCESS_KEY || '').trim(),
    },
  });
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * Merge vertices at the same position to enable smooth normal computation.
 * Without this, each triangle has isolated vertices → flat normals.
 */
function mergeAndComputeNormals(positions, indices) {
  const vertexMap = new Map();
  const newPositions = [];
  const newIndices = [];
  const indexRemap = new Uint32Array(positions.length / 3);

  // Merge vertices by position (within tolerance)
  for (let i = 0; i < positions.length; i += 3) {
    const key = `${(positions[i] * 1000) | 0},${(positions[i + 1] * 1000) | 0},${(positions[i + 2] * 1000) | 0}`;
    if (vertexMap.has(key)) {
      indexRemap[i / 3] = vertexMap.get(key);
    } else {
      const idx = newPositions.length / 3;
      vertexMap.set(key, idx);
      indexRemap[i / 3] = idx;
      newPositions.push(positions[i], positions[i + 1], positions[i + 2]);
    }
  }

  // Remap indices
  if (indices && indices.length > 0) {
    for (let i = 0; i < indices.length; i++) {
      newIndices.push(indexRemap[indices[i]]);
    }
  } else {
    for (let i = 0; i < positions.length / 3; i++) {
      newIndices.push(indexRemap[i]);
    }
  }

  // Compute smooth normals
  const vertCount = newPositions.length / 3;
  const normals = new Float32Array(vertCount * 3);

  for (let i = 0; i < newIndices.length; i += 3) {
    const ia = newIndices[i], ib = newIndices[i + 1], ic = newIndices[i + 2];
    const ax = newPositions[ia * 3], ay = newPositions[ia * 3 + 1], az = newPositions[ia * 3 + 2];
    const bx = newPositions[ib * 3], by = newPositions[ib * 3 + 1], bz = newPositions[ib * 3 + 2];
    const cx = newPositions[ic * 3], cy = newPositions[ic * 3 + 1], cz = newPositions[ic * 3 + 2];

    // Cross product of edges
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    // Accumulate face normal to each vertex
    normals[ia * 3] += nx; normals[ia * 3 + 1] += ny; normals[ia * 3 + 2] += nz;
    normals[ib * 3] += nx; normals[ib * 3 + 1] += ny; normals[ib * 3 + 2] += nz;
    normals[ic * 3] += nx; normals[ic * 3 + 1] += ny; normals[ic * 3 + 2] += nz;
  }

  // Normalize
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.sqrt(normals[i] ** 2 + normals[i + 1] ** 2 + normals[i + 2] ** 2);
    if (len > 0) {
      normals[i] /= len;
      normals[i + 1] /= len;
      normals[i + 2] /= len;
    }
  }

  return {
    positions: new Float32Array(newPositions),
    normals,
    indices: new Uint32Array(newIndices),
  };
}

/**
 * Build a minimal GLB binary from mesh data
 */
function buildGLB(allMeshes) {
  // Combine all meshes into one
  let totalPositions = [];
  let totalNormals = [];
  let totalIndices = [];
  let vertexOffset = 0;

  for (const mesh of allMeshes) {
    const { positions, normals, indices } = mesh;
    totalPositions.push(...positions);
    totalNormals.push(...normals);
    for (const idx of indices) {
      totalIndices.push(idx + vertexOffset);
    }
    vertexOffset += positions.length / 3;
  }

  const posArray = new Float32Array(totalPositions);
  const normArray = new Float32Array(totalNormals);
  const idxArray = totalIndices.length > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);
  const idxComponentType = totalIndices.length > 65535 ? 5125 : 5123; // UNSIGNED_INT or UNSIGNED_SHORT

  // Compute bounds
  let minPos = [Infinity, Infinity, Infinity];
  let maxPos = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < posArray.length; i += 3) {
    minPos[0] = Math.min(minPos[0], posArray[i]);
    minPos[1] = Math.min(minPos[1], posArray[i + 1]);
    minPos[2] = Math.min(minPos[2], posArray[i + 2]);
    maxPos[0] = Math.max(maxPos[0], posArray[i]);
    maxPos[1] = Math.max(maxPos[1], posArray[i + 1]);
    maxPos[2] = Math.max(maxPos[2], posArray[i + 2]);
  }

  // Build binary buffer: [indices | positions | normals]
  const idxBytes = new Uint8Array(idxArray.buffer);
  const posBytes = new Uint8Array(posArray.buffer);
  const normBytes = new Uint8Array(normArray.buffer);

  // Pad each section to 4-byte alignment
  const pad = (n) => (4 - (n % 4)) % 4;
  const idxLen = idxBytes.length + pad(idxBytes.length);
  const posLen = posBytes.length;
  const normLen = normBytes.length;
  const totalBinLen = idxLen + posLen + normLen;

  const binBuffer = new Uint8Array(totalBinLen);
  binBuffer.set(idxBytes, 0);
  binBuffer.set(posBytes, idxLen);
  binBuffer.set(normBytes, idxLen + posLen);

  const vertexCount = posArray.length / 3;

  const gltfJson = {
    asset: { version: "2.0", generator: "micronshub-converter" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 1, NORMAL: 2 },
        indices: 0,
        material: 0,
      }],
    }],
    materials: [{
      pbrMetallicRoughness: {
        baseColorFactor: [0.69, 0.745, 0.773, 1.0], // #b0bec5
        metallicFactor: 0.3,
        roughnessFactor: 0.55,
      },
      doubleSided: true,
    }],
    accessors: [
      { bufferView: 0, componentType: idxComponentType, count: totalIndices.length, type: "SCALAR", max: [vertexCount - 1], min: [0] },
      { bufferView: 1, componentType: 5126, count: vertexCount, type: "VEC3", max: maxPos, min: minPos },
      { bufferView: 2, componentType: 5126, count: vertexCount, type: "VEC3" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: idxBytes.length, target: 34963 },
      { buffer: 0, byteOffset: idxLen, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: idxLen + posLen, byteLength: normBytes.length, target: 34962 },
    ],
    buffers: [{ byteLength: totalBinLen }],
  };

  // Encode JSON chunk (pad with spaces to 4-byte alignment)
  let jsonStr = JSON.stringify(gltfJson);
  while (jsonStr.length % 4 !== 0) jsonStr += ' ';
  const jsonBytes = new TextEncoder().encode(jsonStr);

  // Build GLB
  const glbLength = 12 + 8 + jsonBytes.length + 8 + totalBinLen;
  const glb = new ArrayBuffer(glbLength);
  const view = new DataView(glb);
  let offset = 0;

  // Header
  view.setUint32(offset, GLB_MAGIC, true); offset += 4;
  view.setUint32(offset, GLB_VERSION, true); offset += 4;
  view.setUint32(offset, glbLength, true); offset += 4;

  // JSON chunk
  view.setUint32(offset, jsonBytes.length, true); offset += 4;
  view.setUint32(offset, JSON_CHUNK_TYPE, true); offset += 4;
  new Uint8Array(glb, offset, jsonBytes.length).set(jsonBytes); offset += jsonBytes.length;

  // Binary chunk
  view.setUint32(offset, totalBinLen, true); offset += 4;
  view.setUint32(offset, BIN_CHUNK_TYPE, true); offset += 4;
  new Uint8Array(glb, offset, totalBinLen).set(binBuffer);

  return Buffer.from(glb);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { filePath } = req.body || {};
  if (!filePath) return res.status(400).json({ error: 'filePath is required' });

  const bucketName = process.env.AWS_BUCKET_NAME || process.env.VITE_AWS_BUCKET_NAME;
  if (!bucketName) return res.status(500).json({ error: 'S3 bucket not configured' });

  try {
    const s3 = getS3Client();

    // 1. Download STEP file from S3
    const getCmd = new GetObjectCommand({ Bucket: bucketName, Key: filePath });
    const s3Response = await s3.send(getCmd);
    const chunks = [];
    for await (const chunk of s3Response.Body) {
      chunks.push(chunk);
    }
    const stepBuffer = Buffer.concat(chunks);

    // 2. Load occt-import-js (works in Node.js)
    const occtImport = await import('occt-import-js');
    const occt = await occtImport.default();

    // 3. Tessellate with high quality (server has more CPU budget)
    const result = occt.ReadStepFile(new Uint8Array(stepBuffer), {
      linearDeflection: 0.0005,
      linearDeflectionType: 'bounding_box_ratio',
    });

    if (!result.success || !result.meshes?.length) {
      return res.status(422).json({ error: 'Failed to parse STEP file' });
    }

    // 4. Process meshes: merge vertices + compute smooth normals
    const processedMeshes = result.meshes.map((mesh) => {
      const positions = Array.from(mesh.attributes.position.array);
      const indices = mesh.index ? Array.from(mesh.index.array) : null;
      return mergeAndComputeNormals(positions, indices);
    });

    // 5. Build GLB
    const glbBuffer = buildGLB(processedMeshes);

    // 6. Upload GLB to same S3 folder
    const glbPath = filePath.replace(/\.(step|stp)$/i, '.glb');
    const putCmd = new PutObjectCommand({
      Bucket: bucketName,
      Key: glbPath,
      Body: glbBuffer,
      ContentType: 'model/gltf-binary',
    });
    await s3.send(putCmd);

    // 7. Update Supabase record with glb_path
    const supabase = getSupabase();
    if (supabase) {
      await supabase
        .from('rfq_files')
        .update({ glb_path: glbPath })
        .eq('file_path', filePath);
    }

    return res.status(200).json({ success: true, glbPath });
  } catch (error) {
    console.error('STEP conversion error:', error);
    return res.status(500).json({ error: error.message || 'Conversion failed' });
  }
}
