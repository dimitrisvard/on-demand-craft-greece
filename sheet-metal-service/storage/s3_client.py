"""
S3 / Supabase Storage client — DOWNLOAD only.

Supports three download methods:
  1. Pre-signed URL (just HTTP GET)
  2. Supabase Storage REST API (with service-role key)
  3. S3-compatible API via boto3

Files are downloaded to a temp directory and the path is returned.
Output files (PDF, DXF, SVG) are NEVER uploaded — they are streamed directly
to the client.
"""

from __future__ import annotations

import os
import tempfile
import logging
from typing import Optional

import httpx

from config import (
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_S3_ACCESS_KEY,
    SUPABASE_S3_SECRET_KEY,
    S3_BUCKET,
    S3_REGION,
)

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3
_BACKOFF = [1.0, 2.0, 4.0]


async def download_file(
    file_url: Optional[str] = None,
    storage_path: Optional[str] = None,
    dest_dir: Optional[str] = None,
    file_name: Optional[str] = None,
) -> str:
    """
    Download a STEP file and return the local path.

    Exactly one of *file_url* or *storage_path* must be provided.

    Parameters
    ----------
    file_url : str, optional
        Pre-signed or direct URL to the file.
    storage_path : str, optional
        Path within the Supabase Storage bucket (e.g. "rfq/abc/part.step").
    dest_dir : str, optional
        Local directory to save the file. Defaults to a new tmpdir.
    file_name : str, optional
        Override the filename (defaults to last path segment).

    Returns
    -------
    str – Absolute path to the downloaded file.

    Raises
    ------
    ValueError – If no source is specified.
    RuntimeError – If download fails after retries.
    """
    if not file_url and not storage_path:
        raise ValueError("Either file_url or storage_path must be provided")

    if dest_dir is None:
        dest_dir = tempfile.mkdtemp(prefix="smetal_")

    # Resolve URL
    url = file_url
    headers = {}

    if not url and storage_path:
        if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
            # Use Supabase REST API
            url = (
                f"{SUPABASE_URL}/storage/v1/object/{S3_BUCKET}/{storage_path}"
            )
            headers["Authorization"] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
        else:
            raise RuntimeError(
                "Cannot download from storage_path: SUPABASE_URL and "
                "SUPABASE_SERVICE_ROLE_KEY must be set"
            )

    # Determine filename
    if not file_name:
        file_name = (storage_path or url or "part.step").split("/")[-1].split("?")[0]
    dest_path = os.path.join(dest_dir, file_name)

    # Download with retry
    last_error: Optional[Exception] = None
    async with httpx.AsyncClient(timeout=60.0) as client:
        for attempt in range(_MAX_RETRIES):
            try:
                resp = await client.get(url, headers=headers, follow_redirects=True)
                resp.raise_for_status()

                content = resp.content
                if len(content) == 0:
                    raise RuntimeError("Downloaded file is empty")

                with open(dest_path, "wb") as f:
                    f.write(content)

                logger.info("Downloaded %s (%d bytes)", file_name, len(content))
                return dest_path

            except httpx.HTTPStatusError as e:
                last_error = e
                status = e.response.status_code
                if status == 401:
                    raise RuntimeError(
                        "S3/Supabase authentication failed (401). "
                        "Check SUPABASE_SERVICE_ROLE_KEY."
                    ) from e
                if status == 403:
                    raise RuntimeError(
                        "S3/Supabase access denied (403). "
                        "Check bucket permissions and RLS policies."
                    ) from e
                if status == 404:
                    raise RuntimeError(
                        f"File not found (404): {storage_path or url}"
                    ) from e
                logger.warning(
                    "Download attempt %d failed: HTTP %d", attempt + 1, status
                )
            except Exception as e:
                last_error = e
                logger.warning(
                    "Download attempt %d failed: %s", attempt + 1, e
                )

            if attempt < _MAX_RETRIES - 1:
                import asyncio
                await asyncio.sleep(_BACKOFF[attempt])

    raise RuntimeError(
        f"Failed to download file after {_MAX_RETRIES} attempts: {last_error}"
    )


def validate_step_file(path: str) -> bool:
    """Quick validation that a file looks like a STEP file."""
    try:
        with open(path, "rb") as f:
            header = f.read(256)
        # STEP files start with "ISO-10303-21" or contain it near the top
        return b"ISO-10303-21" in header or b"STEP" in header.upper()
    except Exception:
        return False
