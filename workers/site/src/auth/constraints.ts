// Limits the gate attaches to an allowed /api/s3 request; the files API applies them without changing any
// response shape for callers that respect them.

export interface FileConstraints {
  /** true: the caller is staff; none of the optional limits below apply (maxExpiresIn and, for delete-folder,
   *  folderPrefixPattern still do). */
  staff: boolean;
  /** Upper bound for a presigned download's expiresIn, in seconds: min(Number(expiresIn) || max, max). */
  maxExpiresIn: number;
  /** presign-upload must not target an existing key (R2 and legacy) -> 409 {"error":"exists"}. */
  noOverwrite: boolean;
  /** Most objects allowed under the first prefix segment (R2 + legacy first pages) -> 409 {"error":"limit_reached"}. */
  maxObjectsUnderPrefix?: number;
  /** Allowed file extensions (lower case, without the dot) -> 400 {"error":"file_type_not_allowed"}. */
  extensionAllowList?: readonly string[];
  /** Largest declared upload size in bytes, when body.size is a number -> 400 {"error":"file_too_large"}; a
   *  declared size within the limit is signed as content-length. */
  maxSizeBytes?: number;
  /** Allowed delete-folder prefixes -> 400 {"error":"invalid_prefix"}; the prefix is then listed as
   *  `<prefix without trailing slash>/` on both stores. */
  folderPrefixPattern?: RegExp;
}

/** Longest lifetime of a presigned download URL, for every caller. */
export const MAX_DOWNLOAD_EXPIRES_SEC = 3600;

/** File types a non-staff caller may upload. */
export const UPLOAD_EXTENSIONS: readonly string[] = [
  'step', 'stp', 'iges', 'igs', 'stl', 'dxf', 'dwg', 'pdf', 'png', 'jpg', 'jpeg', 'zip', 'x_t', 'sldprt',
];

/** Largest upload a non-staff caller may declare: 200 MiB. */
export const MAX_UPLOAD_BYTES = 209_715_200;

/** Objects an anonymous caller may place under one RFQ folder. */
export const MAX_ANONYMOUS_OBJECTS = 50;

/** A whole RFQ number or RFQ id, optionally with one trailing slash. */
export const FOLDER_PREFIX_PATTERN = /^(RFQ-\d{8}-\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/;

export const NO_FILE_CONSTRAINTS: FileConstraints = { staff: true, maxExpiresIn: 3600, noOverwrite: false };

/** Staff delete-folder: the prefix shape still applies. */
export const STAFF_FOLDER_CONSTRAINTS: FileConstraints = { ...NO_FILE_CONSTRAINTS, folderPrefixPattern: FOLDER_PREFIX_PATTERN };

/** Signed-in, non-staff caller acting on an RFQ it owns. */
export const CUSTOMER_FILE_CONSTRAINTS: FileConstraints = {
  staff: false,
  maxExpiresIn: MAX_DOWNLOAD_EXPIRES_SEC,
  noOverwrite: true,
  extensionAllowList: UPLOAD_EXTENSIONS,
  maxSizeBytes: MAX_UPLOAD_BYTES,
};

/** Anonymous upload to a freshly created RFQ. */
export const ANONYMOUS_FILE_CONSTRAINTS: FileConstraints = {
  ...CUSTOMER_FILE_CONSTRAINTS,
  maxObjectsUnderPrefix: MAX_ANONYMOUS_OBJECTS,
};
