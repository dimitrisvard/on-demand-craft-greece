// Type of api/_lib/gsc-client.js (the Search Console module of the Phase 2 /api/gsc route), loaded lazily by the
// remote MCP GSC tools; the JS file is bundled by wrangler and not type-checked here (src/mcp/context.ts GscClient
// describes the functions used).
declare module '*/api/_lib/gsc-client.js' {
  const module: Record<string, unknown>;
  export = module;
}
