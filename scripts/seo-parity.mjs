#!/usr/bin/env node
// SEO parity diff tool — docs/migration/SEO_PARITY.md §5.
// Thin entry; the tool lives in scripts/seo-parity/ with its own package
// (install once: npm ci --prefix scripts/seo-parity; tests:
// npm --prefix scripts/seo-parity test).
import { main } from './seo-parity/lib/cli.mjs';

process.exitCode = await main();
