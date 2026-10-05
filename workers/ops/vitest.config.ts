// Unit tests (T1) of microns-ops run in Node (vitest). Node cannot load the runtime modules 'cloudflare:workers',
// 'cloudflare:workflows' and 'cloudflare:email', so they resolve to stubs in test/helpers/ (WorkerEntrypoint,
// WorkflowEntrypoint, DurableObject, RpcTarget, env, exports, waitUntil; NonRetryableError; EmailMessage). Files
// outside workers/ops (api/*.js, lib/*, workers/shared) are imported by relative path.
//
// Phase 4 additions
//   - The Agents SDK is inlined (server.deps.inline), so its own imports of 'cloudflare:*' go through the aliases
//     above instead of Node's loader, which rejects that URL scheme.
//   - Plugin wrangler-rules mirrors the `rules` of wrangler.jsonc: a .md import is its text (Text module), a .ttf or
//     .png import is an ArrayBuffer of its bytes (Data module).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';

const helper = (name: string) => fileURLToPath(new URL(`./test/helpers/${name}`, import.meta.url));

/** Text and Data module rules of wrangler.jsonc, for imports in Node. */
export function wranglerRules(): Plugin {
  return {
    name: 'wrangler-rules',
    enforce: 'pre',
    load(id) {
      const file = id.split('?')[0];
      if (file.endsWith('.md')) return `export default ${JSON.stringify(readFileSync(file, 'utf8'))};`;
      if (/\.(ttf|png)$/.test(file)) {
        const base64 = readFileSync(file).toString('base64');
        return [
          `const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), (c) => c.charCodeAt(0));`,
          'export default bytes.buffer;',
        ].join('\n');
      }
      return undefined;
    },
  };
}

export default defineConfig({
  plugins: [wranglerRules()],
  resolve: {
    alias: {
      'cloudflare:workers': helper('cloudflare-workers.ts'),
      'cloudflare:workflows': helper('cloudflare-workflows.ts'),
      'cloudflare:email': helper('cloudflare-email.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    server: { deps: { inline: [/node_modules\/agents\//] } },
  },
});
