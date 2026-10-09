// Port of xometry-bot/tests/test_filters.py (21 test functions, all ported; test titles keep the Python names),
// plus the Python regular-expression behaviours the port reproduces (Unicode case folding, Python's \s and \b).

import { describe, expect, it } from 'vitest';
import { ACTIVE_PRESETS, BORDERLINE_RE, pyMatches, ROUGHNESS_RE, SECONDARY_OP_RE, TOLERANCE_RE } from '../../../src/xometry/config';
import { extractSpec, fileKind, findSecondaryOp, matchesAnyActivePreset, matchesPreset, pickQuoteFile, posixSuffix } from '../../../src/xometry/filters';
import { parseJobOffer } from '../../../src/xometry/models';
import {
  ANODIZING_TAG,
  GRINDING_TAG,
  HEAT_TAG,
  LASER_TAG,
  makeOffer,
  makePart,
  MILLING_TAG,
  RA_TAG,
  THREAD_RISK_TAG,
  TOLERANCE_TAG,
  type Json,
} from './helpers';

function offerWithTags(tags: Json[], finish = '') {
  return parseJobOffer(makeOffer(undefined, { parts: [makePart({ tags, finish })] }));
}

describe('TestPresets', () => {
  it('test_milonk_keeps_milling', () => {
    expect(matchesAnyActivePreset(offerWithTags([MILLING_TAG]))).toBe(true);
  });

  it('test_laser_only_offer_rejected', () => {
    expect(matchesAnyActivePreset(offerWithTags([LASER_TAG]))).toBe(false);
  });

  it('test_exclude_list_wins', () => {
    const preset = { name: 'custom', include: new Set([14]), exclude: new Set([36]) };
    expect(matchesPreset(offerWithTags([MILLING_TAG, LASER_TAG]), preset)).toBe(false);
  });

  it('test_active_presets_is_milonk_only', () => {
    expect([...ACTIVE_PRESETS]).toEqual(['milonk']);
  });
});

describe('TestSecondaryOpExclusion', () => {
  it.each([
    'Anodizing type II',
    'Powder coating',
    'Nickel coating',
    'Glass Bead Blasting',
    'Passivating',
    'Chrome plating',
    'Wet Painting',
    'Tumbling',
    'Electropolish',
    'Phosphating',
  ])('test_finishing_tags_exclude [%s]', (name) => {
    const hit = findSecondaryOp(offerWithTags([{ id: 999, name, context: 'production_method_features' }]));
    expect(hit).toEqual({ op_name: name, source: 'tag' });
  });

  it('test_coating_finish_field_excludes', () => {
    expect(findSecondaryOp(offerWithTags([MILLING_TAG], 'Anodizing black matt'))?.source).toBe('finish');
  });

  it('test_empty_finish_keeps', () => {
    expect(findSecondaryOp(offerWithTags([MILLING_TAG]))).toBeNull();
  });

  it('test_finishing_context_required_for_tags', () => {
    expect(findSecondaryOp(offerWithTags([{ id: 999, name: 'Chrome plating', context: 'production_risks' }]))).toBeNull();
  });

  it.each(['Grinding flat', 'Heat treatment', 'Case Harden', 'Marking'])('test_borderline_kept_by_default [%s]', (name) => {
    expect(findSecondaryOp(offerWithTags([{ id: 184, name, context: 'production_method_features' }]))).toBeNull();
  });

  it('test_borderline_flip_to_exclude', () => {
    expect(findSecondaryOp(offerWithTags([GRINDING_TAG]), { borderlineExclude: ['grinding'] })?.op_name).toBe('Grinding flat');
  });

  it('test_secondary_beats_borderline_on_other_parts', () => {
    const offer = parseJobOffer(makeOffer(undefined, { parts: [makePart({ tags: [GRINDING_TAG] }), makePart({ tags: [ANODIZING_TAG] })] }));
    expect(findSecondaryOp(offer)?.op_name).toBe('Anodizing type II');
  });
});

describe('TestExtractSpec', () => {
  it('test_full_spec', () => {
    const offer = parseJobOffer(makeOffer(undefined, { parts: [makePart({ tags: [MILLING_TAG, TOLERANCE_TAG, RA_TAG, THREAD_RISK_TAG], measurementProtocolNeeded: true, samplesNeeded: true })] }));
    const spec = extractSpec(offer);
    expect(spec.tolerance).toBe('ISO 2768: medium (mK)');
    expect(spec.roughness).toBe('Ra: 3.2 (Standard)');
    expect(spec.inspection_needed).toBe(true);
    expect(spec.flags).toContain('samples_needed');
    expect(spec.flags).toContain('threads_flagged_partner');
    expect(spec.flags).toContain('risk:Threads at risk');
  });

  it('test_borderline_flagged_not_excluded', () => {
    const spec = extractSpec(offerWithTags([GRINDING_TAG, HEAT_TAG]));
    expect(spec.flags).toContain('borderline:Grinding flat');
    expect(spec.flags).toContain('borderline:Heat treatment');
  });

  it('test_multi_part_flag', () => {
    const offer = parseJobOffer(makeOffer(undefined, { parts: [makePart(), makePart({ code: 'P-2' })] }));
    expect(extractSpec(offer).flags).toContain('multi_part');
  });

  it('test_unmapped_finish_flag', () => {
    const spec = extractSpec(offerWithTags([MILLING_TAG], 'Brushed'));
    expect(spec.finish).toBe('Brushed');
    expect(spec.flags).toContain('finish_unmapped:Brushed');
  });

  it('test_tolerance_variants', () => {
    for (const name of ['Tolerance: \u00b1 0.500 mm', 'ISO 2768: coarse', 'Tol.grade: 5 / ISO 286-1']) {
      expect(extractSpec(offerWithTags([{ id: 1, name, context: 'production_method_features' }])).tolerance).toBe(name);
    }
  });
});

describe('TestFileKind', () => {
  it('test_step_is_instant', () => {
    expect(fileKind(['bracket.step'])).toBe('instant');
    expect(fileKind(['BRACKET.STP', 'drawing.pdf'])).toBe('instant');
  });

  it('test_pdf_only_is_manual', () => {
    expect(fileKind(['drawing.pdf'])).toBe('manual');
    expect(fileKind(['model.dwg', 'spec.pdf'])).toBe('manual');
  });

  it('test_dxf_only_flagged_separately', () => {
    expect(fileKind(['plate.dxf'])).toBe('dxf_only');
  });

  it('test_no_files', () => {
    expect(fileKind([])).toBe('none');
  });

  it('test_pick_prefers_step', () => {
    expect(pickQuoteFile(['/d/a.stl', '/d/b.step', '/d/c.pdf'])).toBe('/d/b.step');
    expect(pickQuoteFile(['/d/a.stl'])).toBe('/d/a.stl');
    expect(pickQuoteFile(['/d/c.pdf', '/d/p.dxf'])).toBeNull();
  });
});

describe('Python regular-expression behaviours (answers of CPython 3.11 re, measured)', () => {
  it('IGNORECASE folds like Python: dotless i, dotted capital I, long s and the Kelvin sign', () => {
    expect(pyMatches(SECONDARY_OP_RE, 'anod\u0131z')).toBe(true);
    expect(pyMatches(SECONDARY_OP_RE, 'ANOD\u0130Z')).toBe(true);
    expect(pyMatches(SECONDARY_OP_RE, '\u017fandblast')).toBe(true);
    expect(pyMatches(SECONDARY_OP_RE, 'pas\u017fivat')).toBe(true);
    expect(pyMatches(SECONDARY_OP_RE, 'BLA\u017fT')).toBe(false);
    expect(pyMatches(BORDERLINE_RE, 'mar\u212aing')).toBe(true);
    // Without the dotless-i mapping the JavaScript engine alone would not match.
    expect(SECONDARY_OP_RE.test('anod\u0131z')).toBe(false);
  });

  it('\\b after "ra" is Unicode-aware and \\s is Python\'s isspace() set', () => {
    const cases: Array<[string, boolean]> = [
      ['Ra 1', true],
      ['ra_1', false],
      ['Ra\u00e9', false],
      ['Ra\u0301', true],
      ['Ra1', false],
      ['Ra-1', true],
      ['Ra\u00b2', false],
      ['Ra\u2163', false],
      ['Ra\u3007', false],
      ['\u00a0ra x', true],
      ['\u200bra x', false],
      ['\ufeffra x', false],
      ['\x1cra x', true],
      ['Ra:', true],
    ];
    for (const [text, expected] of cases) expect(pyMatches(ROUGHNESS_RE, text), JSON.stringify(text)).toBe(expected);
  });

  it('TOLERANCE_RE takes any isspace() character between iso and 2768', () => {
    expect(pyMatches(TOLERANCE_RE, 'ISO\u30002768')).toBe(true);
    expect(pyMatches(TOLERANCE_RE, 'ISO\u200b2768')).toBe(false);
  });

  it('PurePosixPath.suffix: last segment, no suffix for a leading or trailing dot', () => {
    expect(posixSuffix('dir/a.iges')).toBe('.iges');
    expect(posixSuffix('.step')).toBe('');
    expect(posixSuffix('file.')).toBe('');
    expect(posixSuffix('weird..step')).toBe('.step');
    expect(posixSuffix('a.step/')).toBe('.step');
    expect(posixSuffix('a/..')).toBe('');
    expect(posixSuffix('')).toBe('');
  });
});
