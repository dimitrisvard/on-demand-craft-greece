// Types for the unchanged Vercel handlers in <repo>/api/*.js that the Worker imports through the shim
// (src/compat/vercel-shim.ts). The wildcard keeps tsconfig free of allowJs, so the JS files are bundled by
// wrangler (esbuild) but never type-checked here. The signature matches VercelHandler in vercel-shim.ts.

declare module '*/api/sitemap.js' {
  const handler: (req: unknown, res: unknown) => unknown;
  export default handler;
}
