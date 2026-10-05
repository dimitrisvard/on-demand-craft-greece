// Removes quoted history from the plain text of an inbound mail, so the model and the inbox see the new message.
//
// Rules
//   - The text is cut at the first reply header: a line (or two lines joined, as some clients wrap it) that holds a
//     date-like digit, ends with ':' and holds the "wrote" verb of one of the supported languages (en, de, fr, it,
//     es, pt, nl, el, pl, cs, hu, ro, sv/da/no, tr, bg), or an Outlook separator ('-----Original Message-----' and
//     its translations, or a From:/Sent:/To: header block in those languages, also after a '____' rule line).
//   - Lines starting with '>' are removed wherever they are.
//   - A forwarded message keeps its content: when less than MIN_OWN_TEXT non-space characters would remain before
//     the cut, the cut is not made (the quoted part is the message, e.g. a forwarded enquiry).
//   - Line endings become '\n'; runs of blank lines collapse to one; the result is trimmed.

export const MIN_OWN_TEXT = 20;

const WROTE = [
  'wrote', 'writes', 'schrieb', 'a écrit', 'a ecrit', 'ha scritto', 'escribió', 'escribio', 'escreveu', 'schreef',
  'έγραψε', 'napisał\\(a\\)', 'napisała', 'napisał', 'napsal\\(a\\)', 'napsala', 'napsal', 'ezt írta', 'írta',
  'a scris', 'skrev', 'şunu yazdı', 'yazdı', 'написа',
];
const WROTE_RE = new RegExp(`(?:${WROTE.join('|')})\\s*:\\s*$`, 'i');
// Languages that put the verb before the sender ('Am ... schrieb Hans <...>:', 'Op ... schreef Jan <...>:').
const WROTE_BEFORE_RE = new RegExp(`(?:^|\\s)(?:${WROTE.join('|')})\\s.*:\\s*$`, 'i');

const SEPARATOR_RE = new RegExp(
  [
    '^-{2,}\\s*(original message|ursprüngliche nachricht|message d\'origine|messaggio originale|mensaje original|mensagem original|oorspronkelijk bericht|αρχικό μήνυμα|wiadomość oryginalna|původní zpráva|eredeti üzenet|mesaj original|ursprungligt meddelande|oprindelig meddelelse)\\s*-{2,}\\s*$',
  ].join('|'),
  'i',
);

const FROM_LABELS = ['from', 'von', 'de', 'da', 'van', 'από', 'od', 'feladó', 'från', 'fra', 'kimden', 'от'];
const SENT_LABELS = ['sent', 'date', 'gesendet', 'datum', 'envoyé', 'envoye', 'inviato', 'data', 'enviado', 'enviada', 'fecha', 'verzonden', 'datum', 'στάλθηκε', 'ημερομηνία', 'wysłano', 'odesláno', 'elküldve', 'dátum', 'trimis', 'skickat', 'sendt', 'gönderildi', 'tarih', 'изпратено'];
const FROM_LINE_RE = new RegExp(`^\\*?(?:${FROM_LABELS.join('|')})\\*?\\s*:\\s*\\S`, 'i');
const SENT_LINE_RE = new RegExp(`^\\*?(?:${SENT_LABELS.join('|')})\\*?\\s*:\\s*\\S`, 'i');

function isReplyHeader(line: string): boolean {
  const value = line.trim();
  return value.length > 0 && value.length <= 400 && /\d/.test(value) && (WROTE_RE.test(value) || WROTE_BEFORE_RE.test(value));
}

/** Index of the first line of quoted history, or -1. */
export function quoteStart(lines: readonly string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isReplyHeader(line)) return i;
    if (i + 1 < lines.length && !isReplyHeader(line) && isReplyHeader(`${line.trim()} ${lines[i + 1].trim()}`)) return i;
    if (SEPARATOR_RE.test(line.trim())) return i;
    const rule = /^_{10,}\s*$/.test(line.trim());
    const headerAt = rule ? i + 1 : i;
    if (headerAt + 1 < lines.length && FROM_LINE_RE.test(lines[headerAt].trim())) {
      const next = lines.slice(headerAt + 1, headerAt + 3).map((l) => l.trim());
      if (next.some((l) => SENT_LINE_RE.test(l))) return i;
    }
  }
  return -1;
}

function tidy(lines: readonly string[]): string {
  return lines
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripQuoted(text: string): string {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const unquoted = lines.filter((l) => !/^\s*>/.test(l));
  const start = quoteStart(unquoted);
  if (start < 0) return tidy(unquoted);
  const own = unquoted.slice(0, start);
  if (own.join('').replace(/\s+/g, '').length < MIN_OWN_TEXT) return tidy(unquoted);
  return tidy(own);
}
