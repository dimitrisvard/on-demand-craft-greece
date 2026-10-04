// Types for the unchanged Vercel handlers in <repo>/api/*.js that the Worker imports through a shim
// (sitemap: src/compat/vercel-shim.ts; emails and marketing: workers/shared/src/compat/vercel-node.ts). The
// wildcards keep tsconfig free of allowJs, so the JS files are bundled by wrangler (esbuild) but never
// type-checked here. The signature matches VercelHandler in both shims.

declare module '*/api/sitemap.js' {
  const handler: (req: unknown, res: unknown) => unknown;
  export default handler;
}

// Imported lazily by src/api/emails.ts.
declare module '*/api/emails.js' {
  const handler: (req: any, res: any) => unknown;
  export default handler;
}

// Imported lazily by src/api/track.ts (only the track branch runs in this Worker).
declare module '*/api/marketing.js' {
  const handler: (req: any, res: any) => unknown;
  export default handler;
}
