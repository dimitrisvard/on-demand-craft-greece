import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en/translation.json';
import de from './locales/de/translation.json';
import fr from './locales/fr/translation.json';
import it from './locales/it/translation.json';
import pl from './locales/pl/translation.json';
import pt from './locales/pt/translation.json';
import es from './locales/es/translation.json';
import nl from './locales/nl/translation.json';
import cs from './locales/cs/translation.json';
import hu from './locales/hu/translation.json';
import sv from './locales/sv/translation.json';
import nb from './locales/nb/translation.json';
import fi from './locales/fi/translation.json';
import da from './locales/da/translation.json';

const resources = {
  en: { translation: en },
  de: { translation: de },
  fr: { translation: fr },
  it: { translation: it },
  pl: { translation: pl },
  pt: { translation: pt },
  es: { translation: es },
  nl: { translation: nl },
  cs: { translation: cs },
  hu: { translation: hu },
  sv: { translation: sv },
  nb: { translation: nb },
  fi: { translation: fi },
  da: { translation: da },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

export default i18n; 