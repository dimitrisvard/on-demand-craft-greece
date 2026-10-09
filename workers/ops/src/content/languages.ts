// Languages of the content pipeline (Phase 5, unit C5), as the live edge functions define them.
//
//   TARGET_LANGS      the 13 translation languages in the order of auto-translate-articles (the fan-out order)
//   LANGUAGE_NAMES    the language names the translation prompt uses (translate-article LANGUAGES)
//   SERVICE_SLUGS     per-language service and quote slugs (identical tables in translate-article and
//                     fix-article-links); the source of localised /quote and /services links
//   blogSegment()     the per-language blog path segment of the sitemap generator (blogg for sv and nb, blogi for
//                     fi, blog otherwise); used for IndexNow URLs
//
// Rules
//   - English is the master language; it is never a translation target.
//   - Tables are copied, never derived, so a parity test can compare them with the live sources.

import type { TargetLang } from '../queues/messages';

export const TARGET_LANGS: readonly TargetLang[] = Object.freeze([
  'de', 'fr', 'es', 'it', 'nl', 'pt', 'sv', 'da', 'nb', 'pl', 'cs', 'hu', 'fi',
] as const);

export const LANGUAGE_NAMES: Readonly<Record<TargetLang, string>> = Object.freeze({
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  nl: 'Dutch',
  pl: 'Polish',
  sv: 'Swedish',
  da: 'Danish',
  fi: 'Finnish',
  cs: 'Czech',
  hu: 'Hungarian',
  pt: 'Portuguese',
  nb: 'Norwegian',
});

export const SERVICE_SLUGS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  de: { services: 'dienstleistungen', quote: 'angebot', 'cnc-machining': 'cnc-bearbeitung', 'sheet-metal': 'blechbearbeitung', 'injection-molding': 'spritzguss' },
  fr: { services: 'services', quote: 'devis', 'cnc-machining': 'usinage-cnc', 'sheet-metal': 'tolerie', 'injection-molding': 'injection-plastique' },
  es: { services: 'servicios', quote: 'cotizacion', 'cnc-machining': 'mecanizado-cnc', 'sheet-metal': 'chapa-metalica', 'injection-molding': 'moldeo-por-inyeccion' },
  it: { services: 'servizi', quote: 'preventivo', 'cnc-machining': 'lavorazione-cnc', 'sheet-metal': 'lavorazione-lamiera', 'injection-molding': 'stampaggio-iniezione' },
  nl: { services: 'diensten', quote: 'offerte', 'cnc-machining': 'cnc-bewerking', 'sheet-metal': 'plaatbewerking', 'injection-molding': 'spuitgieten' },
  pl: { services: 'uslugi', quote: 'wycena', 'cnc-machining': 'obrobka-cnc', 'sheet-metal': 'obrobka-bluzy', 'injection-molding': 'wtrysk-tworzywa' },
  sv: { services: 'tjanster', quote: 'offert', 'cnc-machining': 'cnc-bearbetning', 'sheet-metal': 'platbearbetning', 'injection-molding': 'formsprutning' },
  da: { services: 'tjenester', quote: 'tilbud', 'cnc-machining': 'cnc-bearbejdning', 'sheet-metal': 'pladearbejde', 'injection-molding': 'sprojtestobning' },
  fi: { services: 'palvelut', quote: 'tarjous', 'cnc-machining': 'cnc-tyosto', 'sheet-metal': 'levytyosto', 'injection-molding': 'ruiskupuristus' },
  cs: { services: 'sluzby', quote: 'nabidka', 'cnc-machining': 'cnc-obrabeni', 'sheet-metal': 'obrabeni-plechu', 'injection-molding': 'vstrekovani' },
  hu: { services: 'szolgaltatasok', quote: 'ajanlat', 'cnc-machining': 'cnc-megmunkalas', 'sheet-metal': 'lemezfeldolgozas', 'injection-molding': 'frccsnyomas' },
  pt: { services: 'servicos', quote: 'orcamento', 'cnc-machining': 'usinagem-cnc', 'sheet-metal': 'chapa-metalica', 'injection-molding': 'moldagem-injecao' },
  nb: { services: 'tjenester', quote: 'tilbud', 'cnc-machining': 'cnc-bearbeiding', 'sheet-metal': 'platarbeid', 'injection-molding': 'sproytestoping' },
});

/** True for the 13 translation languages. */
export function isTargetLang(x: unknown): x is TargetLang {
  return typeof x === 'string' && (TARGET_LANGS as readonly string[]).includes(x);
}

/** Blog path segment of a language in public URLs (sitemap generator v19: blogg for sv and nb, blogi for fi). */
export function blogSegment(lang: string): string {
  if (lang === 'sv' || lang === 'nb') return 'blogg';
  if (lang === 'fi') return 'blogi';
  return 'blog';
}
