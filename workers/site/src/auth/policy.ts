// Gate policy: one action ID per resolved /api action, and the rule each ID follows.
//   access      who may call: 'public' (no credential), 'turnstile' (public form with a Turnstile token),
//               'turnstile-or-staff', 'files' (per-action file rules), 'staff', 'admin', 'admin-json'
//               (ADMIN; a JSON request from anyone else is refused, a page navigation goes on as that caller),
//               'relay' (the Telegram relay's signed request, src/auth/agent-hmac.ts), 'signed-link' (a signed
//               partner download link, src/auth/agent-hmac.ts)
//   machines    Access service-token callers allowed besides staff (only on preview hosts and API_MACHINE_HOSTS);
//               `machineActions` narrows them to some actions of the ID
//   userScope   last part of the signed-in rate key u:<uid>:<scope> (':r' idempotent reads and ':up' upload
//               presigns count against the bulk limit)
// Gate modes come from API_GATES_MODE ("<class>=report|enforce", comma list). Without the var only the recipient
// check reports; with the var every class it does not name enforces. Report mode logs
// "[microns-site] gate would deny <actionId> <code>" and lets the request through.
//
// Phase 4, endpoint 'agent' (/api/agent/*):
//   AG-1  decision, dashboard       STAFF or ADMIN session; body DecisionBodyDashboard        rate u:<uid>:agent
//   AG-2  decision, Telegram relay  signed relay request (X-Microns-Timestamp/-Signature);    rate m:telegram:agent
//                                   body DecisionBodyRelay
//   AG-3  file, signed link         k, exp and sig verified                                   rate file:<ip>
//   AG-4  flag                      ADMIN session                                             rate u:<uid>:agent
//   AG-5  status                    STAFF or ADMIN session                                    rate u:<uid>:agent
//   AG-6  start                     STAFF or ADMIN session ('test_card': ADMIN)               rate u:<uid>:agent
//   AG-7  file, staff preview       STAFF or ADMIN session, fixed key patterns                rate u:<uid>:agent
// actionIdOf() gives AG-1 for every decision; the gate takes AG-2 when the request carries a relay header.
//
// Phase 5:
//   MK-8  marketing send-campaign       STAFF or ADMIN session; POST only (405 otherwise)   rate u:<uid>:send-campaign
//   CD-1  CAD compat path               path token equals CAD_COMPAT_TOKEN (access           rate m:cad-compat
//         (/api/cad/<token>/...)        'cad-token', ./cad-compat.ts); POST only (405), any
//                                       other /api/cad/* path 404; principal MACHINE:cad-compat

import type { ResolvedApi } from '../api/resolve';

export type ActionId = 'EM-1' | 'EM-2' | 'EM-3' | 'EM-4' | 'S3-1' | 'S3-2' | 'S3-3' | 'S3-4' | 'S3-5' | 'S3-6'
  | 'MK-1' | 'MK-2' | 'MK-3' | 'MK-4' | 'MK-5' | 'MK-6' | 'MK-7' | 'NT-1' | 'NT-2' | 'NT-3' | 'NT-4' | 'NT-5' | 'NT-6' | 'NT-7'
  | 'GS-1' | 'TD-1' | 'TD-2' | 'TS-1' | 'FS-1' | 'FS-2' | 'FS-3' | 'SC-1' | 'SC-2' | 'SC-3'
  // Phase 4: /api/agent/*
  | 'AG-1' | 'AG-2' | 'AG-3' | 'AG-4' | 'AG-5' | 'AG-6' | 'AG-7'
  // Phase 5: marketing send-campaign, CAD compat path
  | 'MK-8' | 'CD-1';

export type MachineName = 'collector' | 'mcp';

export type Access = 'public' | 'turnstile' | 'turnstile-or-staff' | 'files' | 'staff' | 'admin' | 'admin-json' | 'relay' | 'signed-link'
  // Phase 5: the CAD compat token in the request path (./cad-compat.ts)
  | 'cad-token';

export interface ActionRule {
  access: Access;
  machines?: readonly MachineName[];
  machineActions?: readonly string[];
  userScope?: string;
  /** Turnstile actions accepted for this ID (real secret). */
  turnstileActions?: readonly string[];
}

export const ACTION_RULES: Readonly<Record<ActionId, ActionRule>> = {
  'EM-1': { access: 'turnstile', turnstileActions: ['contact', 'quote'] },
  'EM-2': { access: 'turnstile', turnstileActions: ['contact'] },
  'EM-3': { access: 'turnstile-or-staff', turnstileActions: ['quote'], userScope: 'emails' },
  'EM-4': { access: 'staff', userScope: 'emails' },
  'S3-1': { access: 'files', userScope: 's3:up' },
  'S3-2': { access: 'files', userScope: 's3:r' },
  'S3-3': { access: 'files', userScope: 's3' },
  'S3-4': { access: 'staff', userScope: 's3' },
  'S3-5': { access: 'staff', userScope: 's3:r' },
  'S3-6': { access: 'staff', userScope: 's3' },
  'MK-1': { access: 'public' },
  'MK-2': { access: 'public' },
  'MK-3': { access: 'admin-json', userScope: 'marketing' },
  'MK-4': { access: 'public' },
  'MK-5': { access: 'admin', userScope: 'marketing' },
  'MK-6': { access: 'public' },
  'MK-7': { access: 'staff', userScope: 'marketing' },
  'NT-1': { access: 'staff', userScope: 'notifications' },
  'NT-2': { access: 'staff', userScope: 'notifications' },
  'NT-3': { access: 'staff', userScope: 'nest' },
  'NT-4': { access: 'staff', userScope: 'notifications' },
  'NT-5': { access: 'staff', userScope: 'notifications:r' },
  'NT-6': { access: 'staff', userScope: 'notifications' },
  'NT-7': { access: 'admin', userScope: 'notifications' },
  'GS-1': { access: 'staff', userScope: 'gsc' },
  'TD-1': { access: 'staff', machines: ['mcp'], machineActions: ['export'], userScope: 'tenders:r' },
  'TD-2': { access: 'staff', userScope: 'tenders' },
  'TS-1': { access: 'staff', machines: ['collector', 'mcp'], userScope: 'tender-scan' },
  'FS-1': { access: 'staff', userScope: 'funded-startups:r' },
  'FS-2': { access: 'staff', machines: ['mcp'], userScope: 'funded-startups' },
  'FS-3': { access: 'staff', userScope: 'funded-startups' },
  'SC-1': { access: 'staff', machines: ['mcp'], userScope: 'scrape-website' },
  'SC-2': { access: 'staff', userScope: 'scrape-company-profile' },
  'SC-3': { access: 'staff', machines: ['mcp'], userScope: 'scan-directory' },
  'AG-1': { access: 'staff', userScope: 'agent' },
  'AG-2': { access: 'relay' },
  'AG-3': { access: 'signed-link' },
  'AG-4': { access: 'admin', userScope: 'agent' },
  'AG-5': { access: 'staff', userScope: 'agent' },
  'AG-6': { access: 'staff', userScope: 'agent' },
  'AG-7': { access: 'staff', userScope: 'agent' },
  'MK-8': { access: 'staff', userScope: 'send-campaign' },
  'CD-1': { access: 'cad-token' },
};

export const ALL_ACTION_IDS = Object.keys(ACTION_RULES) as ActionId[];

/** Rate scope of a signed-in caller; inventory reads (GET) count as idempotent reads. */
export function userScopeOf(id: ActionId, method: string): string | undefined {
  if (id === 'NT-4' && method === 'GET') return 'notifications:r';
  return ACTION_RULES[id].userScope;
}

/** Machine names allowed for this ID and normalised action. */
export function machinesFor(id: ActionId, action: string): readonly MachineName[] {
  const rule = ACTION_RULES[id];
  if (!rule.machines) return [];
  if (rule.machineActions && !rule.machineActions.includes(action)) return [];
  return rule.machines;
}

const EMAIL_IDS: Readonly<Record<string, ActionId>> = { email: 'EM-1', contact: 'EM-2', rfq: 'EM-3', 'rfq-pdf': 'EM-4' };
const S3_IDS: Readonly<Record<string, ActionId>> = {
  'presign-upload': 'S3-1', 'presign-download': 'S3-2', delete: 'S3-3', 'delete-folder': 'S3-4', list: 'S3-5',
};
const OAUTH_STEP_IDS: Readonly<Record<string, ActionId>> = { authorize: 'MK-3', callback: 'MK-4', refresh: 'MK-5', error: 'MK-6' };
const NOTIFICATION_IDS: Readonly<Record<string, ActionId>> = {
  partner: 'NT-1', 'production-status': 'NT-2', nest: 'NT-3', 'inv-label': 'NT-5', 'inv-stock-scan': 'NT-6', 'inv-cron-batch': 'NT-7',
};
const TENDER_READS = ['connectors', 'stats', 'export', 'id', 'list'];
const FUNDED_READS = ['stats', 'feeds', 'export', 'id', 'list'];
const AGENT_IDS: Readonly<Record<string, ActionId>> = { decision: 'AG-1', flag: 'AG-4', status: 'AG-5', start: 'AG-6' };

/** file: a request with a `sig` query parameter is a signed partner link (AG-3), any other a staff preview (AG-7). */
function agentFileId(r: ResolvedApi): ActionId {
  return Object.prototype.hasOwnProperty.call(r.query, 'sig') ? 'AG-3' : 'AG-7';
}

function lookup(table: Readonly<Record<string, ActionId>>, key: string | undefined): ActionId | null {
  return key !== undefined && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
}

/** Action ID of a resolved request; null for sentinels and for any action the policy does not know. */
export function actionIdOf(r: ResolvedApi): ActionId | null {
  const action = r.action;
  if (typeof action !== 'string' || action.startsWith('#')) return null;
  switch (r.endpoint) {
    case 'emails':
      return lookup(EMAIL_IDS, action);
    case 's3':
      if (!lookup(S3_IDS, action)) return null;
      return r.scope === 'articles' ? 'S3-6' : lookup(S3_IDS, action);
    case 'marketing':
      if (action === 'track') return 'MK-1';
      if (action === 'webhook') return 'MK-2';
      if (action === 'apollo-enrich') return 'MK-7';
      if (action === 'google-auth') return lookup(OAUTH_STEP_IDS, r.step);
      if (action === 'send-campaign') return 'MK-8';
      return null;
    case 'notifications':
      return lookup(NOTIFICATION_IDS, action) ?? (action.startsWith('inv-') ? 'NT-4' : null);
    case 'gsc':
      return 'GS-1';
    case 'tenders':
      if (action === 'patch') return 'TD-2';
      return TENDER_READS.includes(action) ? 'TD-1' : null;
    case 'tender-scan':
      return 'TS-1';
    case 'funded-startups':
      if (action === 'scan') return 'FS-2';
      if (action === 'patch') return 'FS-3';
      return FUNDED_READS.includes(action) ? 'FS-1' : null;
    case 'scrape-website':
      return 'SC-1';
    case 'scrape-company-profile':
      return 'SC-2';
    case 'scan-directory':
      return 'SC-3';
    case 'agent':
      return action === 'file' ? agentFileId(r) : lookup(AGENT_IDS, action);
    case 'cad-compat':
      return 'CD-1';
    default:
      return null;
  }
}

// ----- Gate modes -----

export type GateClass = 'auth' | 'turnstile' | 'rate' | 'recipient' | 'redirect' | 'data';
export type GateMode = 'report' | 'enforce';
export type GateModes = Readonly<Record<GateClass, GateMode>>;

export const GATE_CLASSES: readonly GateClass[] = ['auth', 'turnstile', 'rate', 'recipient', 'redirect', 'data'];

const ALL_ENFORCE: GateModes = { auth: 'enforce', turnstile: 'enforce', rate: 'enforce', recipient: 'enforce', redirect: 'enforce', data: 'enforce' };

/** Modes from API_GATES_MODE. Absent or empty: recipient=report, everything else enforce. */
export function parseGateModes(value: string | undefined): GateModes {
  if (value === undefined || value.trim() === '') return { ...ALL_ENFORCE, recipient: 'report' };
  const modes: Record<GateClass, GateMode> = { ...ALL_ENFORCE };
  for (const token of value.split(',')) {
    const [rawClass, rawMode] = token.split('=').map((s) => s.trim().toLowerCase());
    if (!(GATE_CLASSES as readonly string[]).includes(rawClass)) continue;
    if (rawMode === 'report' || rawMode === 'enforce') modes[rawClass as GateClass] = rawMode;
  }
  return modes;
}
