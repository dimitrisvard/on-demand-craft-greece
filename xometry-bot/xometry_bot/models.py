"""Pydantic models for the partner GraphQL payloads and the Supabase row.

Tolerant-by-design where §1 marks the live shape TODO(confirm): the money
fragment normalises both {amount,currency} and {value,currencyCode}, dates
accept ISO strings / datetimes / epoch milliseconds. Unknown fields are
ignored, never fatal — a scan must not die on a schema drift it can absorb.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class XBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class Money(XBase):
    """Money fragment (§1A TODO(confirm): could be value/currencyCode — both accepted)."""

    amount: float
    currency: str = "EUR"

    @model_validator(mode="before")
    @classmethod
    def _normalise(cls, data: Any) -> Any:
        if isinstance(data, int | float):
            return {"amount": float(data)}
        if isinstance(data, dict):
            d = dict(data)
            if "amount" not in d and "value" in d:
                d["amount"] = d.pop("value")
            if "currency" not in d and "currencyCode" in d:
                d["currency"] = d.pop("currencyCode")
            return d
        return data


def _coerce_date(v: Any) -> Any:
    if v is None or isinstance(v, date):
        return v
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, int | float):  # epoch; >1e11 means milliseconds
        ts = float(v) / 1000.0 if abs(float(v)) > 1e11 else float(v)
        return datetime.fromtimestamp(ts, tz=UTC).date()
    if isinstance(v, str) and v:
        return date.fromisoformat(v[:10])
    return v


def _coerce_datetime(v: Any) -> Any:
    if isinstance(v, int | float) and abs(float(v)) > 1e11:  # epoch milliseconds
        return datetime.fromtimestamp(float(v) / 1000.0, tz=UTC)
    return v


class Tag(XBase):
    id: int
    name: str
    context: str = ""


class PartFile(XBase):
    id: int | str | None = None
    name: str
    download_url: str | None = Field(default=None, alias="downloadUrl")
    preview: str | None = None
    large_url: str | None = Field(default=None, alias="largeUrl")


class JobInfo(XBase):
    public_comment: str | None = Field(default=None, alias="publicComment")
    state: str | None = Field(default=None, alias="jobState")


class JobOfferPart(XBase):
    code: str | None = None
    name: str | None = None
    material: str | None = None
    process_type: str | None = Field(default=None, alias="processType")
    quantity: int | None = None
    dimensions: str | None = None
    weight_kg: float | None = Field(default=None, alias="weightKg")
    volume_mm3: float | None = Field(default=None, alias="volumeMm3")
    finish: str = ""  # "" = none; non-empty = coating/finish string (§1C)
    production_remark: str | None = Field(default=None, alias="productionRemark")
    measurement_protocol_needed: bool = Field(default=False, alias="measurementProtocolNeeded")
    samples_needed: bool = Field(default=False, alias="samplesNeeded")
    tags: list[Tag] = []
    files: list[PartFile] = []

    @field_validator("finish", mode="before")
    @classmethod
    def _none_to_empty(cls, v: Any) -> Any:
        return "" if v is None else v


class JobOffer(XBase):
    id: int | str
    code: str  # "HJO-21991-684" — dedupe key
    allow_autoaccept: bool | None = Field(default=None, alias="allowAutoaccept")
    allow_counteroffer_from: float | None = Field(default=None, alias="allowCounterofferFrom")
    cost: Money | None = None
    leadtime: date | None = None
    is_urgent: bool = Field(default=False, alias="isUrgent")
    job_id: int | str | None = Field(default=None, alias="jobId")
    job: JobInfo | None = None
    parts: list[JobOfferPart] = []
    publication_start: datetime | None = Field(default=None, alias="publicationStart")
    publication_end: datetime | None = Field(default=None, alias="publicationEnd")
    # Original payload for the audit column; attached by the client, never serialised back.
    raw: dict[str, Any] = Field(default_factory=dict, exclude=True)

    @field_validator("allow_counteroffer_from", mode="before")
    @classmethod
    def _money_or_number(cls, v: Any) -> Any:
        if isinstance(v, dict):
            return v.get("amount", v.get("value"))
        return v

    @field_validator("leadtime", mode="before")
    @classmethod
    def _leadtime(cls, v: Any) -> Any:
        return _coerce_date(v)

    @field_validator("publication_start", "publication_end", mode="before")
    @classmethod
    def _pub(cls, v: Any) -> Any:
        return _coerce_datetime(v)


class ScanMetadata(XBase):
    has_more: bool = Field(alias="hasMore")
    limit: int = 0
    offset: int = 0
    total_count: int | None = Field(default=None, alias="totalCount")


class ScanPage(XBase):
    metadata: ScanMetadata
    offers: list[JobOffer]


class OfferRow(BaseModel):
    """Flattened row matching the xometry_offers table (§3)."""

    code: str
    offer_id: str
    is_urgent: bool = False
    process_type: str | None = None
    material: str | None = None
    quantity: int | None = None
    dimensions: str | None = None
    weight_kg: float | None = None
    volume_mm3: float | None = None
    tags: list[str] = []
    tolerance: str | None = None
    roughness: str | None = None
    finish: str | None = None
    threads_present: bool | None = None
    inspection_needed: bool = False
    excluded_reason: str | None = None
    part_files: list[dict[str, str | None]] = []
    local_files: list[str] = []
    production_remark: str | None = None
    partner_cost: float | None = None
    allow_counter_from: float | None = None
    buyer_price: float | None = None
    buyer_quote_id: str | None = None
    suggested_price: float | None = None
    xo_leadtime: date | None = None
    publication_end: datetime | None = None
    suggested_leadtime: date | None = None
    status: str = "new"
    flags: list[str] = []
    raw: dict[str, Any] = {}
