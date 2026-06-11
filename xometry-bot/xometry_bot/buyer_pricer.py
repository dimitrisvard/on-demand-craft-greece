"""Buyer-side instant-quote pricing via Playwright (§1B/§5) — the brittle half.

Hard-gated: `price()` refuses to run until the operator has confirmed the
Order Value node on one successful STEP quote (probe mode below) and set
XB_BUYER_SELECTORS_CONFIRMED=1. Every failure screenshots + raises with a
status — a silently wrong price is the one unacceptable outcome (§7).

Flow per §1B: /quotes/new → set file on the hidden <input type=file> → wait
"Instant Quote - 1 file" → Start Quoting → /quotes/{E-...} → wait out geometry
analysis → match qty/material/tolerance/Ra → read "Order Value excl. VAT".
"""

from __future__ import annotations

import datetime as dt
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import config, selectors

log = logging.getLogger(__name__)

ANALYSIS_TIMEOUT_S = 8 * 60
ANALYSIS_POLL_S = 5.0


@dataclass
class BuyerQuote:
    buyer_price: float
    quote_id: str | None
    threads_locations: int | None
    flags: list[str] = field(default_factory=list)


class NeedsConfirmation(RuntimeError):
    """Raised until the one-time selector confirmation (§8.3) is done."""


class PricingError(RuntimeError):
    def __init__(self, msg: str, *, status: str = "error", screenshot: str | None = None):
        super().__init__(msg)
        self.status = status
        self.screenshot = screenshot


def parse_price_text(text: str) -> float:
    """Extract the Order Value number from node text, EU or US formatted."""
    m = re.search(selectors.BUYER_ORDER_VALUE_RE, text)
    if not m:
        raise ValueError(f"no order value in {text!r}")
    return parse_number(m.group(1))


def parse_number(num: str) -> float:
    """'1.234,56' -> 1234.56, '1,234.56' -> 1234.56, '234,5' -> 234.5, '1,234' -> 1234."""
    num = num.strip()
    if "," in num and "." in num:
        if num.rfind(",") > num.rfind("."):
            num = num.replace(".", "").replace(",", ".")
        else:
            num = num.replace(",", "")
    elif "," in num:
        # Trailing 1-2 digits after the comma = decimal separator, else thousands.
        decimal_comma = re.search(r",\d{1,2}$", num)
        num = num.replace(",", "." if decimal_comma else "")
    return float(num)


class BuyerPricer:
    def __init__(
        self,
        *,
        profile_dir: Path,
        screenshots_dir: Path,
        headless: bool = True,
        confirmed: bool = False,
        timeout_ms: int = 60_000,
    ) -> None:
        self._profile_dir = profile_dir
        self._screenshots_dir = screenshots_dir
        self._headless = headless
        self._confirmed = confirmed
        self._timeout_ms = timeout_ms

    def price(
        self,
        *,
        label: str,
        quote_file: Path,
        quantity: int | None,
        material: str | None,
        tolerance: str | None,
        roughness: str | None,
    ) -> BuyerQuote:
        if not self._confirmed:
            raise NeedsConfirmation(
                "buyer selectors not confirmed — run "
                "`python -m xometry_bot.buyer_pricer probe <file.step>` once, confirm the "
                "Order Value node + config controls in selectors.py, then set "
                "XB_BUYER_SELECTORS_CONFIRMED=1 (§8.3)"
            )
        from playwright.sync_api import sync_playwright

        self._screenshots_dir.mkdir(parents=True, exist_ok=True)
        stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        flags: list[str] = []

        with sync_playwright() as pw:
            ctx = pw.chromium.launch_persistent_context(
                str(self._profile_dir), headless=self._headless
            )
            page = ctx.new_page()
            page.set_default_timeout(self._timeout_ms)
            try:
                # 1-3. upload → Start Quoting → quote id
                page.goto(config.BUYER_NEW_QUOTE_URL, wait_until="domcontentloaded")
                page.set_input_files(selectors.BUYER_FILE_INPUT, str(quote_file))
                page.get_by_text(selectors.BUYER_UPLOAD_CONFIRMED_TEXT).first.wait_for()
                page.click(selectors.BUYER_START_QUOTING_BUTTON)
                page.wait_for_url(re.compile(selectors.BUYER_QUOTE_URL_RE))
                m = re.search(selectors.BUYER_QUOTE_URL_RE, page.url)
                quote_id = m.group(1) if m else None

                # 4. geometry analysis (async, seconds→minutes)
                self._wait_for_analysis(page, label, stamp)

                # 5. match the spec so the price is comparable (§1C/§5.5)
                flags += self._configure_quote(page, quantity, material, tolerance, roughness)

                # 6. read back auto-detected threads (sanity: same STEP carries geometry)
                threads = self._read_threads(page)

                # 7. Order Value excl. VAT (standard price — promos ignored)
                body_text = page.inner_text("body")
                try:
                    buyer_price = parse_price_text(body_text)
                except ValueError as exc:
                    raise PricingError(
                        f"order value not found for {label}: {exc}",
                        status="error",
                        screenshot=self._shot(page, label, stamp, "no-order-value"),
                    ) from exc

                self._shot(page, label, stamp, "priced")
                if buyer_price <= 0:
                    raise PricingError(
                        f"implausible buyer price {buyer_price} for {label}",
                        status="needs_review",
                        screenshot=self._shot(page, label, stamp, "implausible"),
                    )
                return BuyerQuote(buyer_price, quote_id, threads, flags)
            except PricingError:
                raise
            except Exception as exc:
                raise PricingError(
                    f"buyer pricing failed for {label}: {exc}",
                    status="error",
                    screenshot=self._shot(page, label, stamp, "error"),
                ) from exc
            finally:
                ctx.close()

    # --- steps ---------------------------------------------------------------

    def _wait_for_analysis(self, page: Any, label: str, stamp: str) -> None:
        deadline = dt.datetime.now() + dt.timedelta(seconds=ANALYSIS_TIMEOUT_S)
        while dt.datetime.now() < deadline:
            body = page.inner_text("body")
            if selectors.BUYER_ANALYSIS_FAILED_TEXT in body:
                raise PricingError(
                    f"Xometry file analysis failed for {label}",
                    status="needs_manual",
                    screenshot=self._shot(page, label, stamp, "analysis-failed"),
                )
            if not any(t in body for t in selectors.BUYER_ANALYSIS_PENDING_TEXTS):
                return
            page.wait_for_timeout(ANALYSIS_POLL_S * 1000)
        raise PricingError(
            f"geometry analysis timed out after {ANALYSIS_TIMEOUT_S}s for {label}",
            status="error",
            screenshot=self._shot(page, label, stamp, "analysis-timeout"),
        )

    def _configure_quote(
        self,
        page: Any,
        quantity: int | None,
        material: str | None,
        tolerance: str | None,
        roughness: str | None,
    ) -> list[str]:
        """Set qty/material/tolerance/Ra. Anything that can't be set confidently is a
        `config_mismatch:*` flag — the price is still read but lands in needs_review."""
        flags: list[str] = []
        flags += self._set_control(page, "quantity", selectors.BUYER_QTY_INPUT, quantity)
        flags += self._set_control(
            page, "material", selectors.BUYER_MATERIAL_DROPDOWN,
            config.MATERIAL_MAP.get(material or "", material),
        )
        flags += self._set_control(
            page, "tolerance", selectors.BUYER_TOLERANCE_DROPDOWN,
            config.TOLERANCE_MAP.get(tolerance or "", tolerance),
        )
        flags += self._set_control(
            page, "roughness", selectors.BUYER_ROUGHNESS_DROPDOWN,
            config.ROUGHNESS_MAP.get(roughness or "", roughness),
        )
        return flags

    def _set_control(self, page: Any, name: str, selector: str, value: Any) -> list[str]:
        if value in (None, ""):
            return []
        if not selectors.is_confirmed(selector):
            return [f"config_mismatch:{name}_selector_unconfirmed"]
        try:
            if name == "quantity":
                page.fill(selector, str(value))
                page.keyboard.press("Tab")
            else:
                page.select_option(selector, label=str(value))
            return []
        except Exception as exc:
            log.warning("could not set %s=%r: %s", name, value, exc)
            return [f"config_mismatch:{name}"]

    def _read_threads(self, page: Any) -> int | None:
        m = re.search(selectors.BUYER_THREADS_RE, page.inner_text("body"))
        return int(m.group(1)) if m else None

    def _shot(self, page: Any, label: str, stamp: str, suffix: str) -> str:
        path = self._screenshots_dir / f"{label}-{stamp}-{suffix}.png"
        try:
            page.screenshot(path=str(path), full_page=True)
        except Exception:
            return "screenshot failed"
        return str(path)


def probe(step_file: Path, *, profile_dir: Path, headless: bool = False) -> None:
    """One-time confirmation helper (§8.3): upload → Start Quoting headed, then print
    every node text matching /Order Value|excl. VAT|Threads/ so the operator can pin
    BUYER_ORDER_VALUE_* and the config controls, then set XB_BUYER_SELECTORS_CONFIRMED=1."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(str(profile_dir), headless=headless)
        page = ctx.new_page()
        page.set_default_timeout(120_000)
        page.goto(config.BUYER_NEW_QUOTE_URL, wait_until="domcontentloaded")
        page.set_input_files(selectors.BUYER_FILE_INPUT, str(step_file))
        page.get_by_text(selectors.BUYER_UPLOAD_CONFIRMED_TEXT).first.wait_for()
        page.click(selectors.BUYER_START_QUOTING_BUTTON)
        page.wait_for_url(re.compile(selectors.BUYER_QUOTE_URL_RE))
        print(f"quote url: {page.url}")
        print("waiting 90s for geometry analysis, then dumping candidate nodes...")
        page.wait_for_timeout(90_000)
        pattern = re.compile(r"order value|excl\. vat|threads", re.IGNORECASE)
        for line in page.inner_text("body").splitlines():
            if pattern.search(line):
                print(f"  candidate: {line.strip()!r}")
        print("confirm selectors in selectors.py, then set XB_BUYER_SELECTORS_CONFIRMED=1")
        ctx.close()


def login(profile_dir: Path, headless: bool = False) -> None:
    """One-time bootstrap: operator logs into get.xometry.eu in the persistent profile."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(str(profile_dir), headless=headless)
        page = ctx.new_page()
        page.goto(config.BUYER_APP_URL)
        log.info("log in to get.xometry.eu, then close the browser window")
        try:
            page.wait_for_event("close", timeout=0)
        finally:
            ctx.close()


if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="buyer-side helpers")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_probe = sub.add_parser("probe", help="one-time Order Value selector confirmation")
    p_probe.add_argument("step_file", type=Path)
    sub.add_parser("login", help="open a headed browser to warm the buyer session")
    args = parser.parse_args()
    settings = config.Settings.from_env()
    if args.cmd == "probe":
        probe(args.step_file, profile_dir=settings.buyer_profile_dir, headless=False)
    elif args.cmd == "login":
        login(settings.buyer_profile_dir)
