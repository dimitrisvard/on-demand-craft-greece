// Tolerant parsing of the partner GraphQL payloads, ported from xometry-bot/xometry_bot/models.py: the lax
// coercion of pydantic v2 for the field types used there, the same before-validators, the same aliases and the
// same error locations (golden vectors in test/fixtures/xometry/golden.json).
//
// Rules (pydantic lax mode as measured with the real models)
//   - Objects: the alias is read first, then the field name (populate_by_name); unknown keys are ignored; a missing
//     required field is an error at the alias; every error of the payload is collected, in field order.
//   - str: strings only. int: integers, booleans, integral floats, and strings of ASCII digits with optional sign,
//     single underscores between digits and an optional '.0…' tail (surrounding white space ignored). float:
//     numbers, booleans and Python float() strings (inf and nan included). bool: booleans, 0/1, and the strings
//     0/1/f/t/n/y/no/yes/off/on/false/true in any case.
//   - int | str (smart union): a string stays a string, everything else is read as an int; a failure reports both
//     branches ('<field>.int', '<field>.str').
//   - Lists: arrays only, item errors at the index.
//   - Money: a bare number (or boolean) is the amount; 'value' becomes 'amount' and 'currencyCode' becomes
//     'currency' only when the canonical key is absent; currency defaults to 'EUR'.
//   - allowCounterofferFrom: an object gives its 'amount' key when present, else its 'value'.
//   - leadtime: numbers are epoch seconds (milliseconds above 1e11) read as a UTC date; a non-empty string is
//     date.fromisoformat() of its first 10 characters (no time-zone conversion); '' is an error.
//   - publicationStart / publicationEnd: numbers above 1e11 are milliseconds; other numbers and numeric strings are
//     epoch seconds, or milliseconds above 2e10 (pydantic's own rule); strings are ISO 8601 date-times (a date alone
//     is midnight without zone). The value is kept in pydantic's JSON form.
//   - A page is valid only as a whole: one bad offer fails the page.

import { pyRoundInt } from './pyfmt';
import { XometrySchemaError, type JobInfo, type JobOffer, type JobOfferPart, type Money, type PartFile, type ScanMetadata, type ScanPage, type Tag } from './types';

type Loc = string[];

interface Issue {
  loc: Loc;
  type: string;
}

interface Ctx {
  issues: Issue[];
}

const INVALID: unique symbol = Symbol('invalid');
type Result<T> = T | typeof INVALID;
type Validator<T> = (v: unknown, loc: Loc, ctx: Ctx) => Result<T>;

function fail(ctx: Ctx, loc: Loc, type: string): typeof INVALID {
  ctx.issues.push({ loc, type });
  return INVALID;
}

function has(o: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ----- scalar validators -----

const str: Validator<string> = (v, loc, ctx) => (typeof v === 'string' ? v : fail(ctx, loc, 'string_type'));

const INT_TEXT = /^[+-]?\d+(?:_\d+)*(?:\.0+)?$/;

const int: Validator<number> = (v, loc, ctx) => {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return fail(ctx, loc, 'finite_number');
    if (!Number.isInteger(v)) return fail(ctx, loc, 'int_from_float');
    return v === 0 ? 0 : v;
  }
  if (typeof v === 'string') {
    const t = v.trim();
    if (!INT_TEXT.test(t)) return fail(ctx, loc, 'int_parsing');
    const n = Number(t.replace(/_/g, '').replace(/\.0+$/, ''));
    return n === 0 ? 0 : n;
  }
  return fail(ctx, loc, 'int_type');
};

const DIGITS = '\\d+(?:_\\d+)*';
const FLOAT_TEXT = new RegExp(`^[+-]?(?:(?:${DIGITS}(?:\\.(?:${DIGITS})?)?|\\.${DIGITS})(?:[eE][+-]?${DIGITS})?)$`);
const FLOAT_SPECIAL = /^([+-]?)(inf|infinity|nan)$/i;

/** Python float() of a string, or null when Python refuses it. */
export function pyFloatText(text: string): number | null {
  const t = text.trim();
  const special = FLOAT_SPECIAL.exec(t);
  if (special) {
    if (special[2].toLowerCase() === 'nan') return NaN;
    return special[1] === '-' ? -Infinity : Infinity;
  }
  if (!FLOAT_TEXT.test(t)) return null;
  return Number(t.replace(/_/g, ''));
}

const float: Validator<number> = (v, loc, ctx) => {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = pyFloatText(v);
    return n === null ? fail(ctx, loc, 'float_parsing') : n;
  }
  return fail(ctx, loc, 'float_type');
};

const TRUE_TEXT = new Set(['1', 'on', 't', 'true', 'y', 'yes']);
const FALSE_TEXT = new Set(['0', 'off', 'f', 'false', 'n', 'no']);

const bool: Validator<boolean> = (v, loc, ctx) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') {
    if (v === 0) return false;
    if (v === 1) return true;
    return fail(ctx, loc, Number.isInteger(v) ? 'bool_parsing' : 'bool_type');
  }
  if (typeof v === 'string') {
    const t = v.toLowerCase();
    if (TRUE_TEXT.has(t)) return true;
    if (FALSE_TEXT.has(t)) return false;
    return fail(ctx, loc, 'bool_parsing');
  }
  return fail(ctx, loc, 'bool_type');
};

const intOrStr: Validator<number | string> = (v, loc, ctx) => {
  if (typeof v === 'string') return v;
  const probe: Ctx = { issues: [] };
  const n = int(v, loc, probe);
  if (n !== INVALID) return n;
  ctx.issues.push({ loc: [...loc, 'int'], type: probe.issues[0]?.type ?? 'int_type' }, { loc: [...loc, 'str'], type: 'string_type' });
  return INVALID;
};

function nullable<T>(inner: Validator<T>): Validator<T | null> {
  return (v, loc, ctx) => (v === null ? null : inner(v, loc, ctx));
}

function list<T>(item: Validator<T>): Validator<T[]> {
  return (v, loc, ctx) => {
    if (!Array.isArray(v)) return fail(ctx, loc, 'list_type');
    const out: T[] = [];
    let bad = false;
    v.forEach((x, i) => {
      const r = item(x, [...loc, String(i)], ctx);
      if (r === INVALID) bad = true;
      else out.push(r);
    });
    return bad ? INVALID : out;
  };
}

const anyObject: Validator<Record<string, unknown>> = (v, loc, ctx) => (isObject(v) ? v : fail(ctx, loc, 'dict_type'));

// ----- dates and date-times -----

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function validYmd(y: number, m: number, d: number): boolean {
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1) return false;
  return d <= (m === 2 && isLeap(y) ? 29 : DAYS_IN_MONTH[m - 1]);
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function ymd(y: number, m: number, d: number): string {
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

/** Days from 1970-01-01 of a proleptic Gregorian date (years 1-9999). */
function daysFromCivil(y: number, m: number, d: number): number {
  const t = new Date(Date.UTC(2000, m - 1, d));
  t.setUTCFullYear(y);
  return Math.round(t.getTime() / 86_400_000);
}

/** Calendar parts of a day count; NaN parts beyond the Date range (±8.64e15 ms), which no year check accepts. */
function civilFromDays(days: number): [number, number, number] {
  const t = new Date(days * 86_400_000);
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}

/** True for a year CPython's date accepts (1-9999); false for NaN. */
function inYearRange(y: number): boolean {
  return y >= 1 && y <= 9999;
}

/** ISO weeks of a year: 53 when 1 January is a Thursday, or a Wednesday in a leap year. */
function isoWeeksIn(y: number): number {
  const jan1 = (daysFromCivil(y, 1, 1) % 7 + 7 + 3) % 7; // 0 = Monday
  return jan1 === 3 || (jan1 === 2 && isLeap(y)) ? 53 : 52;
}

/** Python 3.11 date.fromisoformat(): YYYY-MM-DD, YYYYMMDD, YYYY-Www[-D], YYYYWww[D]; throws on anything else. */
export function pyDateFromIso(text: string): string {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!validYmd(y, mo, d)) throw new RangeError(`Invalid isoformat string: ${JSON.stringify(text)}`);
    return ymd(y, mo, d);
  }
  m = /^(\d{4})-W(\d{2})(?:-([0-9]))?$/.exec(text) ?? /^(\d{4})W(\d{2})([0-9])?$/.exec(text);
  if (m) {
    const y = Number(m[1]);
    const week = Number(m[2]);
    const day = m[3] === undefined ? 1 : Number(m[3]);
    if (y < 1 || week < 1 || week > isoWeeksIn(y) || day < 1 || day > 7) throw new RangeError(`Invalid isoformat string: ${JSON.stringify(text)}`);
    const jan4 = daysFromCivil(y, 1, 4);
    const jan4Weekday = (jan4 % 7 + 7 + 3) % 7; // 0 = Monday
    const [yy, mm, dd] = civilFromDays(jan4 - jan4Weekday + (week - 1) * 7 + (day - 1));
    if (!inYearRange(yy)) throw new RangeError(`Invalid isoformat string: ${JSON.stringify(text)}`);
    return ymd(yy, mm, dd);
  }
  throw new RangeError(`Invalid isoformat string: ${JSON.stringify(text)}`);
}

interface Instant {
  /** Days since 1970-01-01 (UTC calendar). */
  days: number;
  /** Seconds into the day. */
  seconds: number;
  micros: number;
}

/** Epoch seconds (with fraction) as UTC calendar parts; microseconds rounded half to even, as CPython does. null
 *  outside years 1-9999, values beyond the JavaScript Date range included (CPython refuses them too). */
function instantOf(seconds: number): Instant | null {
  if (!Number.isFinite(seconds)) return null;
  let whole = Math.floor(seconds);
  let micros = pyRoundInt((seconds - whole) * 1e6);
  if (micros >= 1_000_000) {
    whole += 1;
    micros -= 1_000_000;
  }
  const days = Math.floor(whole / 86_400);
  const [y] = civilFromDays(days);
  if (!inYearRange(y)) return null;
  return { days, seconds: whole - days * 86_400, micros };
}

function formatInstant(i: Instant, zone: string): string {
  const [y, m, d] = civilFromDays(i.days);
  const hh = Math.floor(i.seconds / 3600);
  const mm = Math.floor((i.seconds % 3600) / 60);
  const ss = i.seconds % 60;
  const frac = i.micros ? `.${pad(i.micros, 6)}` : '';
  return `${ymd(y, m, d)}T${pad(hh, 2)}:${pad(mm, 2)}:${pad(ss, 2)}${frac}${zone}`;
}

/** The UTC date of epoch seconds (CPython datetime.fromtimestamp(ts, UTC).date()); throws outside years 1-9999. */
function utcDateOfSeconds(seconds: number): string {
  const i = instantOf(seconds);
  if (!i) throw new RangeError('timestamp out of range');
  const [y, m, d] = civilFromDays(i.days);
  return ymd(y, m, d);
}

/** pydantic's datetime from a number: seconds, or milliseconds when |n| > 2e10; JSON form in UTC ('Z'). */
function datetimeFromNumber(n: number): string | null {
  const seconds = Math.abs(n) > 2e10 ? n / 1000 : n;
  const i = instantOf(seconds);
  return i ? formatInstant(i, 'Z') : null;
}

const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt _](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(?:([Zz])|([+-])(\d{2}):?(\d{2}))?)?$/;
const NUMERIC_TEXT = /^[+-]?\d+(?:\.\d+)?$/;

/** pydantic's datetime from a string, in its JSON form, or null when pydantic refuses it. */
function datetimeFromText(text: string): string | null {
  if (NUMERIC_TEXT.test(text)) return datetimeFromNumber(Number(text));
  const m = ISO_DATETIME.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!validYmd(y, mo, d)) return null;
  if (m[4] === undefined) return `${ymd(y, mo, d)}T00:00:00`;
  const [hh, mi, ss] = [Number(m[4]), Number(m[5]), m[6] === undefined ? 0 : Number(m[6])];
  if (hh > 23 || mi > 59 || ss > 59) return null;
  const micros = m[7] === undefined ? 0 : Number(m[7].slice(0, 6).padEnd(6, '0'));
  let zone = '';
  if (m[8]) zone = 'Z';
  else if (m[9]) {
    const [oh, om] = [Number(m[10]), Number(m[11])];
    if (oh > 23 || om > 59) return null;
    zone = oh === 0 && om === 0 ? 'Z' : `${m[9]}${pad(oh, 2)}:${pad(om, 2)}`;
  }
  const frac = micros ? `.${pad(micros, 6)}` : '';
  return `${ymd(y, mo, d)}T${pad(hh, 2)}:${pad(mi, 2)}:${pad(ss, 2)}${frac}${zone}`;
}

/** A date produced by a before-validator (the field then accepts it as it is). */
class PyDate {
  constructor(readonly iso: string) {}
}

/** models._coerce_date (before-validator of leadtime). Throws like Python for an unreadable string. */
function coerceDate(v: unknown): unknown {
  if (v === null) return v;
  if (typeof v === 'number' || typeof v === 'boolean') {
    const n = Number(v);
    const seconds = Math.abs(n) > 1e11 ? n / 1000 : n;
    return new PyDate(utcDateOfSeconds(seconds));
  }
  if (typeof v === 'string' && v !== '') return new PyDate(pyDateFromIso(v.slice(0, 10)));
  return v;
}

const date: Validator<string> = (v, loc, ctx) => (v instanceof PyDate ? v.iso : fail(ctx, loc, typeof v === 'string' ? 'date_from_datetime_parsing' : 'date_type'));

/** A date-time already decided by a before-validator (milliseconds above 1e11). */
class PyDatetime {
  constructor(readonly json: string) {}
}

/** models._coerce_datetime (before-validator of publication_*). */
function coerceDatetime(v: unknown): unknown {
  if (typeof v === 'number' && Math.abs(v) > 1e11) {
    const i = instantOf(v / 1000);
    if (!i) throw new RangeError('timestamp out of range');
    return new PyDatetime(formatInstant(i, 'Z'));
  }
  return v;
}

const datetime: Validator<string> = (v, loc, ctx) => {
  if (v instanceof PyDatetime) return v.json;
  if (typeof v === 'number') return datetimeFromNumber(v) ?? fail(ctx, loc, 'datetime_from_number');
  if (typeof v === 'string') return datetimeFromText(v) ?? fail(ctx, loc, 'datetime_from_date_parsing');
  return fail(ctx, loc, 'datetime_type');
};

// ----- models -----

interface Field {
  name: string;
  alias?: string;
  /** Default when the key is absent; no default = required. */
  default?: () => unknown;
  validate: Validator<unknown>;
  /** A mode="before" field validator; a throw is an error at the field. */
  before?: (v: unknown) => unknown;
}

function model<T>(fields: readonly Field[], before?: (data: unknown) => unknown): Validator<T> {
  return (v, loc, ctx) => {
    const data = before ? before(v) : v;
    if (!isObject(data)) return fail(ctx, loc, 'model_type');
    const out: Record<string, unknown> = {};
    let bad = false;
    for (const f of fields) {
      const key = f.alias !== undefined && has(data, f.alias) ? f.alias : has(data, f.name) ? f.name : undefined;
      if (key === undefined) {
        if (f.default) out[f.name] = f.default();
        else {
          fail(ctx, [...loc, f.alias ?? f.name], 'missing');
          bad = true;
        }
        continue;
      }
      const fieldLoc = [...loc, key];
      let raw = data[key];
      if (f.before) {
        try {
          raw = f.before(raw);
        } catch {
          fail(ctx, fieldLoc, 'value_error');
          bad = true;
          continue;
        }
      }
      const r = f.validate(raw, fieldLoc, ctx);
      if (r === INVALID) bad = true;
      else out[f.name] = r;
    }
    return bad ? INVALID : (out as T);
  };
}

const NULL = () => null;
const FALSE = () => false;
const EMPTY_LIST = () => [];

function normaliseMoney(data: unknown): unknown {
  if (typeof data === 'number' || typeof data === 'boolean') return { amount: Number(data) };
  if (isObject(data)) {
    const d = { ...data };
    if (!has(d, 'amount') && has(d, 'value')) {
      d.amount = d.value;
      delete d.value;
    }
    if (!has(d, 'currency') && has(d, 'currencyCode')) {
      d.currency = d.currencyCode;
      delete d.currencyCode;
    }
    return d;
  }
  return data;
}

const money = model<Money>(
  [
    { name: 'amount', validate: float },
    { name: 'currency', default: () => 'EUR', validate: str },
  ],
  normaliseMoney,
);

const tag = model<Tag>([
  { name: 'id', validate: int },
  { name: 'name', validate: str },
  { name: 'context', default: () => '', validate: str },
]);

const partFile = model<PartFile>([
  { name: 'id', default: NULL, validate: nullable(intOrStr) },
  { name: 'name', validate: str },
  { name: 'download_url', alias: 'downloadUrl', default: NULL, validate: nullable(str) },
  { name: 'preview', default: NULL, validate: nullable(str) },
  { name: 'large_url', alias: 'largeUrl', default: NULL, validate: nullable(str) },
]);

const jobInfo = model<JobInfo>([
  { name: 'public_comment', alias: 'publicComment', default: NULL, validate: nullable(str) },
  { name: 'state', alias: 'jobState', default: NULL, validate: nullable(str) },
]);

const jobOfferPart = model<JobOfferPart>([
  { name: 'code', default: NULL, validate: nullable(str) },
  { name: 'name', default: NULL, validate: nullable(str) },
  { name: 'material', default: NULL, validate: nullable(str) },
  { name: 'process_type', alias: 'processType', default: NULL, validate: nullable(str) },
  { name: 'quantity', default: NULL, validate: nullable(int) },
  { name: 'dimensions', default: NULL, validate: nullable(str) },
  { name: 'weight_kg', alias: 'weightKg', default: NULL, validate: nullable(float) },
  { name: 'volume_mm3', alias: 'volumeMm3', default: NULL, validate: nullable(float) },
  { name: 'finish', default: () => '', validate: str, before: (v) => (v === null ? '' : v) },
  { name: 'production_remark', alias: 'productionRemark', default: NULL, validate: nullable(str) },
  { name: 'measurement_protocol_needed', alias: 'measurementProtocolNeeded', default: FALSE, validate: bool },
  { name: 'samples_needed', alias: 'samplesNeeded', default: FALSE, validate: bool },
  { name: 'tags', default: EMPTY_LIST, validate: list(tag) },
  { name: 'files', default: EMPTY_LIST, validate: list(partFile) },
]);

/** allowCounterofferFrom: an object gives v.get("amount", v.get("value")). */
function moneyOrNumber(v: unknown): unknown {
  if (isObject(v)) return has(v, 'amount') ? v.amount : has(v, 'value') ? v.value : null;
  return v;
}

const jobOffer = model<JobOffer>([
  { name: 'id', validate: intOrStr },
  { name: 'code', validate: str },
  { name: 'allow_autoaccept', alias: 'allowAutoaccept', default: NULL, validate: nullable(bool) },
  { name: 'allow_counteroffer_from', alias: 'allowCounterofferFrom', default: NULL, validate: nullable(float), before: moneyOrNumber },
  { name: 'cost', default: NULL, validate: nullable(money) },
  { name: 'leadtime', default: NULL, validate: nullable(date), before: coerceDate },
  { name: 'is_urgent', alias: 'isUrgent', default: FALSE, validate: bool },
  { name: 'job_id', alias: 'jobId', default: NULL, validate: nullable(intOrStr) },
  { name: 'job', default: NULL, validate: nullable(jobInfo) },
  { name: 'parts', default: EMPTY_LIST, validate: list(jobOfferPart) },
  { name: 'publication_start', alias: 'publicationStart', default: NULL, validate: nullable(datetime), before: coerceDatetime },
  { name: 'publication_end', alias: 'publicationEnd', default: NULL, validate: nullable(datetime), before: coerceDatetime },
  { name: 'raw', default: () => ({}), validate: anyObject },
]);

const scanMetadata = model<ScanMetadata>([
  { name: 'has_more', alias: 'hasMore', validate: bool },
  { name: 'limit', default: () => 0, validate: int },
  { name: 'offset', default: () => 0, validate: int },
  { name: 'total_count', alias: 'totalCount', default: NULL, validate: nullable(int) },
]);

const scanPage = model<ScanPage>([
  { name: 'metadata', validate: scanMetadata },
  { name: 'offers', validate: list(jobOffer) },
]);

function parseWith<T>(validator: Validator<T>, v: unknown): T {
  const ctx: Ctx = { issues: [] };
  const r = validator(v, [], ctx);
  if (r === INVALID || ctx.issues.length > 0) throw new XometrySchemaError(ctx.issues.map((i) => i.loc));
  return r;
}

export function parseMoney(v: unknown): Money {
  return parseWith(money, v);
}

/** A JobOffer with raw = {} (the partner client attaches the received object). */
export function parseJobOffer(v: unknown): JobOffer {
  return parseWith(jobOffer, v);
}

/** One page of gshJobOffers; one bad offer fails the page. */
export function parseScanPage(v: unknown): ScanPage {
  return parseWith(scanPage, v);
}

/** The parsed offer without raw (pydantic's model_dump(mode="json"), where raw is excluded). */
export function dumpJobOffer(o: JobOffer): Omit<JobOffer, 'raw'> {
  const { raw: _raw, ...rest } = o;
  return rest;
}
