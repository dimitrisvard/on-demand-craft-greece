// Rendering of the frozen content prompts (src/content/prompts/*.md). Each file is the live template text with
// its substitutions written exactly as in the live source (`${title}`, `${selectedService.url}`, ...).
//
// Rules
//   - Every `${...}` of the template must have a value, and every value must be used: a mismatch throws (a template
//     and its caller can never drift apart silently).
//   - One pass: a value that itself contains `${...}` (article text) is inserted as it is, never expanded.

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

const PLACEHOLDER = /\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;

/** The expressions of a template in order of first appearance. */
export function placeholders(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(PLACEHOLDER)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** The template with each `${expr}` replaced by values[expr]. */
export function renderTemplate(template: string, values: Readonly<Record<string, string>>): string {
  const used = new Set<string>();
  const text = template.replace(PLACEHOLDER, (_m, expr: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, expr)) throw new TemplateError(`template value missing: ${expr}`);
    used.add(expr);
    return values[expr];
  });
  for (const key of Object.keys(values)) if (!used.has(key)) throw new TemplateError(`template value unused: ${key}`);
  return text;
}
