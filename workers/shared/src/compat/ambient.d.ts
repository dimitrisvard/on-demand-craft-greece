// Minimal type declarations for the modules the shim core imports that have no types under a tsconfig whose
// `types` lists only @cloudflare/workers-types (as every Worker package here does): the Node built-ins that
// nodejs_compat provides at runtime, and the npm package content-type, which ships no .d.ts.
// Only the members the shared code uses are declared. Modules that import any of them start with
// `/// <reference path="./ambient.d.ts" />`, so every program that imports those modules gets these
// declarations without a tsconfig change.
// No top-level import or export: this file must stay a global script so the blocks below declare modules
// instead of augmenting them.

declare module 'content-type' {
  export interface ParsedMediaType {
    type: string;
    parameters: Record<string, string>;
  }
  export interface MediaType {
    type: string;
    parameters?: Record<string, string>;
  }
  /** Parses a Content-Type value; throws a TypeError when it is malformed. */
  export function parse(input: string | { headers: object } | { getHeader(name: string): unknown }): ParsedMediaType;
  /** Formats a media type; throws a TypeError when it is invalid. */
  export function format(obj: MediaType): string;
}

declare module 'node:querystring' {
  export interface ParsedUrlQuery {
    [key: string]: string | string[] | undefined;
  }
  export interface ParseOptions {
    maxKeys?: number;
    decodeURIComponent?: (value: string) => string;
  }
  export function parse(str: string, sep?: string, eq?: string, options?: ParseOptions): ParsedUrlQuery;
}

declare module 'node:buffer' {
  export type BufferEncoding =
    | 'ascii' | 'utf8' | 'utf-8' | 'utf16le' | 'ucs2' | 'ucs-2'
    | 'base64' | 'base64url' | 'latin1' | 'binary' | 'hex';
  export interface Buffer extends Uint8Array {
    toString(encoding?: BufferEncoding, start?: number, end?: number): string;
    equals(other: Uint8Array): boolean;
  }
  export interface BufferConstructor {
    from(data: string, encoding?: BufferEncoding): Buffer;
    from(data: ArrayBuffer | SharedArrayBuffer, byteOffset?: number, length?: number): Buffer;
    from(data: Uint8Array | ReadonlyArray<number>): Buffer;
    isBuffer(value: unknown): value is Buffer;
    concat(list: ReadonlyArray<Uint8Array>, totalLength?: number): Buffer;
    byteLength(value: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer, encoding?: BufferEncoding): number;
  }
  export const Buffer: BufferConstructor;
}

declare module 'node:crypto' {
  export type BinaryToTextEncoding = 'base64' | 'base64url' | 'hex' | 'binary' | 'latin1';
  export interface Hash {
    update(data: string | Uint8Array, inputEncoding?: 'utf8' | 'utf-8' | 'latin1' | 'binary' | 'ascii'): Hash;
    digest(encoding: BinaryToTextEncoding): string;
    digest(): Uint8Array;
  }
  export function createHash(algorithm: string): Hash;
}
