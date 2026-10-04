// Request bodies for /api/notifications action "nest", shaped as the RFQ page sends them (src/pages/RfqDetails.tsx,
// "Call nesting API"): {action: 'nest', files: <DXF text per part>, metadata: {parts, config}}.
// Used to measure the CPU of `nest` on microns-ops (T3, Workers Logs) and by the ops tests.
//
//   node scripts/nest-fixture.mjs <instances> [balanced|best]   prints the JSON body (instances: 80, 400, 800, 1200)
//
// Four part shapes in two material groups; quantities are spread so that they sum to exactly <instances>. The DXF
// text is written by hand (closed LWPOLYLINE outlines, millimetres), so the script needs no dependency.

import { pathToFileURL } from 'node:url';

/** Part instance counts of the measurement series. */
export const NEST_FIXTURE_SIZES = [80, 400, 800, 1200];

const SHAPES = [
  { name: 'plate-120x80', material: 'Steel S235', thickness: 2, points: [[0, 0], [120, 0], [120, 80], [0, 80]] },
  { name: 'bracket-l-80x60', material: 'Steel S235', thickness: 2, points: [[0, 0], [80, 0], [80, 20], [20, 20], [20, 60], [0, 60]] },
  { name: 'strip-200x30', material: 'Steel S235', thickness: 2, points: [[0, 0], [200, 0], [200, 30], [0, 30]] },
  { name: 'gusset-60', material: 'Aluminium 5754', thickness: 3, points: [[0, 0], [60, 0], [0, 60]] },
];

/** A minimal DXF (ENTITIES section only) with one closed LWPOLYLINE on layer 0. */
export function closedOutlineDxf(points) {
  const lines = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '8', '0', '90', String(points.length), '70', '1'];
  for (const [x, y] of points) lines.push('10', String(x), '20', String(y));
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return `${lines.join('\n')}\n`;
}

/** The nest request body for `instances` part instances at optimisation level `level`. */
export function buildNestPayload(instances, level) {
  if (!Number.isInteger(instances) || instances < SHAPES.length) {
    throw new RangeError(`instances must be an integer >= ${SHAPES.length}`);
  }
  if (level !== 'balanced' && level !== 'best') throw new RangeError("level must be 'balanced' or 'best'");
  const base = Math.floor(instances / SHAPES.length);
  const extra = instances % SHAPES.length;
  return {
    action: 'nest',
    files: SHAPES.map((shape) => closedOutlineDxf(shape.points)),
    metadata: {
      parts: SHAPES.map((shape, fileIndex) => ({
        fileIndex,
        name: shape.name,
        material: shape.material,
        thickness: shape.thickness,
        quantity: base + (fileIndex < extra ? 1 : 0),
      })),
      config: { gap: 3, edgeMargin: 5, rotationMode: '90deg', optimizationLevel: level },
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [count = '80', level = 'balanced'] = process.argv.slice(2);
  const instances = Number(count);
  if (!NEST_FIXTURE_SIZES.includes(instances)) {
    console.error(`usage: node scripts/nest-fixture.mjs <${NEST_FIXTURE_SIZES.join('|')}> [balanced|best]`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(buildNestPayload(instances, level))}\n`);
}
