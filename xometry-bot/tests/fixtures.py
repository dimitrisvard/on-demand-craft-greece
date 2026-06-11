"""Synthetic gshJobOffers payloads shaped per the captured §1A response."""

from __future__ import annotations

from typing import Any

MILLING_TAG = {"id": 14, "name": "Milling", "context": "production_methods"}
TURNING_TAG = {"id": 10, "name": "Turning", "context": "production_methods"}
LASER_TAG = {"id": 36, "name": "Laser Cutting", "context": "production_methods"}
ANODIZING_TAG = {"id": 86, "name": "Anodizing type II", "context": "production_method_features"}
POWDER_TAG = {"id": 104, "name": "Powder coating", "context": "production_method_features"}
TOLERANCE_TAG = {
    "id": 500, "name": "ISO 2768: medium (mK)", "context": "production_method_features"
}
RA_TAG = {"id": 501, "name": "Ra: 3.2 (Standard)", "context": "production_method_features"}
GRINDING_TAG = {"id": 184, "name": "Grinding flat", "context": "production_method_features"}
HEAT_TAG = {"id": 102, "name": "Heat treatment", "context": "production_method_features"}
MATERIAL_TAG = {"id": 700, "name": "Stainless Steel", "context": "materials"}
THREAD_RISK_TAG = {"id": 600, "name": "Threads at risk", "context": "production_risks"}

STEP_FILE = {
    "id": 1,
    "name": "bracket.step",
    "downloadUrl": "https://files.example/bracket.step",
    "preview": None,
    "largeUrl": None,
}
PDF_FILE = {
    "id": 2,
    "name": "drawing.pdf",
    "downloadUrl": "https://files.example/drawing.pdf",
    "preview": None,
    "largeUrl": None,
}


def make_part(**over: Any) -> dict[str, Any]:
    part: dict[str, Any] = {
        "code": "P-1",
        "name": "Bracket",
        "material": "Stainless Steel 316L / 1.4404",
        "processType": "cnc_milling",
        "quantity": 2,
        "dimensions": "290.0x290.0x125.0",
        "weightKg": 1.2,
        "volumeMm3": 152000.0,
        "finish": "",
        "productionRemark": None,
        "measurementProtocolNeeded": False,
        "samplesNeeded": False,
        "tags": [MILLING_TAG, TOLERANCE_TAG, RA_TAG],
        "files": [STEP_FILE],
    }
    part.update(over)
    return part


def make_offer(code: str = "HJO-21991-684", **over: Any) -> dict[str, Any]:
    offer: dict[str, Any] = {
        "id": 684001,
        "code": code,
        "allowAutoaccept": False,
        "allowCounterofferFrom": 80.0,
        "cost": {"amount": 100.0, "currency": "EUR"},
        "leadtime": "2026-06-18",
        "isUrgent": False,
        "jobId": 21991,
        "job": {"publicComment": None, "jobState": "published"},
        "parts": [make_part()],
        "publicationStart": "2026-06-10T08:00:00Z",
        "publicationEnd": "2026-06-14T10:00:00Z",
    }
    offer.update(over)
    return offer


def gql_page(
    offers: list[dict[str, Any]], *, has_more: bool = False, offset: int = 0
) -> dict[str, Any]:
    return {
        "data": {
            "gshJobOffers": {
                "metadata": {
                    "hasMore": has_more,
                    "limit": 20,
                    "offset": offset,
                    "totalCount": len(offers),
                },
                "offers": offers,
            }
        }
    }
