// Prompt registry: prompt id -> {file, schema, route, max_tokens, effort}.
//
// Rules
//   - Files: src/agents/prompts/<agent>/<step>.v<N>.md (system prompt, front matter with route, max_tokens, effort)
//     and <step>.v<N>.schema.json next to it; paths below are relative to src/agents/prompts/.
//   - A released file is never edited: each agent folder has a LOCK.json of SHA-256 hashes, checked by a test; a
//     change is a new version.
//   - Selection: the highest registered version of a step, unless the agent flag pins one in
//     value.prompts["<step>"] (e.g. "v1"), which rolls back without a deploy.
//   - Schemas: additionalProperties false on every object, every property required (optional = nullable), no
//     numeric or length constraints.
//   - Untrusted e-mail text and attachments go only into the user turn, inside <untrusted_email> and
//     <attachment n="…"> blocks; output schemas carry injection_suspected.
//   - Sonnet (extract) prompts get one cache_control breakpoint on the last system block; Haiku (classify) prompts
//     are below the minimum cacheable prefix and are not marked.
//   - Bundling: the module that runs a prompt imports its two files (wrangler `rules`: .md as Text, .json as JSON)
//     and registers them once at module load with registerPromptSource(id, text, schema); loadPrompt() then serves
//     them. The registry imports no prompt file itself, so a prompt is bundled exactly when its Workflow is.
//   - Front matter (between '---' lines at the top): route, max_tokens and effort ('none' for classify prompts); it
//     must equal the PROMPTS entry, so a file and the registry can never disagree silently.
//   - LOCK.json in each agent folder maps every released file name to the SHA-256 hex of its bytes.

import type { AgentFlag } from '../flags';

/** '<agent>.<step>@v<N>', e.g. 'rfq_intake.extract@v1'. */
export type PromptId = `${string}.${string}@v${number}`;

export interface PromptEntry {
  /** Prompt text file, relative to src/agents/prompts/. */
  file: string;
  /** JSON Schema file of the structured output, relative to src/agents/prompts/. */
  schema: string;
  route: 'extract' | 'classify';
  max_tokens: number;
  /** output_config.effort; null for classify (Haiku) prompts. */
  effort: 'low' | 'medium' | 'high' | null;
}

export const PROMPTS: Readonly<Record<PromptId, PromptEntry>> = Object.freeze({
  'rfq_intake.triage@v1': { file: 'rfq_intake/triage.v1.md', schema: 'rfq_intake/triage.v1.schema.json', route: 'classify', max_tokens: 256, effort: null },
  'rfq_intake.extract@v1': { file: 'rfq_intake/extract.v1.md', schema: 'rfq_intake/extract.v1.schema.json', route: 'extract', max_tokens: 4096, effort: 'low' },
  'rfq_intake.classify_process@v1': { file: 'rfq_intake/classify_process.v1.md', schema: 'rfq_intake/classify_process.v1.schema.json', route: 'classify', max_tokens: 256, effort: null },
  'quote.price_notes@v1': { file: 'quote/price_notes.v1.md', schema: 'quote/price_notes.v1.schema.json', route: 'extract', max_tokens: 2048, effort: 'medium' },
  'quote.cover_email@v1': { file: 'quote/cover_email.v1.md', schema: 'quote/cover_email.v1.schema.json', route: 'extract', max_tokens: 2048, effort: 'low' },
  'quote.classify_reply@v1': { file: 'quote/classify_reply.v1.md', schema: 'quote/classify_reply.v1.schema.json', route: 'classify', max_tokens: 256, effort: null },
  'post_order.traveller_notes@v1': { file: 'post_order/traveller_notes.v1.md', schema: 'post_order/traveller_notes.v1.schema.json', route: 'extract', max_tokens: 1024, effort: 'low' },
  'post_order.reorder_draft@v1': { file: 'post_order/reorder_draft.v1.md', schema: 'post_order/reorder_draft.v1.schema.json', route: 'extract', max_tokens: 1024, effort: 'low' },
});

export interface LoadedPrompt {
  id: PromptId;
  entry: PromptEntry;
  /** System prompt text (front matter removed). */
  system: string;
  schema: Record<string, unknown>;
}

/** Keywords a structured-output schema must not use (numeric and length constraints, N-7). */
export const FORBIDDEN_SCHEMA_KEYWORDS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties', 'pattern'] as const;

function versionOf(id: string): number {
  const match = /@v(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}

/** The prompt id to use for '<agent>.<step>': the flag's pinned version, else the highest registered one. */
export function selectPrompt(agentStep: `${string}.${string}`, flag: AgentFlag): PromptId {
  const candidates = (Object.keys(PROMPTS) as PromptId[]).filter((id) => id.startsWith(`${agentStep}@v`));
  if (candidates.length === 0) throw new Error(`no prompt registered for ${agentStep}`);
  const step = agentStep.slice(agentStep.indexOf('.') + 1);
  const prompts = flag.value.prompts;
  const pinned = prompts && typeof prompts === 'object' ? (prompts as Record<string, unknown>)[step] : undefined;
  if (typeof pinned === 'string' && /^v\d+$/.test(pinned)) {
    const id = `${agentStep}@${pinned}` as PromptId;
    if (candidates.includes(id)) return id;
  }
  return candidates.sort((a, b) => versionOf(b) - versionOf(a))[0];
}

export interface FrontMatter {
  route?: string;
  max_tokens?: number;
  effort?: string;
  [key: string]: string | number | undefined;
}

/** Splits a prompt file into its front matter and the system text (trimmed). */
export function parseFrontMatter(text: string): { meta: FrontMatter; body: string } {
  const normalized = text.replace(/^\uFEFF/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(normalized);
  if (!match) return { meta: {}, body: normalized.trim() };
  const meta: FrontMatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^\s*([a-z_]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!kv) continue;
    meta[kv[1]] = /^\d+$/.test(kv[2]) ? Number(kv[2]) : kv[2];
  }
  return { meta, body: normalized.slice(match[0].length).trim() };
}

/** Problems of a prompt file's front matter against its registry entry (empty = consistent). */
export function frontMatterProblems(id: PromptId, meta: FrontMatter): string[] {
  const entry = PROMPTS[id];
  if (!entry) return [`${id}: not in PROMPTS`];
  const problems: string[] = [];
  if (meta.route !== entry.route) problems.push(`${id}: route ${String(meta.route)} != ${entry.route}`);
  if (meta.max_tokens !== entry.max_tokens) problems.push(`${id}: max_tokens ${String(meta.max_tokens)} != ${entry.max_tokens}`);
  const effort = meta.effort === undefined || meta.effort === 'none' || meta.effort === 'null' ? null : meta.effort;
  if (effort !== entry.effort) problems.push(`${id}: effort ${String(effort)} != ${String(entry.effort)}`);
  return problems;
}

/**
 * Rule problems of a structured-output schema (empty = valid): every object has additionalProperties false and
 * lists every property in required; no numeric or length constraint anywhere.
 */
export function schemaRuleProblems(schema: unknown, path = '$'): string[] {
  if (typeof schema !== 'object' || schema === null) return [];
  if (Array.isArray(schema)) return schema.flatMap((s, i) => schemaRuleProblems(s, `${path}[${i}]`));
  const s = schema as Record<string, unknown>;
  const problems: string[] = [];
  for (const keyword of FORBIDDEN_SCHEMA_KEYWORDS) if (keyword in s) problems.push(`${path}: ${keyword} is not allowed`);
  const types = Array.isArray(s.type) ? s.type : [s.type];
  if (types.includes('object') || s.properties !== undefined) {
    if (s.additionalProperties !== false) problems.push(`${path}: additionalProperties must be false`);
    const properties = (s.properties ?? {}) as Record<string, unknown>;
    const required = Array.isArray(s.required) ? s.required : [];
    for (const key of Object.keys(properties)) if (!required.includes(key)) problems.push(`${path}.${key}: not in required`);
    for (const key of required) if (!(key in properties)) problems.push(`${path}: required ${String(key)} has no property`);
    for (const [key, sub] of Object.entries(properties)) problems.push(...schemaRuleProblems(sub, `${path}.${key}`));
  }
  if (s.items !== undefined) problems.push(...schemaRuleProblems(s.items, `${path}[]`));
  for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) if (Array.isArray(s[keyword])) problems.push(...schemaRuleProblems(s[keyword], `${path}.${keyword}`));
  if (s.$defs && typeof s.$defs === 'object') for (const [k, d] of Object.entries(s.$defs as Record<string, unknown>)) problems.push(...schemaRuleProblems(d, `${path}.$defs.${k}`));
  return problems;
}

const sources = new Map<PromptId, { text: string; schema: Record<string, unknown> }>();

/** Registers the bundled files of a prompt (called once at module load by the module that runs the prompt). */
export function registerPromptSource(id: PromptId, text: string, schema: Record<string, unknown>): void {
  if (!PROMPTS[id]) throw new Error(`registerPromptSource: ${id} is not in PROMPTS`);
  sources.set(id, { text, schema });
}

/** Ids whose files are registered in this isolate. */
export function registeredPrompts(): PromptId[] {
  return [...sources.keys()];
}

/** Text and schema of a registered prompt (bundled as Text and JSON modules). */
export async function loadPrompt(id: PromptId): Promise<LoadedPrompt> {
  const entry = PROMPTS[id];
  if (!entry) throw new Error(`unknown prompt ${id}`);
  const source = sources.get(id);
  if (!source) throw new Error(`prompt ${id} is not registered (registerPromptSource)`);
  const { meta, body } = parseFrontMatter(source.text);
  const problems = [...frontMatterProblems(id, meta), ...schemaRuleProblems(source.schema)];
  if (problems.length) throw new Error(`prompt ${id} is inconsistent: ${problems.join('; ')}`);
  return { id, entry, system: body, schema: source.schema };
}
