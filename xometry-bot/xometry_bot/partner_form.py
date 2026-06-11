"""Human-gated counteroffer submission by driving the partner portal form (§6C).

This is the PRIMARY submit path — element ids were captured live (§1A), the
GraphQL mutation has not been. Runs in the warm partner Playwright profile.
Every attempt stores full-page screenshots for audit; any selector miss raises
loud and the row goes to `error` — a failed attempt is NEVER auto-retried
because the form may have half-submitted (verify in "My Responses" first).
"""

from __future__ import annotations

import datetime as dt
import logging
from pathlib import Path
from typing import Any, Protocol

from . import config, selectors

log = logging.getLogger(__name__)


class SubmitError(RuntimeError):
    pass


class Submitter(Protocol):
    """Interface shared by the form drive and the future GraphQL mutation (§6C)."""

    def submit(
        self, *, offer_id: str, code: str, price: float, leadtime: dt.date, comment: str = ""
    ) -> str: ...


class PlaywrightFormSubmitter:
    def __init__(
        self,
        *,
        profile_dir: Path,
        screenshots_dir: Path,
        headless: bool = True,
        timeout_ms: int = 30_000,
    ) -> None:
        self._profile_dir = profile_dir
        self._screenshots_dir = screenshots_dir
        self._headless = headless
        self._timeout_ms = timeout_ms

    def submit(
        self, *, offer_id: str, code: str, price: float, leadtime: dt.date, comment: str = ""
    ) -> str:
        """Fill + submit the "Offer my price and time" modal. Returns audit screenshot path."""
        from playwright.sync_api import sync_playwright

        self._screenshots_dir.mkdir(parents=True, exist_ok=True)
        stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        url = config.PARTNER_OFFER_URL.format(offer_id=offer_id)

        with sync_playwright() as pw:
            ctx = pw.chromium.launch_persistent_context(
                str(self._profile_dir), headless=self._headless
            )
            page = ctx.new_page()
            page.set_default_timeout(self._timeout_ms)
            try:
                page.goto(url, wait_until="domcontentloaded")
                page.click(selectors.PARTNER_OFFER_MY_PRICE_BUTTON)
                page.wait_for_selector(selectors.PARTNER_PRICE_INPUT)

                # TODO(confirm): decimal separator on first live submit (dot assumed).
                page.fill(selectors.PARTNER_PRICE_INPUT, f"{price:.2f}")

                date_text = leadtime.strftime(config.PARTNER_FORM_DATE_FORMAT)
                page.fill(selectors.PARTNER_LEADTIME_PICKER, date_text)
                page.keyboard.press("Enter")
                mirror = page.query_selector(selectors.PARTNER_LEADTIME_MIRROR)
                mirror_value: str = mirror.input_value() if mirror else ""
                if mirror is not None and not mirror_value.strip():
                    raise SubmitError(
                        f"lead-time mirror {selectors.PARTNER_LEADTIME_MIRROR} stayed empty — "
                        f"date '{date_text}' did not register; confirm PARTNER_FORM_DATE_FORMAT"
                    )

                if comment:
                    page.fill(selectors.PARTNER_COMMENT_INPUT, comment)

                boxes = page.query_selector_all(selectors.PARTNER_CHECKBOXES)
                if len(boxes) != config.PARTNER_FORM_EXPECTED_CHECKBOXES:
                    raise SubmitError(
                        f"expected {config.PARTNER_FORM_EXPECTED_CHECKBOXES} confirmation "
                        f"checkboxes, found {len(boxes)} — selector drift, refusing to submit"
                    )
                for box in boxes:
                    if not box.is_checked():
                        box.check()

                form_shot = self._screenshots_dir / f"{code}-{stamp}-form.png"
                page.screenshot(path=str(form_shot), full_page=True)

                page.click(selectors.PARTNER_SUBMIT_BUTTON)
                # Success criterion until PARTNER_SUCCESS_TOAST is captured: modal gone.
                page.wait_for_selector(
                    selectors.PARTNER_PRICE_INPUT, state="detached", timeout=self._timeout_ms
                )

                done_shot = self._screenshots_dir / f"{code}-{stamp}-submitted.png"
                page.screenshot(path=str(done_shot), full_page=True)
                log.info("counteroffer submitted: %s price=%.2f leadtime=%s", code, price, leadtime)
                return str(done_shot)
            except SubmitError:
                self._error_shot(page, code, stamp)
                raise
            except Exception as exc:
                shot = self._error_shot(page, code, stamp)
                raise SubmitError(
                    f"form drive failed for {code}: {exc} (screenshot: {shot}) — verify in "
                    "'My Responses' whether the counteroffer went through before retrying"
                ) from exc
            finally:
                ctx.close()

    def _error_shot(self, page: Any, code: str, stamp: str) -> str:
        shot = self._screenshots_dir / f"{code}-{stamp}-error.png"
        try:
            page.screenshot(path=str(shot), full_page=True)
        except Exception:  # screenshotting a crashed page must not mask the real error
            return "screenshot failed"
        return str(shot)


def login(profile_dir: Path, headless: bool = False) -> None:
    """One-time bootstrap: open the partner portal headed; operator logs in (MFA),
    then closes the window. The persistent profile keeps the session warm."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(str(profile_dir), headless=headless)
        page = ctx.new_page()
        page.goto(config.PARTNER_PORTAL_URL)
        log.info("log in to the partner portal, then close the browser window")
        try:
            page.wait_for_event("close", timeout=0)
        finally:
            ctx.close()


if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="partner-side helpers")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("login", help="open a headed browser to warm the partner session")
    args = parser.parse_args()
    if args.cmd == "login":
        login(config.Settings.from_env().partner_profile_dir)
