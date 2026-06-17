import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useTimedSessionPopup } from "./useTimedSessionPopup";
import { QUOTE_POPUP_COPY, type PopupLocale } from "./quotePopup.i18n";

const TEAL_700 = "#0C6E68";
const TEAL_500 = "#129E95";
const TEAL_300 = "#5FD3C8";
const INK = "#0B1A1F";
const LINE = "#D6E3E2";

// IBM Plex isn't loaded by this project (it ships Inter), so fall back to the
// project's font stack while still preferring Plex if a tenant ever adds it.
const SANS =
  '"IBM Plex Sans", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO =
  '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';

// Don't show on the quote page itself, checkout, or thank-you / success routes.
// Covers both language-prefixed (/de/quote) and legacy (/quote) paths.
const EXCLUDE = [
  /\/quote(\/|$)/,
  /\/checkout(\/|$)/,
  /\/thank-?you(\/|$)/,
  /\/success(\/|$)/,
];

const SUPPORTED = Object.keys(QUOTE_POPUP_COPY) as PopupLocale[];

function resolveLocale(lang: string | undefined): PopupLocale {
  const base = (lang || "en").toLowerCase().split("-")[0];
  return (SUPPORTED.includes(base as PopupLocale) ? base : "en") as PopupLocale;
}

export default function QuotePopup() {
  const location = useLocation();
  const pathname = location.pathname || "/";
  const { i18n } = useTranslation();

  const locale = resolveLocale(i18n.language);
  const copy = QUOTE_POPUP_COPY[locale] ?? QUOTE_POPUP_COPY.en;

  const excluded = EXCLUDE.some((re) => re.test(pathname));
  const { open, close, convert } = useTimedSessionPopup(!excluded);

  const closeRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement;
    const id = window.setTimeout(() => closeRef.current?.focus(), 30);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      // Trap focus within the dialog.
      if (e.key === "Tab" && cardRef.current) {
        const focusable = cardRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus?.();
    };
  }, [open, close]);

  if (!open) return null;

  const to = `/${locale}/quote?utm_source=site&utm_medium=popup&utm_campaign=order_part_eu`;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(8,22,26,.55)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        animation: "mhQpFade .2s ease both",
      }}
    >
      <style>{`
        @keyframes mhQpFade{from{opacity:0}to{opacity:1}}
        @keyframes mhQpPop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
        @media (prefers-reduced-motion: reduce){ .mh-qp-card{animation:none !important} }
      `}</style>

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mh-qp-title"
        className="mh-qp-card"
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 500,
          background: "#fff",
          borderRadius: 14,
          border: `1px solid ${LINE}`,
          padding: "34px 30px 22px",
          boxShadow: "0 24px 60px -18px rgba(8,22,26,.45)",
          fontFamily: SANS,
          color: INK,
          animation: "mhQpPop .26s cubic-bezier(.2,.8,.2,1) both",
        }}
      >
        {/* teal top accent */}
        <span
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: 4,
            borderTopLeftRadius: 14,
            borderTopRightRadius: 14,
            background: `linear-gradient(90deg, ${TEAL_700}, ${TEAL_500} 55%, ${TEAL_300})`,
          }}
        />

        {/* clear close button */}
        <button
          ref={closeRef}
          onClick={close}
          aria-label={copy.close}
          type="button"
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: `1px solid ${LINE}`,
            background: "#fff",
            fontSize: 20,
            lineHeight: 1,
            color: "#54706E",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ×
        </button>

        <div
          style={{
            fontFamily: MONO,
            fontSize: 11.5,
            letterSpacing: 1.6,
            color: TEAL_700,
            fontWeight: 600,
            margin: "2px 0 12px",
          }}
        >
          {copy.eyebrow}
        </div>

        <h2
          id="mh-qp-title"
          style={{
            fontSize: 23,
            lineHeight: 1.2,
            fontWeight: 700,
            margin: "0 0 10px",
            letterSpacing: "-.2px",
          }}
        >
          {copy.title}
        </h2>

        <p
          style={{
            fontSize: 14.5,
            lineHeight: 1.55,
            color: "#3C5350",
            margin: "0 0 20px",
          }}
        >
          {copy.body}
        </p>

        <Link
          to={to}
          onClick={convert}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            textDecoration: "none",
            fontWeight: 600,
            fontSize: 15.5,
            color: "#fff",
            padding: "14px 18px",
            borderRadius: 10,
            letterSpacing: ".2px",
            background: `linear-gradient(180deg, ${TEAL_500}, ${TEAL_700})`,
            boxShadow: "0 10px 22px -10px rgba(12,110,104,.85)",
          }}
        >
          {copy.cta} <span aria-hidden="true">→</span>
        </Link>

        <div
          style={{
            fontFamily: MONO,
            fontSize: 11.5,
            color: "#6E8684",
            textAlign: "center",
            margin: "12px 0 8px",
          }}
        >
          {copy.micro}
        </div>

        <button
          onClick={close}
          type="button"
          style={{
            display: "block",
            margin: "8px auto 0",
            border: "none",
            background: "transparent",
            color: "#7C9491",
            fontSize: 13,
            cursor: "pointer",
            padding: "6px 10px",
          }}
        >
          {copy.later}
        </button>
      </div>
    </div>
  );
}
