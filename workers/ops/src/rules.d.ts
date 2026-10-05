// Module types of the wrangler `rules` in wrangler.jsonc: a .md import is a Text module (its text), a .ttf or .png
// import is a Data module (its bytes). vitest.config.ts mirrors the same rules for T1 tests (plugin
// wrangler-rules). No top-level import or export: this file stays a global script so these blocks declare modules.

declare module '*.md' {
  const text: string;
  export default text;
}

declare module '*.ttf' {
  const bytes: ArrayBuffer;
  export default bytes;
}

declare module '*.png' {
  const bytes: ArrayBuffer;
  export default bytes;
}
