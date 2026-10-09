// Container slot names of the CAD Container (Phase 5, unit D5): one Durable Object name per slot, 'cad-0' to
// 'cad-<CAD_SLOTS - 1>'; CAD_SLOTS must equal containers[0].max_instances of wrangler.jsonc.
//
// Rules
//   - CAD_SLOTS is a decimal integer from 1 to MAX_CAD_SLOTS; any other value (missing, empty, '0', '3.5', 'x')
//     counts as not configured and the count is DEFAULT_CAD_SLOTS (the Phase 4 container slot count).
//   - Slot names are exactly 'cad-' + index; an index outside 0 … count - 1 is never a slot.

/** Container slots when CAD_SLOTS is not configured (= the Phase 4 CadRouter count and max_instances). */
export const DEFAULT_CAD_SLOTS = 3;

/** Largest accepted CAD_SLOTS (the containers default max_instances). */
export const MAX_CAD_SLOTS = 20;

const SLOT_COUNT = /^[1-9][0-9]?$/;
const SLOT_NAME = /^cad-(0|[1-9][0-9]?)$/;

/** 'cad-' + i */
export function slotName(i: number): string {
  if (!Number.isInteger(i) || i < 0 || i >= MAX_CAD_SLOTS) throw new RangeError(`slot index out of range: ${i}`);
  return `cad-${i}`;
}

/** The CAD_SLOTS value when it is a valid count, else null. */
export function configuredSlotCount(env: { CAD_SLOTS?: string }): number | null {
  const raw = typeof env.CAD_SLOTS === 'string' ? env.CAD_SLOTS.trim() : '';
  if (!SLOT_COUNT.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_CAD_SLOTS ? n : null;
}

/** Number of container slots from CAD_SLOTS (DEFAULT_CAD_SLOTS when it is not configured). */
export function slotCount(env: { CAD_SLOTS?: string }): number {
  return configuredSlotCount(env) ?? DEFAULT_CAD_SLOTS;
}

/** Every slot name, lowest first. */
export function slotNames(env: { CAD_SLOTS?: string }): string[] {
  return Array.from({ length: slotCount(env) }, (_, i) => slotName(i));
}

/** Index of a slot name within the configured count, or null. */
export function slotIndex(slot: string, env: { CAD_SLOTS?: string }): number | null {
  const m = SLOT_NAME.exec(slot);
  if (!m) return null;
  const i = Number(m[1]);
  return i < slotCount(env) ? i : null;
}
