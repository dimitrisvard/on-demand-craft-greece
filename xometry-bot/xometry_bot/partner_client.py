"""Xometry partner-side client: gshJobOffers scan + file download (§1A).

GraphQL is the robust half and the primary integration. The counteroffer
mutation is intentionally NOT implemented until captured live from DevTools
(§6C TODO(confirm)) — submission goes through partner_form.PlaywrightFormSubmitter.

Money-fragment seam: the captured query asks for `cost { amount currency }`.
If the live schema rejects those field names, the client swaps the fragment to
`{ value currencyCode }` once, logs it loudly, and retries — models.Money
normalises both response shapes.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx

from . import config
from .models import JobOffer, ScanPage

log = logging.getLogger(__name__)

MONEY_FRAGMENT_PRIMARY = "{ amount currency }"
MONEY_FRAGMENT_ALT = "{ value currencyCode }"

# Verbatim shape captured live (§1A); the money fragment is templated for the seam above.
GSH_JOB_OFFERS_QUERY_TMPL = """
query gshJobOffers(
  $filter: OffersFilterType!, $offsetAttributes: OffsetAttributes, $sort: OffersSortType
) {
  gshJobOffers(filter: $filter, offsetAttributes: $offsetAttributes, sort: $sort) {
    metadata { hasMore limit offset totalCount }
    offers {
      ... on JobOffer {
        id
        code
        allowAutoaccept
        allowCounterofferFrom
        cost __MONEY__
        leadtime
        isUrgent
        jobId
        job { publicComment jobState: state }
        parts {
          code
          name
          material
          processType
          quantity
          dimensions
          weightKg
          volumeMm3
          finish
          productionRemark
          measurementProtocolNeeded
          samplesNeeded
          tags { id name context }
          files { id name downloadUrl preview largeUrl }
        }
        publicationStart
        publicationEnd
      }
    }
  }
}
"""

# TODO(confirm): exact presets query shape. The captured tag ids in config.PRESETS are
# the v1 source of truth (§1A); this call is optional hardening to detect preset drift.
PRESETS_QUERY = """
query presets($context: String) {
  presets(context: $context) { id name filter }
}
"""


class PartnerAuthError(RuntimeError):
    """Session expired / wrong auth header — fail loud, operator must re-login (§7)."""


class PartnerApiError(RuntimeError):
    pass


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r"[^\w.\- ]", "_", name).strip()
    return cleaned or "unnamed"


class PartnerClient:
    """Authenticated client for api.xometry.eu/partners/graphql.

    TODO(confirm §1A): bearer vs cookie-only auth — we send whichever is configured
    (both if both are set); the first live scan settles it.
    """

    def __init__(
        self,
        *,
        auth_token: str | None = None,
        cookie: str | None = None,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 30.0,
    ) -> None:
        if not auth_token and not cookie:
            raise PartnerAuthError(
                "no partner auth configured — set XB_PARTNER_AUTH_TOKEN (localStorage "
                "authToken) and/or XB_PARTNER_COOKIE (session cookie header)"
            )
        headers = {"accept": "application/json"}
        if auth_token:
            headers["authorization"] = f"Bearer {auth_token}"
        if cookie:
            headers["cookie"] = cookie
        self._client = httpx.Client(
            headers=headers, timeout=timeout, transport=transport, follow_redirects=True
        )
        self._money_fragment = MONEY_FRAGMENT_PRIMARY
        self._money_shape_logged = False

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> PartnerClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # --- GraphQL plumbing -------------------------------------------------------

    def _gql(self, query: str, variables: dict[str, Any], operation_name: str) -> dict[str, Any]:
        resp = self._client.post(
            config.PARTNER_GRAPHQL_URL,
            json={"operationName": operation_name, "query": query, "variables": variables},
        )
        if resp.status_code in (401, 403):
            raise PartnerAuthError(
                f"partner API returned {resp.status_code} — session expired or wrong auth "
                "header (re-login / refresh token, see README)"
            )
        resp.raise_for_status()
        payload = resp.json()
        if payload.get("errors"):
            raise PartnerApiError(json.dumps(payload["errors"])[:1000])
        data: dict[str, Any] = payload["data"]
        return data

    def _scan_page(self, flt: dict[str, Any], limit: int, offset: int) -> dict[str, Any]:
        variables = {"filter": flt, "offsetAttributes": {"limit": limit, "offset": offset}}
        query = GSH_JOB_OFFERS_QUERY_TMPL.replace("__MONEY__", self._money_fragment)
        try:
            data = self._gql(query, variables, "gshJobOffers")
        except PartnerApiError as exc:
            # Money-field seam (§1A TODO(confirm)): swap fragment once and retry.
            msg = str(exc)
            if self._money_fragment == MONEY_FRAGMENT_PRIMARY and (
                "amount" in msg or "currency" in msg or "Cannot query field" in msg
            ):
                log.warning(
                    "money fragment %s rejected, retrying with %s — update "
                    "partner_client.MONEY_FRAGMENT_PRIMARY once confirmed: %s",
                    MONEY_FRAGMENT_PRIMARY,
                    MONEY_FRAGMENT_ALT,
                    msg,
                )
                self._money_fragment = MONEY_FRAGMENT_ALT
                query = GSH_JOB_OFFERS_QUERY_TMPL.replace("__MONEY__", self._money_fragment)
                data = self._gql(query, variables, "gshJobOffers")
            else:
                raise
        node: dict[str, Any] = data["gshJobOffers"]
        return node

    def _log_money_shape_once(self, node: dict[str, Any]) -> None:
        if self._money_shape_logged:
            return
        for offer in node.get("offers", []):
            cost = offer.get("cost")
            if isinstance(cost, dict):
                log.info(
                    "TODO(confirm) resolved: money fields on live response = %s",
                    sorted(cost.keys()),
                )
                self._money_shape_logged = True
                return

    # --- Public API ---------------------------------------------------------------

    def scan(
        self,
        *,
        flt: dict[str, Any] | None = None,
        limit: int = config.SCAN_PAGE_LIMIT,
    ) -> Iterator[JobOffer]:
        """Paginate gshJobOffers until metadata.hasMore is false (§1A)."""
        offset = 0
        for _ in range(config.SCAN_MAX_PAGES):
            node = self._scan_page(flt or dict(config.SCAN_FILTER), limit, offset)
            self._log_money_shape_once(node)
            page = ScanPage.model_validate(node)
            for raw, offer in zip(node.get("offers", []), page.offers, strict=True):
                offer.raw = raw
                yield offer
            if not page.metadata.has_more:
                return
            offset += limit
        log.warning("scan aborted at SCAN_MAX_PAGES=%d — raise the cap?", config.SCAN_MAX_PAGES)

    def fetch_presets(self) -> dict[str, Any]:
        """Optional hardening: live saved-filter presets (context 'job_offers').

        v1 uses the captured tag ids in config.PRESETS; call this manually to
        verify they still match the account. Query shape is TODO(confirm)."""
        return self._gql(PRESETS_QUERY, {"context": "job_offers"}, "presets")

    def download_files(self, offer: JobOffer, dest_root: Path) -> list[str]:
        """Download all part files (CAD/drawings) to dest_root/<code>/, skipping existing."""
        dest = dest_root / _safe_filename(offer.code)
        dest.mkdir(parents=True, exist_ok=True)
        paths: list[str] = []
        for part in offer.parts:
            for f in part.files:
                if not f.download_url:
                    continue
                target = dest / _safe_filename(f.name)
                if target.exists() and target.stat().st_size > 0:
                    paths.append(str(target))
                    continue
                with self._client.stream("GET", f.download_url) as resp:
                    resp.raise_for_status()
                    with target.open("wb") as fh:
                        for chunk in resp.iter_bytes():
                            fh.write(chunk)
                log.info("downloaded %s (%d bytes)", target.name, target.stat().st_size)
                paths.append(str(target))
        return paths

    def submit_counteroffer(self, **_: Any) -> None:
        """Headless GraphQL counteroffer — NOT implemented on purpose (§6C).

        Capture the mutation once from DevTools (operationName + variables:
        counterofferValue, counterofferLeadtime, responseComment, offer id,
        confirmations), then implement it here behind the same Submitter
        interface as partner_form.PlaywrightFormSubmitter."""
        raise NotImplementedError(
            "counteroffer mutation not captured yet (§6C TODO(confirm)) — "
            "use partner_form.PlaywrightFormSubmitter"
        )
