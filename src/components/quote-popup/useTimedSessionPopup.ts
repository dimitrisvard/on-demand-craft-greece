import { useCallback, useEffect, useState } from "react";

const DISMISS_KEY = "mh_quote_popup_dismissed";
const DELAY_MS = 5500;

// sessionStorage => the popup shows again on a new visit/session.
// To make a dismissal permanent across visits, swap sessionStorage -> localStorage
// on the two lines marked below.
function alreadyDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1"; // <-- storage line 1
  } catch {
    return false;
  }
}
function markDismissed() {
  try {
    sessionStorage.setItem(DISMISS_KEY, "1"); // <-- storage line 2
  } catch {
    /* storage blocked; popup simply won't persist its dismissal */
  }
}

// Fire through the project's GA4 setup (window.gtag), falling back to a raw
// dataLayer push so the events are still captured if gtag isn't ready yet.
function track(event: string) {
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  };
  if (typeof w.gtag === "function") {
    w.gtag("event", event);
  } else {
    w.dataLayer = w.dataLayer || [];
    w.dataLayer.push({ event });
  }
}

export function useTimedSessionPopup(enabled: boolean) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled || alreadyDismissed()) return;
    const t = window.setTimeout(() => {
      if (alreadyDismissed()) return;
      setOpen(true);
      track("quote_popup_shown");
    }, DELAY_MS);
    return () => window.clearTimeout(t);
  }, [enabled]);

  const close = useCallback(() => {
    markDismissed();
    track("quote_popup_closed");
    setOpen(false);
  }, []);

  const convert = useCallback(() => {
    markDismissed();
    track("quote_popup_cta_click");
    // Hide immediately; the component stays mounted across navigation, so
    // without this the popup would linger on the quote page after the click.
    setOpen(false);
  }, []);

  return { open, close, convert };
}
