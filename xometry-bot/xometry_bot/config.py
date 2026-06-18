"""Central configuration: every knob, preset, regex and mapping in one place.

Facts below marked "captured" were read from the live, authenticated Xometry
portals on 11 Jun 2026. Anything marked TODO(confirm) still needs a one-time
live confirmation — the code treats those as gated seams and never guesses
past them.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

# --- Endpoints (captured, §1) -------------------------------------------------
PARTNER_GRAPHQL_URL = "https://api.xometry.eu/partners/graphql"
PARTNER_OFFER_URL = "https://partner.xometry.eu/offers/{offer_id}?gsh=true&source=jobs"
PARTNER_PORTAL_URL = "https://partner.xometry.eu"
BUYER_APP_URL = "https://get.xometry.eu"
BUYER_NEW_QUOTE_URL = "https://get.xometry.eu/quotes/new"


# --- Saved filters / presets (tag ids captured from the live account, §1A) ----
@dataclass(frozen=True)
class Preset:
    name: str
    include: frozenset[int]
    exclude: frozenset[int] = frozenset()


PRESETS: dict[str, Preset] = {
    # "milonk" (preset id 864): Milling / Turning / EDM / CNC / Milling 5 axes /
    # Milling mass / Turning 2+ axes / Turning Automat
    "milonk": Preset("milonk", frozenset({14, 10, 84, 123, 20, 295, 16, 22})),
    # "Laser" (preset id 831): Laser Cutting / Waterjet / Bending Sheet / Sheet.
    # Documented for reference but OFF — do not add it to ACTIVE_PRESETS.
    "laser": Preset("laser", frozenset({36, 39, 34, 124})),
}

# Per Dimitris: run "milonk" only (§1A / §8.1).
ACTIVE_PRESETS: tuple[str, ...] = ("milonk",)

# --- Scan filter (captured, §1A) ----------------------------------------------
SCAN_FILTER: dict[str, str] = {"urgentStatus": "without_urgent", "responseStatus": "empty"}
SCAN_PAGE_LIMIT = 20
SCAN_MAX_PAGES = 100  # hard safety cap on pagination
# TODO(confirm): the urgent-tab enum (likely "only_urgent"/"with_urgent") — read it off one
# DevTools request, set URGENT_FILTER_ENUM, then flip SCAN_URGENT_TAB to True.
SCAN_URGENT_TAB = False
URGENT_FILTER_ENUM = "TODO(confirm)"

# --- Secondary-operation exclusion (§1C) --------------------------------------
# Default SECONDARY_OP regex, verbatim from the captured spec. Tag *names* (and the
# part `finish` string) are the source of truth.
SECONDARY_OP_RE = re.compile(
    r"anodiz|powder coat|coating|plating|galvan|sandblast|bead blast|glass bead|"
    r"spray paint|wet paint|painting|dyed|finish color|passivat|phosphat|chrome|"
    r"cadmium|electropolish|tumbl|barrel polish|vapor polish",
    re.IGNORECASE,
)

# Captured finishing/coating tag ids — reference only (names decide; ids documented
# so a future name drift is easy to cross-check against the original capture).
SECONDARY_OP_TAG_IDS: frozenset[int] = frozenset(
    {
        86, 87, 88, 89, 90, 94, 104, 105, 106, 107, 112, 116, 117, 118, 119, 122,
        135, 136, 137, 138, 139, 140, 141, 143, 162, 163, 484, 489, 490, 520, 544,
        653, 675, 680, 681, 682, 683, 684, 685, 686, 687, 688, 689, 690, 691, 692,
        693, 696, 697, 698,
    }
)

# Borderline machining/material ops a CNC shop often does in-house (§1C):
# Grinding flat/Round (184/185/186), Heat treatment*/Case Harden (102/120/121),
# Marking* (18/130). Default = KEEP and flag; flip keywords into
# XB_BORDERLINE_EXCLUDE to exclude instead.
BORDERLINE_RE = re.compile(r"grinding|heat treat|case harden|marking", re.IGNORECASE)

# --- Buyer instant-quote file formats (§1B) ------------------------------------
# DXF is instant for flat-cut only — useless for the CNC preset, treated as manual.
INSTANT_QUOTE_EXTS: frozenset[str] = frozenset(
    {
        ".step", ".stp", ".sldprt", ".stl", ".sat", ".3dxml", ".3mf", ".prt",
        ".ipt", ".catpart", ".x_t", ".ptc", ".dxf", ".x_b",
    }
)
MANUAL_ONLY_EXTS: frozenset[str] = frozenset({".pdf", ".dwg", ".dwf", ".dws"})
PREFERRED_QUOTE_EXTS: tuple[str, ...] = (".step", ".stp")

# --- Pricing & lead time (§6A) --------------------------------------------------
DISCOUNT = 0.20        # counteroffer at buyer_price * (1 - DISCOUNT)
MIN_MARGIN = 0.15      # floor multiplier on your cost
LEADTIME_BUSINESS_DAYS = 10
# buyer_price / partner_cost outside this range -> flag price_implausible (§7).
PLAUSIBLE_BUYER_TO_PARTNER_RATIO: tuple[float, float] = (0.8, 5.0)

# --- Buyer quote spec mappings (§5.5) -------------------------------------------
# Partner spec string -> get.xometry.eu dropdown label. Exact label match is tried
# first; anything unmapped flags `config_mismatch` -> needs_review (never trust a
# mismatched price). TODO(confirm): extend from the first live quotes.
MATERIAL_MAP: dict[str, str] = {}
TOLERANCE_MAP: dict[str, str] = {}
ROUGHNESS_MAP: dict[str, str] = {}

# --- Partner counteroffer form (§6C) --------------------------------------------
# TODO(confirm) on first submit: EU portal date format and decimal separator.
PARTNER_FORM_DATE_FORMAT = "%d.%m.%Y"
PARTNER_FORM_EXPECTED_CHECKBOXES = 3  # captured: produce-confirmation, T&C, NDA


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_path(name: str, default: str) -> Path:
    return Path(os.environ.get(name, default)).expanduser()


@dataclass
class Settings:
    """Runtime settings, env-only (12-factor). See .env.example."""

    db_dsn: str
    partner_auth_token: str | None
    partner_cookie: str | None
    review_api_token: str
    data_dir: Path
    buyer_profile_dir: Path
    partner_profile_dir: Path
    enable_buyer_pricing: bool
    buyer_selectors_confirmed: bool
    headless: bool
    borderline_exclude: frozenset[str]
    # Download CAD/drawing files locally during the scan. Needed only by the
    # Phase-2 buyer pricer; off in serverless/CI runs (the dashboard links to
    # Xometry's own downloadUrl). Defaults True so existing deployments/tests
    # keep their behaviour.
    download_files: bool = True

    @classmethod
    def from_env(cls) -> Settings:
        borderline = frozenset(
            k.strip().lower()
            for k in os.environ.get("XB_BORDERLINE_EXCLUDE", "").split(",")
            if k.strip()
        )
        return cls(
            db_dsn=os.environ.get("XB_DB_DSN", ""),
            partner_auth_token=os.environ.get("XB_PARTNER_AUTH_TOKEN") or None,
            partner_cookie=os.environ.get("XB_PARTNER_COOKIE") or None,
            review_api_token=os.environ.get("XB_REVIEW_API_TOKEN", ""),
            data_dir=_env_path("XB_DATA_DIR", "./data"),
            buyer_profile_dir=_env_path("XB_BUYER_PROFILE_DIR", "~/.xometry-bot/buyer-profile"),
            partner_profile_dir=_env_path(
                "XB_PARTNER_PROFILE_DIR", "~/.xometry-bot/partner-profile"
            ),
            enable_buyer_pricing=_env_bool("XB_ENABLE_BUYER_PRICING", False),
            buyer_selectors_confirmed=_env_bool("XB_BUYER_SELECTORS_CONFIRMED", False),
            headless=_env_bool("XB_HEADLESS", True),
            borderline_exclude=borderline,
            download_files=_env_bool("XB_DOWNLOAD_FILES", True),
        )

    @property
    def files_dir(self) -> Path:
        return self.data_dir / "files"

    @property
    def screenshots_dir(self) -> Path:
        return self.data_dir / "screenshots"
