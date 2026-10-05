// Partner suggestion and language, the cards of the post-order and reply flows (business fields only, verbs within
// VERB_CODES, Telegram rendering) and the CHECK lists the RP repos copy.

import { describe, expect, it } from 'vitest';
import { VERB_CODES } from '../../../shared/src/agent-api';
import { handoffCard, handoffVerbs } from '../../src/agents/cards/handoff';
import { renderTelegram } from '../../src/agents/cards/index';
import { reorderCard, stockNoticeCard } from '../../src/agents/cards/reorder';
import { gmailReconnectCard, replyAttachedCard, replyPickCard, replyPickVerbs } from '../../src/agents/cards/reply';
import { partnerLanguage, suggestPartner, type PartnerRow } from '../../src/db/repos/partners';
import type { ReleaseReason } from '../../src/db/repos/stock';
import { checkList } from '../helpers/check-lists';

const partner = (id: string, name: string, specs: string[] | null, country: string | null = null, active: boolean | null = true): PartnerRow => ({ id, company_name: name, country, specializations: specs, active });

describe('partners', () => {
  const list = [partner('p1', 'Bravo Laser', ['Laser cutting', 'Bending']), partner('p2', 'Alpha CNC', ['CNC milling']), partner('p3', 'Charlie Metal', ['sheet_metal'])];

  it('the order partner first, then specialisation by process (company name order), else the only partner', () => {
    expect(suggestPartner(list, { order_partner_id: 'p2', processes: ['sheet_metal'] })).toMatchObject({ partner: { id: 'p2' }, matched_by: 'order' });
    expect(suggestPartner(list, { order_partner_id: null, processes: ['sheet_metal'] })).toMatchObject({ partner: { id: 'p1' }, matched_by: 'specialisation' });
    expect(suggestPartner(list, { order_partner_id: null, processes: ['cnc'] })).toMatchObject({ partner: { id: 'p2' } });
    expect(suggestPartner(list, { order_partner_id: null, processes: ['mixed'] })).toMatchObject({ partner: { id: 'p2' } });
    expect(suggestPartner(list, { order_partner_id: null, processes: ['other'] })).toBeNull();
    expect(suggestPartner([list[0]], { order_partner_id: null, processes: ['other'] })).toMatchObject({ partner: { id: 'p1' }, matched_by: 'only_partner' });
    // an order partner that is not an active partner is not suggested as such
    expect(suggestPartner(list, { order_partner_id: 'gone', processes: ['cnc'] })).toMatchObject({ matched_by: 'specialisation' });
  });

  it('partner language from the country (exact codes and names; English otherwise)', () => {
    expect(['GR', 'Greece', 'Ελλάδα', 'cy', 'DE', 'Austria', 'pl', 'Denmark', 'Deutschland', null, ''].map(partnerLanguage)).toEqual(['el', 'el', 'el', 'el', 'de', 'de', 'pl', 'en', 'de', 'en', 'en']);
  });
});

describe('cards', () => {
  const base = { run_id: 'r1', site_origin: 'https://www.micronshub.eu' };

  it('every RP card uses verbs of its kind only; Telegram buttons for coded verbs, change_partner dashboard-only', () => {
    const cards = [
      handoffCard({ ...base, po_number: 'PO-1', company: 'Example GmbH', country: 'DE', partner: { company_name: 'P', country: 'GR', matched_by: 'order' }, items: 2, unmatched_items: 0, stock: { held: 1, shortfall: 0, not_stocked: 1 }, over_held: 0, due_date: null, traveller_pages: 1, injection_suspected: false }),
      reorderCard({ ...base, po_number: 'PO-1', materials: [{ label: 'S235JR · 2 mm', need: '0.05 m2 missing', supplier: 'Example Steel' }] }),
      replyPickCard({ ...base, sender_masked: 'e***@example.de', candidates: [{ rfq_number: 'RFQ-01102026-1', company: 'Example GmbH', version: 2, sent_at: '2026-10-01T10:00:00Z' }], attachments: 1 }),
    ];
    for (const c of cards) for (const v of c.allowed_verbs) expect(Object.keys(VERB_CODES[c.kind]), `${c.kind} ${v}`).toContain(v);
    const tg = renderTelegram(cards[0], 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    const buttons = (tg.reply_markup.inline_keyboard[0] as Array<{ callback_data?: string }>).map((b) => b.callback_data);
    expect(buttons).toEqual(['ap:ABCDEFGHIJKLMNOPQRSTUVWXYZ:sp', 'ap:ABCDEFGHIJKLMNOPQRSTUVWXYZ:hold']);
    expect(handoffVerbs(false)).toEqual(['hold', 'change_partner']);
    expect(replyPickVerbs(3)).toEqual(['attach_1', 'attach_2', 'attach_3', 'new_rfq', 'ignore']);
    expect(replyPickVerbs(2, false)).toEqual(['attach_1', 'attach_2', 'ignore']);
  });

  it('notices have no verbs; no full address on any card', () => {
    const notices = [
      stockNoticeCard({ ...base, material_label: 'S235JR · 2 mm', released: 2, over_held: 1 }),
      replyAttachedCard({ ...base, rfq_number: 'RFQ-01102026-1', sender_masked: 'e***@example.de', attachments: 0, quote_waiting: true }),
      gmailReconnectCard({ ...base, account_masked: 's***@example.com' }),
    ];
    for (const c of notices) {
      expect(c.allowed_verbs).toEqual([]);
      expect(JSON.stringify(c)).not.toMatch(/[A-Za-z0-9._%+-]{2,}@[A-Za-z0-9-]+\.[A-Za-z]/);
    }
  });
});

describe('CHECK-LISTS', () => {
  it('stock_reservations release reasons equal the migration', () => {
    const reasons: ReleaseReason[] = ['cancelled', 'consumed', 'expired', 'manual'];
    expect([...reasons].sort()).toEqual([...checkList('stock_reservations_reason_check', 'release_reason')].sort());
  });
});
