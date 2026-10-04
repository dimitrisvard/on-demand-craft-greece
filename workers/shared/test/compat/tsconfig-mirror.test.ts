// Shared code is type-checked inside each Worker's program under that Worker's compilerOptions, so every
// package must use exactly the compilerOptions of workers/site/tsconfig.json (which is frozen).
import { describe, expect, it } from 'vitest';
import siteTsconfig from '../../../site/tsconfig.json';
import sharedTsconfig from '../../tsconfig.json';
import opsTsconfig from '../../../ops/tsconfig.json';

describe('tsconfig mirrors', () => {
  it('workers/shared has the compilerOptions of workers/site', () => {
    expect(sharedTsconfig.compilerOptions).toStrictEqual(siteTsconfig.compilerOptions);
  });

  it('workers/ops has the compilerOptions of workers/site', () => {
    expect(opsTsconfig.compilerOptions).toStrictEqual(siteTsconfig.compilerOptions);
  });

  it('types stay limited to @cloudflare/workers-types (Node built-ins come from src/compat/ambient.d.ts)', () => {
    expect(siteTsconfig.compilerOptions.types).toStrictEqual(['@cloudflare/workers-types']);
  });

  it('each package type-checks its own src and test folders', () => {
    expect(sharedTsconfig.include).toStrictEqual(['src/**/*.ts', 'test/**/*.ts']);
    expect(opsTsconfig.include).toStrictEqual(['src/**/*.ts', 'test/**/*.ts']);
  });
});
