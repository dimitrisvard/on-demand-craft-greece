// Shared code is type-checked inside each Worker's program under that Worker's compilerOptions, so every
// package must use exactly the compilerOptions of workers/site/tsconfig.json (which is frozen).
import { describe, expect, it } from 'vitest';
import siteTsconfig from '../../../site/tsconfig.json';
import sharedPackage from '../../package.json';
import sharedTsconfig from '../../tsconfig.json';
import sharedSrcTsconfig from '../../tsconfig.src.json';
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

  // Test-only type packages (for example svix's) pull in Node's global types, which no Worker program has; the
  // src-only program sees the Worker types alone, as each Worker's own program does.
  it('workers/shared also type-checks src alone, with the same options, as part of `npm run typecheck`', () => {
    expect(sharedSrcTsconfig).toStrictEqual({ extends: './tsconfig.json', include: ['src/**/*.ts'] });
    expect(sharedPackage.scripts.typecheck).toContain('tsc -p tsconfig.src.json --noEmit');
  });
});
