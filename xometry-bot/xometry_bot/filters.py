"""Preset matching, secondary-operation exclusion and spec extraction (§1C, §4).

The exclusion decides whether a job is even quotable by a no-coating CNC shop;
spec extraction pulls tolerance/Ra/finish/inspection out of the part tags so the
buyer quote can be configured to match (and the price be truly comparable).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import PurePosixPath

from . import config
from .models import JobOffer

METHODS_CTX = "production_methods"
FEATURES_CTX = "production_method_features"
MATERIALS_CTX = "materials"
RISKS_CTX = "production_risks"

TOLERANCE_RE = re.compile(r"tolerance|iso\s*2768|tol\.?\s*grade|iso\s*286|±", re.IGNORECASE)
ROUGHNESS_RE = re.compile(r"^\s*ra\b", re.IGNORECASE)
THREAD_RISK_RE = re.compile(
    r"thread rolling|deep drilling|threads at risk|deep small-dia drill", re.IGNORECASE
)


def matches_preset(offer: JobOffer, preset: config.Preset) -> bool:
    """Keep an offer iff any part tag id ∈ include and none ∈ exclude (§1A)."""
    ids = {t.id for p in offer.parts for t in p.tags}
    return bool(ids & preset.include) and not (ids & preset.exclude)


def matches_any_active_preset(
    offer: JobOffer, active: tuple[str, ...] = config.ACTIVE_PRESETS
) -> bool:
    return any(matches_preset(offer, config.PRESETS[name]) for name in active)


@dataclass(frozen=True)
class SecondaryOpHit:
    op_name: str
    source: str  # "tag" | "finish"


def find_secondary_op(
    offer: JobOffer, *, borderline_exclude: frozenset[str] = frozenset()
) -> SecondaryOpHit | None:
    """First finishing/coating op that excludes this job, or None to keep it (§1C).

    Borderline ops (grinding / heat treatment / case harden / marking) are kept by
    default — they only exclude if the operator listed a keyword in
    `borderline_exclude`. Everything matching SECONDARY_OP_RE excludes.
    """
    for part in offer.parts:
        for tag in part.tags:
            if tag.context != FEATURES_CTX:
                continue
            if config.BORDERLINE_RE.search(tag.name):
                if any(k in tag.name.lower() for k in borderline_exclude):
                    return SecondaryOpHit(tag.name, "tag")
                continue  # borderline default = keep (flagged in extract_spec)
            if config.SECONDARY_OP_RE.search(tag.name):
                return SecondaryOpHit(tag.name, "tag")
        if part.finish and config.SECONDARY_OP_RE.search(part.finish):
            return SecondaryOpHit(part.finish, "finish")
    return None


@dataclass
class Spec:
    tolerance: str | None = None
    roughness: str | None = None
    finish: str | None = None
    inspection_needed: bool = False
    flags: list[str] = field(default_factory=list)


def extract_spec(offer: JobOffer) -> Spec:
    """Tolerance / Ra / finish / inspection + advisory flags for a surviving offer (§1C)."""
    spec = Spec()
    flags: list[str] = []
    for part in offer.parts:
        if part.measurement_protocol_needed:
            spec.inspection_needed = True
        if part.samples_needed:
            flags.append("samples_needed")
        if part.finish and spec.finish is None:
            spec.finish = part.finish
            # Survivors should have no coating; a non-empty finish that did not
            # trip the exclusion regex is unmapped territory -> never trust the price.
            flags.append(f"finish_unmapped:{part.finish}")
        for tag in part.tags:
            if tag.context == FEATURES_CTX:
                if ROUGHNESS_RE.search(tag.name):
                    spec.roughness = spec.roughness or tag.name
                elif TOLERANCE_RE.search(tag.name):
                    spec.tolerance = spec.tolerance or tag.name
                elif config.BORDERLINE_RE.search(tag.name):
                    flags.append(f"borderline:{tag.name}")
            if tag.context == RISKS_CTX:
                flags.append(f"risk:{tag.name}")
            if THREAD_RISK_RE.search(tag.name):
                flags.append("threads_flagged_partner")
    if len(offer.parts) > 1:
        flags.append("multi_part")
    spec.flags = list(dict.fromkeys(flags))  # dedupe, keep order
    return spec


def file_kind(filenames: list[str]) -> str:
    """'instant' | 'dxf_only' | 'manual' | 'none' (§1B formats).

    DXF is instant for flat-cut only — for the CNC preset a DXF-only job cannot
    be instant-priced, so it is reported separately and routed to needs_manual.
    """
    exts = {PurePosixPath(n.lower()).suffix for n in filenames}
    instant = exts & config.INSTANT_QUOTE_EXTS
    if instant - {".dxf"}:
        return "instant"
    if ".dxf" in instant:
        return "dxf_only"
    if exts & config.MANUAL_ONLY_EXTS:
        return "manual"
    return "none"


def pick_quote_file(paths: list[str]) -> str | None:
    """The file to upload for the instant quote: prefer STEP/STP, else any instant 3D."""
    for preferred in config.PREFERRED_QUOTE_EXTS:
        for p in paths:
            if p.lower().endswith(preferred):
                return p
    for p in paths:
        suffix = PurePosixPath(p.lower()).suffix
        if suffix in config.INSTANT_QUOTE_EXTS and suffix != ".dxf":
            return p
    return None
