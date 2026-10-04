// Types for the unchanged Vercel handlers in <repo>/api/*.js that microns-ops loads lazily through the shim
// (workers/shared/src/compat/vercel-node.ts). The wildcards keep tsconfig free of allowJs: wrangler (esbuild)
// bundles the JS files, but they are never type-checked here. The signature matches VercelHandler.

declare module '*/api/marketing.js' {
  const handler: (req: any, res: any) => unknown;
  export default handler;
}

declare module '*/api/notifications.js' {
  const handler: (req: any, res: any) => unknown;
  export default handler;
}

declare module '*/api/gsc.js' {
  const handler: (req: any, res: any) => unknown;
  export default handler;
}

declare module '*/api/tenders.js' {
  const handler: (req: any, res: any) => unknown;
  export default handler;
}

declare module '*/api/tender-scan.js' {
  const handler: (req: any, res: any) => unknown;
  export default handler;
}

declare module '*/api/funded-startups.js' {
  const handler: (req: any, res: any) => unknown;
  export default handler;
}

declare module '*/api/scrape-website.js' {
  const handler: (req: any, res: any) => unknown;
  export default handler;
}

declare module '*/api/scrape-company-profile.js' {
  const handler: (req: any, res: any) => unknown;
  export default handler;
}

declare module '*/api/scan-directory.js' {
  const handler: (req: any, res: any) => unknown;
  export default handler;
}
