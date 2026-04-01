import makerjs from 'makerjs';
import { parseDXF } from '../lib/nesting/dxf-import.js';
import { groupPartsByMaterialThickness, autoSelectSheet } from '../lib/nesting/grouper.js';
import { nestGroup } from '../lib/nesting/nester.js';
import { generateSvgPreview } from '../lib/nesting/preview.js';
import { generateNestedDxf } from '../lib/nesting/dxf-export.js';
import { nestOrder } from '../lib/nesting/index.js';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Simple test runner
// ---------------------------------------------------------------------------

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL: ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}
function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// ---------------------------------------------------------------------------
// DXF generators using makerjs
// ---------------------------------------------------------------------------

function makeRectDxf(w, h) {
  const model = { models: { outline: new makerjs.models.Rectangle(w, h) } };
  return makerjs.exporter.toDXF(model);
}

function makeLBracketDxf() {
  const model = {
    models: {
      outline: new makerjs.models.ConnectTheDots(true, [
        [0, 0], [80, 0], [80, 20], [20, 20], [20, 60], [0, 60]
      ])
    }
  };
  return makerjs.exporter.toDXF(model);
}

function makeCircleDxf(radius) {
  const model = {
    paths: { outline: new makerjs.paths.Circle([0, 0], radius) }
  };
  return makerjs.exporter.toDXF(model);
}

function makePlateWithHolesDxf() {
  const model = {
    models: {
      outline: new makerjs.models.Rectangle(120, 60),
    },
    paths: {
      hole1: new makerjs.paths.Circle([20, 30], 5),
      hole2: new makerjs.paths.Circle([60, 30], 5),
      hole3: new makerjs.paths.Circle([100, 30], 5),
    }
  };
  return makerjs.exporter.toDXF(model);
}

function makeStarDxf(outerR, innerR, points) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push([r * Math.cos(angle), r * Math.sin(angle)]);
  }
  const model = { models: { outline: new makerjs.models.ConnectTheDots(true, pts) } };
  return makerjs.exporter.toDXF(model);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main() {
  console.log('Nesting engine integration tests\n');

  // 1. Simple rectangles
  await test('Simple rectangles — parse 100x50, verify bbox and area', async () => {
    const dxf = makeRectDxf(100, 50);
    const part = parseDXF(dxf, { id: 'rect100x50', name: 'rect100x50' });
    assert(Math.abs(part.bbox.w - 100) < 1, `bbox width expected ~100, got ${part.bbox.w}`);
    assert(Math.abs(part.bbox.h - 50) < 1, `bbox height expected ~50, got ${part.bbox.h}`);
    assert(Math.abs(part.area - 5000) < 100, `area expected ~5000, got ${part.area}`);
  });

  // 2. L-shaped bracket
  await test('L-shaped bracket — area correct, no holes', async () => {
    const dxf = makeLBracketDxf();
    const part = parseDXF(dxf, { id: 'lbracket', name: 'lbracket' });
    // L shape vertices: [0,0],[80,0],[80,20],[20,20],[20,60],[0,60]
    // Bottom bar: 80 wide x 20 tall = 1600
    // Left column above bar: 20 wide x 40 tall = 800
    // Total = 2400
    const expectedArea = 80 * 20 + 20 * 40;
    assert(Math.abs(part.area - expectedArea) < 50, `area expected ~${expectedArea}, got ${part.area}`);
    assert(part.holes.length === 0, `expected 0 holes, got ${part.holes.length}`);
  });

  // 3. Circle
  await test('Circle — ~32 vertices and area close to pi*25^2', async () => {
    const dxf = makeCircleDxf(25);
    const part = parseDXF(dxf, { id: 'circle25', name: 'circle25' });
    assert(part.outer.length >= 20, `expected >= 20 vertices, got ${part.outer.length}`);
    const expectedArea = Math.PI * 25 * 25;
    const tolerance = expectedArea * 0.1;
    assert(Math.abs(part.area - expectedArea) < tolerance,
      `area expected ~${expectedArea.toFixed(1)}, got ${part.area.toFixed(1)}`);
  });

  // 4. Part with holes
  await test('Part with holes — 3 holes, net area = plate - 3*hole areas', async () => {
    const dxf = makePlateWithHolesDxf();
    const part = parseDXF(dxf, { id: 'plate_holes', name: 'plate_holes' });
    assert(part.holes.length === 3, `expected 3 holes, got ${part.holes.length}`);
    const plateArea = 120 * 60;
    const holeArea = Math.PI * 5 * 5;
    const expectedNetArea = plateArea - 3 * holeArea;
    const tolerance = expectedNetArea * 0.1;
    assert(Math.abs(part.area - expectedNetArea) < tolerance,
      `net area expected ~${expectedNetArea.toFixed(1)}, got ${part.area.toFixed(1)}`);
  });

  // 5. Material grouping
  await test('Material grouping — 2 groups, quantity expansion works', async () => {
    const parts = [
      { id: 'p1', material: 'Aluminum 5052', thickness: 2, quantity: 3, bbox: { w: 100, h: 50 } },
      { id: 'p2', material: 'Steel S235', thickness: 3, quantity: 2, bbox: { w: 80, h: 40 } },
      { id: 'p3', material: 'Aluminum 5052', thickness: 2, quantity: 1, bbox: { w: 60, h: 30 } },
    ];
    const groups = groupPartsByMaterialThickness(parts);
    assert(groups.size === 2, `expected 2 groups, got ${groups.size}`);

    const aluGroup = groups.get('Aluminum 5052|2');
    assert(aluGroup, 'Aluminum 5052|2 group not found');
    // p1 qty 3 + p3 qty 1 = 4 instances
    assert(aluGroup.length === 4, `expected 4 expanded instances in alu group, got ${aluGroup.length}`);

    const steelGroup = groups.get('Steel S235|3');
    assert(steelGroup, 'Steel S235|3 group not found');
    assert(steelGroup.length === 2, `expected 2 expanded instances in steel group, got ${steelGroup.length}`);
  });

  // 6. Nesting simple rectangles
  await test('Nesting 6 rectangles (100x50) on 1000x500 sheet', async () => {
    const dxf = makeRectDxf(100, 50);
    const part = parseDXF(dxf, { id: 'rect', name: 'rect' });

    const result = await nestGroup([{
      partId: 'rect',
      outerContour: part.outer,
      outer: part.outer,
      holes: part.holes,
      name: 'rect',
      bbox: part.bbox,
      area: part.area,
      quantity: 6,
    }], {
      sheetW: 1000,
      sheetH: 500,
      gap: 3,
      edgeMargin: 5,
      rotationMode: '90deg',
      optimizationLevel: 'fast',
    });

    assert(result.sheets.length >= 1, 'expected at least 1 sheet');
    const totalPlaced = result.sheets.reduce((sum, s) => sum + s.placements.length, 0);
    assert(totalPlaced === 6, `expected 6 placements total, got ${totalPlaced}`);

    // Verify utilization > 0
    assert(result.sheets[0].utilization > 0, `utilization should be > 0, got ${result.sheets[0].utilization}`);

    // Verify no overlapping placements (bbox check on same sheet)
    for (const sheet of result.sheets) {
      const pl = sheet.placements;
      for (let i = 0; i < pl.length; i++) {
        for (let j = i + 1; j < pl.length; j++) {
          const a = pl[i];
          const b = pl[j];
          const overlaps =
            a.position.x < b.position.x + b.bbox.w &&
            a.position.x + a.bbox.w > b.position.x &&
            a.position.y < b.position.y + b.bbox.h &&
            a.position.y + a.bbox.h > b.position.y;
          assert(!overlaps, `placements ${i} and ${j} overlap on a sheet`);
        }
      }
    }
  });

  // 7. Mixed materials via full nestOrder
  await test('nestOrder with 2 material groups — correct grouping', async () => {
    const rectDxf = makeRectDxf(100, 50);
    const starDxf = makeStarDxf(40, 20, 5);

    const result = await nestOrder(
      [rectDxf, starDxf],
      {
        parts: [
          { name: 'rect_alu', fileIndex: 0, material: 'Aluminum 5052', thickness: 2, quantity: 2 },
          { name: 'star_steel', fileIndex: 1, material: 'Steel S235', thickness: 3, quantity: 1 },
        ],
        config: { optimizationLevel: 'fast' },
      },
    );

    assert(result.success === true, 'nestOrder should succeed');
    assert(result.groups.length === 2, `expected 2 groups, got ${result.groups.length}`);

    const aluGroup = result.groups.find(g => g.material === 'Aluminum 5052');
    assert(aluGroup, 'Aluminum 5052 group not found');
    assert(aluGroup.thickness === 2, `expected thickness 2, got ${aluGroup.thickness}`);

    const steelGroup = result.groups.find(g => g.material === 'Steel S235');
    assert(steelGroup, 'Steel S235 group not found');
    assert(steelGroup.thickness === 3, `expected thickness 3, got ${steelGroup.thickness}`);

    // Verify parts are on correct sheets
    const aluPartIds = aluGroup.sheets.flatMap(s => s.placements.map(p => p.partId));
    assert(aluPartIds.every(id => id === 'rect_alu'), 'all alu placements should be rect_alu');

    const steelPartIds = steelGroup.sheets.flatMap(s => s.placements.map(p => p.partId));
    assert(steelPartIds.every(id => id === 'star_steel'), 'all steel placements should be star_steel');
  });

  // 8. Oversized part
  await test('Oversized part — does not crash, gets skipped', async () => {
    const dxf = makeRectDxf(5000, 3000);
    const part = parseDXF(dxf, { id: 'huge', name: 'huge' });

    const result = await nestGroup([{
      partId: 'huge',
      outerContour: part.outer,
      outer: part.outer,
      holes: part.holes,
      name: 'huge',
      bbox: part.bbox,
      area: part.area,
      quantity: 1,
    }], {
      sheetW: 1000,
      sheetH: 500,
      gap: 3,
      edgeMargin: 5,
      rotationMode: '90deg',
      optimizationLevel: 'fast',
    });

    // Should not crash; part is skipped
    const totalPlaced = result.sheets.reduce((sum, s) => sum + s.placements.length, 0);
    assert(totalPlaced === 0, `expected 0 placements for oversized part, got ${totalPlaced}`);
    assert(result.warnings && result.warnings.length > 0, 'expected a warning about oversized part');
  });

  // 9. Empty order
  await test('Empty order — throws NestingError with EMPTY_ORDER code', async () => {
    let threw = false;
    try {
      await nestOrder([], { parts: [] });
    } catch (e) {
      threw = true;
      assert(e.code === 'EMPTY_ORDER', `expected EMPTY_ORDER, got ${e.code}`);
    }
    assert(threw, 'nestOrder with empty parts should throw');
  });

  // 10. SVG preview
  await test('SVG preview — contains <svg, xmlns, utilization text', async () => {
    const dxf = makeRectDxf(100, 50);
    const part = parseDXF(dxf, { id: 'rect_svg', name: 'rect_svg' });

    const nestResult = await nestGroup([{
      partId: 'rect_svg',
      outerContour: part.outer,
      outer: part.outer,
      holes: part.holes,
      name: 'rect_svg',
      bbox: part.bbox,
      area: part.area,
      quantity: 2,
    }], {
      sheetW: 1000,
      sheetH: 500,
      gap: 3,
      edgeMargin: 5,
      rotationMode: 'none',
      optimizationLevel: 'fast',
    });

    assert(nestResult.sheets.length > 0, 'expected at least 1 sheet');

    const partsLookup = [{
      partId: 'rect_svg',
      outer: part.outer,
      holes: part.holes,
      name: 'rect_svg',
    }];

    const svg = generateSvgPreview(nestResult.sheets[0], { w: 1000, h: 500 }, partsLookup);
    assert(svg.includes('<svg'), 'SVG should contain <svg');
    assert(svg.includes('xmlns'), 'SVG should contain xmlns');
    assert(svg.includes('utilization'), 'SVG should contain utilization text');
  });

  // 11. DXF export
  await test('DXF export — returns non-empty base64 string', async () => {
    const dxf = makeRectDxf(100, 50);
    const part = parseDXF(dxf, { id: 'rect_dxf', name: 'rect_dxf' });

    const nestResult = await nestGroup([{
      partId: 'rect_dxf',
      outerContour: part.outer,
      outer: part.outer,
      holes: part.holes,
      name: 'rect_dxf',
      bbox: part.bbox,
      area: part.area,
      quantity: 1,
    }], {
      sheetW: 1000,
      sheetH: 500,
      gap: 3,
      edgeMargin: 5,
      rotationMode: 'none',
      optimizationLevel: 'fast',
    });

    assert(nestResult.sheets.length > 0, 'expected at least 1 sheet');

    const partsLookup = [{
      id: 'rect_dxf',
      partId: 'rect_dxf',
      outer: part.outer,
      holes: part.holes,
      name: 'rect_dxf',
    }];

    const base64 = generateNestedDxf(nestResult.sheets[0], { w: 1000, h: 500 }, partsLookup);
    assert(typeof base64 === 'string', 'DXF export should return a string');
    assert(base64.length > 0, 'DXF export should return a non-empty string');
    // Verify it is valid base64 by decoding
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
    assert(decoded.length > 0, 'decoded DXF should be non-empty');
    assert(decoded.includes('SECTION'), 'decoded DXF should contain SECTION');
  });

  // ---------------------------------------------------------------------------
  // Demo nesting
  // ---------------------------------------------------------------------------
  console.log('\n--- Demo nesting ---\n');

  const demoStart = Date.now();

  const rectDxf = makeRectDxf(150, 80);
  const lBracketDxf = makeLBracketDxf();
  const starDxf = makeStarDxf(50, 25, 5);
  const plateHolesDxf = makePlateWithHolesDxf();

  try {
    const demoResult = await nestOrder(
      [rectDxf, lBracketDxf, starDxf, plateHolesDxf],
      {
        parts: [
          // Aluminum 5052 2mm: 3 rect + 2 L-bracket
          { name: 'rect_150x80', fileIndex: 0, material: 'Aluminum 5052', thickness: 2, quantity: 3 },
          { name: 'l_bracket', fileIndex: 1, material: 'Aluminum 5052', thickness: 2, quantity: 2 },
          // Steel S235 3mm: 1 star + 1 plate-with-holes
          { name: 'star_5pt', fileIndex: 2, material: 'Steel S235', thickness: 3, quantity: 1 },
          { name: 'plate_3holes', fileIndex: 3, material: 'Steel S235', thickness: 3, quantity: 1 },
        ],
        config: { optimizationLevel: 'fast' },
      },
    );

    const demoTime = Date.now() - demoStart;

    // Save SVG previews to /tmp
    let svgIdx = 0;
    for (const group of demoResult.groups) {
      for (const sheet of group.sheets) {
        const svgPath = `/tmp/nest-preview-${svgIdx}.svg`;
        fs.writeFileSync(svgPath, sheet.previewSvg, 'utf-8');
        console.log(`  Saved SVG preview: ${svgPath}`);
        svgIdx++;
      }
    }

    // Print summary stats
    console.log(`\n  Summary:`);
    console.log(`    Material groups: ${demoResult.summary.materialGroups}`);
    console.log(`    Total sheets:    ${demoResult.summary.totalSheets}`);
    console.log(`    Total parts:     ${demoResult.summary.totalParts}`);
    console.log(`    Utilization:     ${demoResult.summary.overallUtilization}%`);
    console.log(`    Nesting time:    ${demoTime}ms`);

    if (demoResult.warnings && demoResult.warnings.length > 0) {
      console.log(`    Warnings:`);
      for (const w of demoResult.warnings) {
        console.log(`      - ${w}`);
      }
    }
  } catch (err) {
    console.log(`  Demo nesting failed: ${err.message}`);
  }

  // ---------------------------------------------------------------------------
  // Final results
  // ---------------------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
