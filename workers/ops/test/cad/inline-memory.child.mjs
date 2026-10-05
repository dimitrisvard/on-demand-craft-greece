// Child process of test/cad/inline-memory.test.ts: parses one synthetic worst-case input with the unchanged
// edge-function parsers (supabase/functions/generate-manufacturing-pdf/*, loaded by Node's type stripping) under the
// V8 heap cap the parent sets (--max-old-space-size). Usage: node inline-memory.child.mjs <step|dxf|stl> <MiB>.
// Exit 0 = parsed; a heap overflow ends the process with a non-zero code. Inputs are random geometry, built here.

const ORIGINALS = new URL('../../../../supabase/functions/generate-manufacturing-pdf/', import.meta.url);
const [kind, mibText] = process.argv.slice(2);
const target = Math.floor(Number(mibText) * 1024 * 1024);
if (!['step', 'dxf', 'stl'].includes(kind) || !Number.isFinite(target) || target <= 0) {
  console.error('usage: inline-memory.child.mjs <step|dxf|stl> <MiB>');
  process.exit(2);
}
console.log = () => {};

function stepInput() {
  const out = ['ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n'];
  let size = out[0].length;
  let id = 1;
  while (size < target) {
    const p1 = id++, p2 = id++, d = id++, v = id++, l = id++, e = id++;
    const r = () => (Math.random() * 500).toFixed(6);
    const chunk = `#${p1}=CARTESIAN_POINT('',(${r()},${r()},${(Math.random() * 5).toFixed(6)}));\n#${p2}=CARTESIAN_POINT('',(${r()},${r()},${(Math.random() * 5).toFixed(6)}));\n#${d}=DIRECTION('',(1.,0.,0.));\n#${v}=VECTOR('',#${d},1.);\n#${l}=LINE('',#${p1},#${v});\n#${e}=EDGE_CURVE('',#${p1},#${p2},#${l},.T.);\n`;
    out.push(chunk);
    size += chunk.length;
  }
  out.push('ENDSEC;\nEND-ISO-10303-21;\n');
  return new TextEncoder().encode(out.join('')).buffer;
}

function dxfInput() {
  const parts = ['0\nSECTION\n2\nENTITIES\n'];
  let size = parts[0].length;
  const r = () => (Math.random() * 500).toFixed(4);
  while (size < target) {
    const c = `0\nLINE\n8\n0\n10\n${r()}\n20\n${r()}\n30\n0.0\n11\n${r()}\n21\n${r()}\n31\n0.0\n`;
    parts.push(c);
    size += c.length;
  }
  parts.push('0\nENDSEC\n0\nEOF\n');
  return new TextEncoder().encode(parts.join('')).buffer;
}

function stlInput() {
  const n = Math.floor((target - 84) / 50);
  const b = new DataView(new ArrayBuffer(84 + n * 50));
  b.setUint32(80, n, true);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50;
    for (let k = 0; k < 12; k++) b.setFloat32(o + k * 4, k < 3 ? 0 : Math.random() * 100, true);
  }
  return b.buffer;
}

if (kind === 'step') {
  const { parseSTEP } = await import(new URL('step-parser.ts', ORIGINALS).href);
  await parseSTEP(stepInput());
} else if (kind === 'dxf') {
  const { parseDXF, dxfToMeshAnalysis } = await import(new URL('dxf-parser.ts', ORIGINALS).href);
  dxfToMeshAnalysis(parseDXF(dxfInput()));
} else {
  const { parseSTL } = await import(new URL('stl-parser.ts', ORIGINALS).href);
  const { analyzeMesh } = await import(new URL('mesh-analyzer.ts', ORIGINALS).href);
  analyzeMesh(parseSTL(stlInput()).triangles);
}
process.stdout.write(`parsed ${kind} ${mibText} MiB\n`);
