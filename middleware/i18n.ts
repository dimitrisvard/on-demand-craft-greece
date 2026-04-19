import { Lang, LANGUAGES } from './types';
import en from '../src/locales/en/translation.json';
import de from '../src/locales/de/translation.json';
import fr from '../src/locales/fr/translation.json';
import es from '../src/locales/es/translation.json';
import it from '../src/locales/it/translation.json';
import nl from '../src/locales/nl/translation.json';
import pl from '../src/locales/pl/translation.json';
import pt from '../src/locales/pt/translation.json';
import sv from '../src/locales/sv/translation.json';
import da from '../src/locales/da/translation.json';
import fi from '../src/locales/fi/translation.json';
import nb from '../src/locales/nb/translation.json';
import hu from '../src/locales/hu/translation.json';
import cs from '../src/locales/cs/translation.json';

type Dict = Record<string, unknown>;

const DICTS: Record<Lang, Dict> = {
  en: en as Dict, de: de as Dict, fr: fr as Dict, es: es as Dict,
  it: it as Dict, nl: nl as Dict, pl: pl as Dict, pt: pt as Dict,
  sv: sv as Dict, da: da as Dict, fi: fi as Dict, nb: nb as Dict,
  hu: hu as Dict, cs: cs as Dict,
};

/**
 * Translate a key for a given language. Falls back to English, then to `fallback`, then to the key itself.
 * Only returns strings; arrays/objects return the fallback.
 */
export function t(lang: Lang, key: string, fallback?: string): string {
  const direct = DICTS[lang]?.[key];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const enVal = DICTS.en[key];
  if (typeof enVal === 'string' && enVal.length > 0) return enVal;
  return fallback ?? key;
}

export function tArray(lang: Lang, key: string): string[] {
  const direct = DICTS[lang]?.[key];
  if (Array.isArray(direct)) return direct.filter((x) => typeof x === 'string') as string[];
  const enVal = DICTS.en[key];
  if (Array.isArray(enVal)) return enVal.filter((x) => typeof x === 'string') as string[];
  return [];
}

export { LANGUAGES };
