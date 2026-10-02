// Loads the slug maps the URL generator needs, compiled with esbuild the way
// tests/middleware/smoke.mjs does, so URLs are built with the same code as the
// SEO handler (middleware/slugs.ts) and the prerender list (vite.config.ts).
//
// vite.config.ts is evaluated with its imports (`vite`, the React plugin,
// `lovable-tagger`, `path`) replaced by inert stubs, and with its private
// `SLUGS`, `LANGUAGES` and `buildPrerenderRoutes` re-exported. Nothing of the
// Vite build runs: the default export is a function that is never called.
// The bundle is imported from a data: URL; no file is written.

import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const VITE_STUBS = new Set(['vite', '@vitejs/plugin-react-swc', 'lovable-tagger', 'path']);

export async function loadSources(root) {
  const viteConfig = path.join(root, 'vite.config.ts');
  const entry = [
    `export { SLUGS, localizedPath, localizedContentSlug, resolvePageType } from ${JSON.stringify(path.join(root, 'middleware/slugs.ts'))};`,
    `export { LANGUAGES, DEFAULT_IMAGE, SITE_BASE, CONTENT_PAGE_SLUGS, SERVICE_IDS } from ${JSON.stringify(path.join(root, 'middleware/types.ts'))};`,
    'export { SLUGS as VITE_SLUGS, LANGUAGES as VITE_LANGUAGES, buildPrerenderRoutes } from "parity:vite-config";',
  ].join('\n');
  const plugin = {
    name: 'parity-vite-config',
    setup(b) {
      b.onResolve({ filter: /^parity:vite-config$/ }, () => ({ path: viteConfig, namespace: 'vite-config' }));
      b.onLoad({ filter: /.*/, namespace: 'vite-config' }, () => ({
        contents: `${readFileSync(viteConfig, 'utf8')}\nexport { SLUGS, LANGUAGES, buildPrerenderRoutes };\n`,
        loader: 'ts',
        resolveDir: root,
      }));
      b.onResolve({ filter: /.*/ }, (args) => {
        if (args.importer === viteConfig) {
          if (VITE_STUBS.has(args.path)) return { path: args.path, namespace: 'stub' };
          return { path: args.path, external: true };
        }
        return undefined;
      });
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'const stub = () => null; export default stub; export const defineConfig = (c) => c; export const loadEnv = () => ({}); export const componentTagger = stub;',
        loader: 'js',
      }));
    },
  };
  const result = await build({
    stdin: { contents: entry, resolveDir: root, loader: 'ts', sourcefile: 'parity-sources.ts' },
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'neutral',
    write: false,
    logLevel: 'silent',
    loader: { '.json': 'json' },
    plugins: [plugin],
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
