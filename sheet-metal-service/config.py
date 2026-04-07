"""Configuration constants and environment-based settings."""

import os

# ── S3 / Supabase Storage ──────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_S3_ACCESS_KEY = os.getenv("SUPABASE_S3_ACCESS_KEY", "")
SUPABASE_S3_SECRET_KEY = os.getenv("SUPABASE_S3_SECRET_KEY", "")
S3_BUCKET = os.getenv("S3_BUCKET", "rfq-files")
S3_REGION = os.getenv("S3_REGION", "us-east-1")

# Optional API key for authenticating external callers
API_KEY = os.getenv("API_KEY", "")

# ── Sheet metal defaults ───────────────────────────────────────────────────
MIN_THICKNESS_MM = 0.3
MAX_THICKNESS_MM = 25.0

DEFAULT_K_FACTOR = 0.44

K_FACTORS = {
    "mild_steel": 0.33,
    "steel": 0.44,
    "stainless_steel": 0.35,
    "aluminum": 0.33,
    "copper": 0.35,
    "brass": 0.35,
}

# Thickness-dependent K-factor overrides for mild steel
K_FACTORS_BY_THICKNESS = {
    "mild_steel": [(2.0, 0.33), (4.0, 0.38), (float("inf"), 0.40)],
}

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
PROCESSING_TIMEOUT = 120  # seconds

# ── PDF drawing colours (hex) ──────────────────────────────────────────────
COLOR_HEADER_BG = "#1B2A4A"
COLOR_ACCENT = "#2E6EA6"
COLOR_TEXT_DARK = "#1A1A2E"
COLOR_TEXT_MEDIUM = "#4A4A5A"
COLOR_BEND_LINE = "#C0392B"
COLOR_BEND_DOWN_LINE = "#2E6EA6"
COLOR_TABLE_HEADER = "#1B2A4A"
COLOR_TABLE_ALT_ROW = "#F0F2F5"
COLOR_BORDER = "#D0D5DD"
COLOR_DIMENSION = "#2E6EA6"


def get_k_factor(material: str, thickness: float) -> float:
    """Return the K-factor for *material* at *thickness* mm."""
    mat = material.lower().replace(" ", "_").replace("-", "_")
    # Check thickness-dependent table first
    thickness_table = K_FACTORS_BY_THICKNESS.get(mat)
    if thickness_table:
        for max_t, kf in thickness_table:
            if thickness <= max_t:
                return kf
    return K_FACTORS.get(mat, DEFAULT_K_FACTOR)
