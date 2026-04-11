/**
 * Seed the `gsc_monitored_urls` table with the canonical landing pages for
 * Microns Hub: homepage + 6 service subpages for each of the 14 languages.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... tsx scripts/seed-gsc-monitored-urls.ts
 *
 * Safe to re-run — uses upsert on `url` uniqueness.
 *
 * The slug dictionary is duplicated from api/sitemap.js on purpose: this
 * script only runs from a dev box and we want to keep it dependency-free.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}

const BASE_URL = 'https://www.micronshub.eu';

const SLUGS: Record<string, { services: string; cnc: string; sheetMetal: string; printing: string; injection: string; surface: string; rapid: string }> = {
  en: { services: 'services', cnc: 'cnc-machining', sheetMetal: 'sheet-metal', printing: '3d-printing', injection: 'injection-molding', surface: 'surface-finishes', rapid: 'rapid-prototyping' },
  de: { services: 'dienstleistungen', cnc: 'cnc-bearbeitung', sheetMetal: 'blechbearbeitung', printing: '3d-druck', injection: 'spritzguss', surface: 'oberflaechenveredelung', rapid: 'rapid-prototyping' },
  fr: { services: 'services', cnc: 'usinage-cnc', sheetMetal: 'tolerie', printing: 'impression-3d', injection: 'injection-plastique', surface: 'finition-surface', rapid: 'prototypage-rapide' },
  es: { services: 'servicios', cnc: 'mecanizado-cnc', sheetMetal: 'chapa-metalica', printing: 'impresion-3d', injection: 'moldeo-por-inyeccion', surface: 'acabados-superficie', rapid: 'prototipado-rapido' },
  it: { services: 'servizi', cnc: 'lavorazione-cnc', sheetMetal: 'lavorazione-lamiera', printing: 'stampa-3d', injection: 'stampaggio-iniezione', surface: 'finitura-superficie', rapid: 'prototipazione-rapida' },
  nl: { services: 'diensten', cnc: 'cnc-bewerking', sheetMetal: 'plaatbewerking', printing: '3d-printen', injection: 'spuitgieten', surface: 'oppervlakteafwerking', rapid: 'rapid-prototyping' },
  pl: { services: 'uslugi', cnc: 'obrobka-cnc', sheetMetal: 'obrobka-bluzy', printing: 'druk-3d', injection: 'wtrysk-tworzywa', surface: 'wykonczenie-powierzchni', rapid: 'szybkie-prototypowanie' },
  pt: { services: 'servicos', cnc: 'usinagem-cnc', sheetMetal: 'chapa-metalica', printing: 'impressao-3d', injection: 'moldagem-injecao', surface: 'acabamento-superficie', rapid: 'prototipagem-rapida' },
  sv: { services: 'tjanster', cnc: 'cnc-bearbetning', sheetMetal: 'platbearbetning', printing: '3d-skrivning', injection: 'formsprutning', surface: 'ytbehandling', rapid: 'snabb-prototypering' },
  da: { services: 'tjenester', cnc: 'cnc-bearbejdning', sheetMetal: 'pladearbejde', printing: '3d-printing', injection: 'sprojtestobning', surface: 'overfladebehandling', rapid: 'hurtig-prototypering' },
  fi: { services: 'palvelut', cnc: 'cnc-tyosto', sheetMetal: 'levytyosto', printing: '3d-tulostus', injection: 'ruiskupuristus', surface: 'pinnan-viimeistely', rapid: 'nopea-prototyyppaus' },
  nb: { services: 'tjenester', cnc: 'cnc-bearbeiding', sheetMetal: 'platarbeid', printing: '3d-printing', injection: 'sproytestoping', surface: 'overflatebehandling', rapid: 'rask-prototyping' },
  hu: { services: 'szolgaltatasok', cnc: 'cnc-megmunkalas', sheetMetal: 'lemezfeldolgozas', printing: '3d-nyomtas', injection: 'frccsnyomas', surface: 'feluletkezeles', rapid: 'gyors-prototipus' },
  cs: { services: 'sluzby', cnc: 'cnc-obrabeni', sheetMetal: 'obrabeni-plechu', printing: '3d-tisk', injection: 'vstrekovani', surface: 'uprava-povrchu', rapid: 'rychle-prototypovani' },
};

const SERVICES: Array<{ key: keyof (typeof SLUGS)['en']; label: string; priority: number }> = [
  { key: 'cnc', label: 'CNC Machining', priority: 10 },
  { key: 'sheetMetal', label: 'Sheet Metal', priority: 9 },
  { key: 'printing', label: '3D Printing', priority: 9 },
  { key: 'injection', label: 'Injection Molding', priority: 8 },
  { key: 'surface', label: 'Surface Finishes', priority: 7 },
  { key: 'rapid', label: 'Rapid Prototyping', priority: 7 },
];

async function main() {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows: Array<{ url: string; label: string; language: string; service_type: string | null; priority: number }> = [];

  for (const [lang, slugs] of Object.entries(SLUGS)) {
    // Homepage
    rows.push({
      url: `${BASE_URL}/${lang}`,
      label: `${lang.toUpperCase()} — Home`,
      language: lang,
      service_type: 'home',
      priority: 10,
    });
    // Services index
    rows.push({
      url: `${BASE_URL}/${lang}/${slugs.services}`,
      label: `${lang.toUpperCase()} — Services`,
      language: lang,
      service_type: 'services_index',
      priority: 9,
    });
    // Each service
    for (const svc of SERVICES) {
      rows.push({
        url: `${BASE_URL}/${lang}/${slugs.services}/${slugs[svc.key]}`,
        label: `${lang.toUpperCase()} — ${svc.label}`,
        language: lang,
        service_type: svc.key,
        priority: svc.priority,
      });
    }
  }

  console.log(`Upserting ${rows.length} rows into gsc_monitored_urls…`);

  // Upsert in chunks of 50 to stay well under API limits.
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const { error } = await supabase
      .from('gsc_monitored_urls')
      .upsert(chunk, { onConflict: 'url' });
    if (error) {
      console.error(`Chunk ${i / 50} failed:`, error.message);
      process.exit(1);
    }
  }
  console.log(`✅ Seeded ${rows.length} monitored URLs (14 languages × 8 pages).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
