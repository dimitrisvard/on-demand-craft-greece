"""Configuration constants and defaults for the unfold service."""

# Sheet metal thickness bounds (mm)
MIN_THICKNESS_MM = 0.3
MAX_THICKNESS_MM = 25.0

# Default K-factors by material
K_FACTORS = {
    "Steel": 0.44,
    "Stainless Steel": 0.44,
    "Aluminum": 0.33,
    "Copper": 0.35,
    "Brass": 0.35,
}

# Default K-factor when material is unknown
DEFAULT_K_FACTOR = 0.44

# File size limit (bytes)
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB

# FreeCAD subprocess timeout (seconds)
FREECAD_TIMEOUT = 120

# Rendering settings
ISO_RENDER_WIDTH = 800
ISO_RENDER_HEIGHT = 600
ISO_DPI = 150

# PDF layout constants (A4 landscape in mm)
PDF_PAGE_WIDTH_MM = 297
PDF_PAGE_HEIGHT_MM = 210

# PDF colors (hex)
COLOR_HEADER_BG = "#1B2A4A"
COLOR_ACCENT = "#2E6EA6"
COLOR_TEXT_DARK = "#1A1A2E"
COLOR_TEXT_MEDIUM = "#4A4A5A"
COLOR_BEND_LINE = "#C0392B"
COLOR_TABLE_HEADER = "#1B2A4A"
COLOR_TABLE_ALT_ROW = "#F0F2F5"
COLOR_BORDER = "#D0D5DD"
COLOR_DIMENSION = "#2E6EA6"

# FreeCAD paths
FREECAD_MOD_PATHS = [
    "/usr/lib/freecad/lib",
    "/usr/lib/freecad-python3/lib",
    "/usr/share/freecad/Mod",
    "/usr/lib/freecad/Mod",
]

SHEETMETAL_WB_PATH = "/root/.local/share/FreeCAD/Mod/SheetMetal"

# JSON markers for subprocess communication
JSON_START_MARKER = "===JSON_START==="
JSON_END_MARKER = "===JSON_END==="

# Part color for isometric rendering (steel blue-grey)
PART_COLOR_RGB = (0.69, 0.74, 0.77)  # ~#B0BCC4
