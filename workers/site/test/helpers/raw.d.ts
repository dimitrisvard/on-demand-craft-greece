// Vite's ?raw suffix: the file's text as a string (used by the tests for fixtures and source files).
declare module '*?raw' {
  const content: string;
  export default content;
}
