// Python-compatible number formatting for the Xometry port: CPython rounds a float to n decimals on its exact
// binary value with ties to even (round(x, 2), f"{x:.2f}", f"{x:.0%}"), while JavaScript's toFixed rounds ties
// away from zero. Every figure the scanner writes or prints goes through these helpers.
//
// Rules
//   - The exact decimal expansion of the double comes from toFixed(100) (exact for |x| >= 2^-48; smaller values
//     round to zero at the precisions used here, and an exact tie is impossible there).
//   - pyRound returns the double nearest to the rounded decimal (as CPython does); a negative value that rounds to
//     zero stays -0.
//   - pyFixed formats like f"{x:.nf}": 'inf', '-inf', 'nan'; a negative value keeps its sign ('-0.00').
//   - n is a small non-negative integer (0-20).

interface Decimal {
  negative: boolean;
  /** Integer digits without sign (at least one digit). */
  int: string;
  /** Fraction digits (may be empty). */
  frac: string;
}

function exactDecimal(x: number): Decimal {
  const negative = x < 0 || Object.is(x, -0);
  const abs = Math.abs(x);
  if (abs >= 1e21) return { negative, int: BigInt(abs).toString(), frac: '' };
  const text = abs.toFixed(100);
  const dot = text.indexOf('.');
  return { negative, int: text.slice(0, dot), frac: text.slice(dot + 1) };
}

/** Adds one unit in the last place of a digit string ('199' -> '200', '99' -> '100'). */
function incrementDigits(digits: string): string {
  const out = digits.split('');
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] === '9') {
      out[i] = '0';
      continue;
    }
    out[i] = String(Number(out[i]) + 1);
    return out.join('');
  }
  return `1${out.join('')}`;
}

/** The decimal digits of x rounded to n fraction digits, ties to even: {negative, int, frac (exactly n digits)}. */
function roundedDecimal(x: number, n: number): Decimal {
  if (!Number.isInteger(n) || n < 0 || n > 20) throw new RangeError('ndigits must be an integer from 0 to 20');
  const d = exactDecimal(x);
  const frac = d.frac.padEnd(n, '0');
  const kept = frac.slice(0, n);
  const rest = frac.slice(n);
  let up = false;
  const first = rest.charAt(0) || '0';
  if (first > '5') up = true;
  else if (first === '5') {
    const tail = rest.slice(1);
    if (/[1-9]/.test(tail)) up = true;
    else {
      const last = (d.int + kept).slice(-1);
      up = Number(last) % 2 === 1;
    }
  }
  let digits = d.int + kept;
  if (up) digits = incrementDigits(digits);
  const intLen = digits.length - n;
  return { negative: d.negative, int: digits.slice(0, intLen) || '0', frac: digits.slice(intLen) };
}

/** CPython round(x, n) for a float. */
export function pyRound(x: number, n: number): number {
  if (!Number.isFinite(x)) return x;
  if (Math.abs(x) >= 1e21) return x;
  const r = roundedDecimal(x, n);
  const value = Number(`${r.int}${n > 0 ? `.${r.frac}` : ''}`);
  return r.negative ? -value : value;
}

/** CPython f"{x:.{n}f}". */
export function pyFixed(x: number, n: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  const r = roundedDecimal(x, n);
  return `${r.negative ? '-' : ''}${r.int}${n > 0 ? `.${r.frac}` : ''}`;
}

/** CPython f"{x:.0%}" (x * 100 in floating point, then fixed with no decimals, then '%'). */
export function pyPercent0(x: number): string {
  return `${pyFixed(x * 100, 0)}%`;
}

/** CPython round(x) for a float (ties to even), as an integer. */
export function pyRoundInt(x: number): number {
  return pyRound(x, 0);
}
