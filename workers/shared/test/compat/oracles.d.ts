// Types for the npm packages the tests use as oracles (devDependencies without their own type declarations).

declare module 'etag' {
  function etag(entity: string | Uint8Array, options?: { weak?: boolean }): string;
  export default etag;
}
