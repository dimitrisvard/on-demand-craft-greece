/**
 * Shared utilities for tender connectors
 */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

export function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function getBrowserHeaders(acceptLang = 'en-US,en;q=0.9') {
  return {
    'User-Agent': randomUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': acceptLang,
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
  };
}

export function getJsonHeaders() {
  return {
    'User-Agent': randomUA(),
    'Accept': 'application/json, application/xml, */*',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
  };
}

export function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseIsoDate(str) {
  if (!str) return undefined;
  try {
    const d = new Date(str);
    if (isNaN(d.getTime())) return undefined;
    return d.toISOString();
  } catch {
    return undefined;
  }
}

/**
 * Fetch with timeout + retries
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 20000, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return resp;
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) throw err;
      await delay(1000 * (attempt + 1));
    }
  }
}

export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Currency conversion to EUR (approximate fixed rates)
 */
const EUR_RATES = {
  EUR: 1,
  PLN: 0.23,   // Polish zloty
  SEK: 0.088,  // Swedish krona
  DKK: 0.134,  // Danish krone
  CZK: 0.041,  // Czech koruna
  HUF: 0.0026, // Hungarian forint
  RON: 0.20,   // Romanian leu
  BGN: 0.51,   // Bulgarian lev (pegged to EUR at ~1.956)
  HRK: 0.133,  // Croatian kuna (Croatia now uses EUR since 2023)
  NOK: 0.087,  // Norwegian krone
  CHF: 1.04,   // Swiss franc
  GBP: 1.18,   // British pound
  USD: 0.92,   // US dollar
};

export function toEur(amount, currency) {
  if (!amount || !currency) return undefined;
  const rate = EUR_RATES[currency.toUpperCase()];
  if (!rate) return amount; // assume EUR if unknown
  return Math.round(amount * rate);
}

/**
 * Parse value string like "EUR 45 000" or "45.000,00 €" or "45,000"
 */
export function parseValueString(str) {
  if (!str) return undefined;
  // Remove currency symbols and letters
  const cleaned = str
    .replace(/[€$£]/g, '')
    .replace(/[A-Z]{3}/gi, '')
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/\.(?=.*\.)/g, ''); // remove all but last dot
  const num = parseFloat(cleaned);
  if (isNaN(num)) return undefined;
  return num;
}
