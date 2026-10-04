// Limits the gate attaches to an allowed /api/s3 request; the files API applies them without changing any
// response shape for callers that respect them.

export interface FileConstraints {
  /** true: the caller is staff; none of the optional limits below apply (maxExpiresIn still does). */
  staff: boolean;
  /** Upper bound for a presigned download's expiresIn, in seconds. */
  maxExpiresIn: number;
  /** presign-upload must not target an existing key. */
  noOverwrite: boolean;
  /** Most objects allowed under the first prefix segment. */
  maxObjectsUnderPrefix?: number;
  /** Allowed file extensions (lower case, without the dot). */
  extensionAllowList?: readonly string[];
  /** Largest declared upload size, in bytes. */
  maxSizeBytes?: number;
  /** Allowed delete-folder prefixes. */
  folderPrefixPattern?: RegExp;
}

export const NO_FILE_CONSTRAINTS: FileConstraints = { staff: true, maxExpiresIn: 3600, noOverwrite: false };
