// The CAD Container's configuration agrees across files (unit D5): wrangler.jsonc (containers stanza, binding,
// migration, CAD_SLOTS = max_instances = the cad-jobs consumer concurrency, CAD_BACKEND_DEFAULT still "vps"), the
// class (port = the image's port), the Dockerfile (amd64 base pinned by digest, locked dependencies,
// PYTHONHASHSEED=0, the service command on port 8000), the lock file (exact pins only) and the image workflow
// (actions pinned by commit, push only after the cad-release approval).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAD_SERVICE_PORT } from '../../../src/cad-container/cad-container';
import { DEFAULT_CAD_SLOTS, slotCount } from '../../../src/cad-container/slots';

const OPS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ROOT = path.resolve(OPS, '../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

/** JSON with comments (line and block comments outside strings). */
function jsonc(text: string): any {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') out += text[++i];
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

describe('wrangler.jsonc of microns-ops', () => {
  const cfg = jsonc(read('workers/ops/wrangler.jsonc'));

  it('one container application microns-cad of class CadContainer, standard-1, image by registry tag', () => {
    expect(cfg.containers).toHaveLength(1);
    const c = cfg.containers[0];
    expect(c).toMatchObject({ name: 'microns-cad', class_name: 'CadContainer', instance_type: 'standard-1' });
    expect(c.image).toMatch(/^registry\.cloudflare\.com\/[^/]+\/microns-cad:[^/\s]+$/);
    expect(c.image).not.toMatch(/Dockerfile|\.\//);
    expect(c).not.toHaveProperty('constraints');
  });

  it('CAD_SLOTS = max_instances = the cad-jobs consumer concurrency; the slot helpers read the same count', () => {
    const max = cfg.containers[0].max_instances;
    expect(max).toBe(3);
    expect(cfg.vars.CAD_SLOTS).toBe(String(max));
    expect(slotCount({ CAD_SLOTS: cfg.vars.CAD_SLOTS })).toBe(max);
    expect(DEFAULT_CAD_SLOTS).toBe(max);
    expect(cfg.queues.consumers.find((q: { queue: string }) => q.queue === 'cad-jobs').max_concurrency).toBe(max);
  });

  it('binding CAD_CONTAINER, migration v2 with CadContainer, CAD vars, CAD_BACKEND_DEFAULT still vps', () => {
    expect(cfg.durable_objects.bindings).toContainEqual({ name: 'CAD_CONTAINER', class_name: 'CadContainer' });
    expect(cfg.migrations.find((m: { tag: string }) => m.tag === 'v2').new_sqlite_classes).toContain('CadContainer');
    expect(cfg.vars).toMatchObject({ CAD_BACKEND_DEFAULT: 'vps', CAD_PROCESSING_TIMEOUT_S: '120', CAD_KEEP_WARM: 'off' });
    expect(typeof cfg.vars.CAD_INPUT_HOSTS).toBe('string');
    expect(cfg.vars).not.toHaveProperty('CAD_CONTAINER_BASE_URL');
  });
});

describe('the image', () => {
  const dockerfile = read('sheet-metal-service/Dockerfile');
  const lock = read('sheet-metal-service/requirements.lock.txt');

  it('amd64 base pinned by digest, locked dependencies, PYTHONHASHSEED=0, the service on the class port', () => {
    expect(dockerfile).toMatch(/^FROM --platform=linux\/amd64 python:3\.11-slim@sha256:[0-9a-f]{64}$/m);
    expect(dockerfile.match(/^FROM /gm)).toHaveLength(1);
    expect(dockerfile).toMatch(/^ENV PYTHONHASHSEED=0$/m);
    expect(dockerfile).toMatch(/^COPY requirements\.lock\.txt \.$/m);
    expect(dockerfile).toMatch(/^RUN pip install --no-cache-dir -r requirements\.lock\.txt$/m);
    expect(dockerfile).not.toMatch(/-r requirements\.txt/);
    expect(dockerfile).toContain(`EXPOSE ${CAD_SERVICE_PORT}`);
    expect(dockerfile).toContain(`CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "${CAD_SERVICE_PORT}"]`);
    expect(dockerfile).toContain("httpx.get('http://localhost:8000/health')");
  });

  it('the lock file pins every package exactly and holds the service libraries (no test tools)', () => {
    const pins = lock.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'));
    expect(pins.length).toBeGreaterThan(50);
    for (const p of pins) expect(p, p).toMatch(/^[A-Za-z0-9_.-]+==[A-Za-z0-9_.+-]+$/);
    const names = pins.map((p) => p.split('==')[0].toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const want of ['cadquery', 'cadquery-ocp', 'ezdxf', 'fastapi', 'uvicorn', 'httpx', 'reportlab', 'numpy']) expect(names, want).toContain(want);
    expect(names).not.toContain('pytest');
  });
});

describe('.github/workflows/cad-image.yml', () => {
  const wf = read('.github/workflows/cad-image.yml');

  it('every action is pinned by commit; the push job runs only on a dispatch with push, in environment cad-release', () => {
    const uses = [...wf.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThanOrEqual(4);
    for (const u of uses) expect(u, u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    expect(wf).toMatch(/\n {2}push:\n(?:.*\n)*? {4}if: github\.event_name == 'workflow_dispatch' && inputs\.push\n/);
    expect(wf).toMatch(/\n {4}environment: cad-release\n/);
    expect(wf).toContain('npx --yes wrangler@4.145.0 containers push');
    expect(wf).toContain('docker build --platform linux/amd64');
    expect(wf).toContain('cad_parity.py check');
    expect(wf).toContain('PROCESSING_TIMEOUT=0.05');
  });
});
