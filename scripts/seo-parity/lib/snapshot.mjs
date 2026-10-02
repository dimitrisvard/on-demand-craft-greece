// Snapshot format (SEO_PARITY.md §5.3): manifest.json, urls.json,
// results.ndjson (one line per request), raw/<sha256>.gz (HTML, XML, TXT and
// JSON bodies, content-addressed). Request headers and Access values are never
// part of any record: the records are built from response data only.

import { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { sha256, UsageError } from './util.mjs';

const STORED_FAMILIES = new Set(['html', 'xml', 'txt', 'json']);

export class BodyStore {
  constructor(dir) {
    this.dir = dir;
    if (dir) mkdirSync(dir, { recursive: true });
    this.memory = new Map();
  }

  /** Store a decoded body when its family is text-like; returns its SHA-256. */
  put(body, family) {
    const h = sha256(body);
    if (!STORED_FAMILIES.has(family)) return h;
    if (this.dir) {
      const f = path.join(this.dir, `${h}.gz`);
      if (!existsSync(f)) writeFileSync(f, zlib.gzipSync(body));
    } else {
      this.memory.set(h, body);
    }
    return h;
  }

  get(h) {
    if (!h) return null;
    if (this.memory.has(h)) return this.memory.get(h);
    if (!this.dir) return null;
    const f = path.join(this.dir, `${h}.gz`);
    if (!existsSync(f)) return null;
    return zlib.gunzipSync(readFileSync(f));
  }
}

export class SnapshotWriter {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.store = new BodyStore(path.join(dir, 'raw'));
    this.out = createWriteStream(path.join(dir, 'results.ndjson'), { encoding: 'utf8' });
    this.lines = 0;
  }

  writeUrls(urlsDoc) {
    const text = `${JSON.stringify(urlsDoc, null, 2)}\n`;
    writeFileSync(path.join(this.dir, 'urls.json'), text);
    return sha256(text);
  }

  /** One line per request (entry × method). */
  writeEntry(entry, record) {
    for (const method of Object.keys(record.methods)) {
      const m = record.methods[method];
      const line = { entry_id: entry.id, url: entry.url, method, ...m };
      this.out.write(`${JSON.stringify(line)}\n`);
      this.lines += 1;
    }
    if (record.not_requested) {
      this.out.write(`${JSON.stringify({ entry_id: entry.id, url: entry.url, method: null, not_requested: record.not_requested })}\n`);
      this.lines += 1;
    }
  }

  async close(manifest) {
    await new Promise((r) => this.out.end(r));
    writeFileSync(path.join(this.dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

export function loadSnapshot(dir) {
  const read = (f) => {
    const p = path.join(dir, f);
    if (!existsSync(p)) throw new UsageError(`snapshot ${dir}: missing ${f}`);
    return readFileSync(p, 'utf8');
  };
  let manifest; let urls;
  try {
    manifest = JSON.parse(read('manifest.json'));
    urls = JSON.parse(read('urls.json'));
  } catch (e) {
    if (e instanceof UsageError) throw e;
    throw new UsageError(`snapshot ${dir}: unreadable (${e.message})`);
  }
  const records = new Map();
  const text = read('results.ndjson');
  let n = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    n += 1;
    let r;
    try { r = JSON.parse(line); } catch { throw new UsageError(`snapshot ${dir}: results.ndjson line ${n} is not JSON`); }
    // The URL is kept: compare modes check that the --urls entry with this id
    // names the same URL and methods (ids are not stable across generations).
    const rec = records.get(r.entry_id) || { url: r.url, methods: {} };
    if (r.method) {
      const { entry_id: _id, url: _u, method, ...m } = r;
      rec.methods[method] = m;
    } else if (r.not_requested) {
      rec.not_requested = r.not_requested;
    }
    records.set(r.entry_id, rec);
  }
  return { dir, manifest, urls, records, store: new BodyStore(path.join(dir, 'raw')) };
}
