import type { PartFileRef } from './types';

/**
 * Placeholder slot for the existing Microns Hub STEP→GLB Three.js viewer (§2).
 * Swap the file list below for the real viewer component; `files[].downloadUrl`
 * are Xometry-hosted CAD/drawing links, `localPaths` are the worker's copies.
 */
export function PartViewer({
  files,
  localPaths,
}: {
  files: PartFileRef[];
  localPaths: string[];
}) {
  return (
    <div className="rounded border border-dashed border-gray-300 p-3 text-sm">
      <p className="font-medium text-gray-700">
        Part files{' '}
        <span className="font-normal text-gray-400">
          (TODO: mount the Microns Hub STEP viewer here)
        </span>
      </p>
      <ul className="mt-2 list-inside list-disc text-gray-600">
        {files.map((f) => (
          <li key={f.name}>
            {f.downloadUrl ? (
              <a
                className="text-blue-600 underline"
                href={f.downloadUrl}
                target="_blank"
                rel="noreferrer"
              >
                {f.name}
              </a>
            ) : (
              f.name
            )}
          </li>
        ))}
        {files.length === 0 && <li>no files on this offer</li>}
      </ul>
      {localPaths.length > 0 && (
        <p className="mt-2 text-xs text-gray-400">worker copies: {localPaths.join(', ')}</p>
      )}
    </div>
  );
}
