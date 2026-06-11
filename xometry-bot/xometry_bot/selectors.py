"""Every DOM selector in one place (§7) — a Xometry UI change is a one-file fix.

Partner-form element ids were captured verbatim from the live portal (11 Jun 2026).
Buyer-side selectors marked TODO(confirm) are best-effort anchors; the buyer
pipeline refuses to run until XB_BUYER_SELECTORS_CONFIRMED=1 (set after
`python -m xometry_bot.buyer_pricer probe <file.step>` — see README), so an
unconfirmed selector can never produce a silent wrong price.
"""

TODO_MARK = "TODO(confirm)"

# --- Partner counteroffer modal: "Offer my price and time" (captured, §1A) -----
PARTNER_OFFER_MY_PRICE_BUTTON = 'text="Offer my price and time"'
PARTNER_MODAL_HEADING = 'text="Give us your terms!"'
PARTNER_PRICE_INPUT = "#invoice_counterofferValue"
PARTNER_LEADTIME_PICKER = "#invoice_counterofferLeadtimeMoment"
PARTNER_LEADTIME_MIRROR = "#invoice_counterofferLeadtime"  # hidden text mirror
PARTNER_COMMENT_INPUT = "#invoice_responseComment"
# The modal contains exactly 3 required confirmation checkboxes (produce / T&C / NDA).
PARTNER_CHECKBOXES = 'div[role="dialog"] input[type="checkbox"]'  # TODO(confirm) container
PARTNER_SUBMIT_BUTTON = 'div[role="dialog"] button[type="submit"]'  # TODO(confirm)
# Until the success toast is captured, success = the modal/price input detaching.
PARTNER_SUCCESS_TOAST = TODO_MARK

# --- Buyer instant quote (get.xometry.eu, §1B/§5) -------------------------------
BUYER_FILE_INPUT = 'input[type="file"]'  # hidden input behind the drag&drop zone
BUYER_UPLOAD_CONFIRMED_TEXT = "Instant Quote"  # appears as "Instant Quote - 1 file"
BUYER_START_QUOTING_BUTTON = 'button:has-text("Start Quoting")'
BUYER_QUOTE_URL_RE = r"/quotes/([A-Za-z0-9-]+)"  # quote no. E-xxxxxxx-xxxxxxx
BUYER_ANALYSIS_PENDING_TEXTS = ("Analysing geometry", "Analyzing geometry", "In progress")
BUYER_ANALYSIS_FAILED_TEXT = "File analysis failed"
BUYER_THREADS_RE = r"Threads and tapped holes:\s*(\d+)"
# "Order Value: excl. VAT  X €" node in Order Summary. TODO(confirm) the exact node
# on one successful STEP quote (probe mode prints all candidates).
BUYER_ORDER_VALUE_ANCHOR = "Order Value"
BUYER_ORDER_VALUE_RE = r"Order Value[^0-9]*([\d.,]+)\s*€"
# Per-part config controls — capture with probe mode, then fill these in.
BUYER_QTY_INPUT = TODO_MARK
BUYER_MATERIAL_DROPDOWN = TODO_MARK
BUYER_PROCESS_DROPDOWN = TODO_MARK
BUYER_TOLERANCE_DROPDOWN = TODO_MARK
BUYER_ROUGHNESS_DROPDOWN = TODO_MARK


def is_confirmed(selector: str) -> bool:
    """True if the selector has been confirmed against the live UI."""
    return not selector.startswith(TODO_MARK)
