/**
 * The job lifecycle. Phase 1 tracks a job from first phone call to closed out.
 * `group` drives the dashboard buckets; `next` is the allowed transition set.
 */
export const STATUSES = [
  { key: 'lead',        label: 'Lead',        group: 'pipeline', next: ['estimating', 'bid_sent', 'scheduled', 'cancelled'] },
  { key: 'estimating',  label: 'Estimating',  group: 'pipeline', next: ['bid_sent', 'scheduled', 'lead', 'cancelled'] },
  { key: 'bid_sent',    label: 'Bid sent',    group: 'pipeline', next: ['scheduled', 'estimating', 'cancelled'] },
  { key: 'scheduled',   label: 'Scheduled',   group: 'active',   next: ['in_progress', 'bid_sent', 'cancelled'] },
  { key: 'in_progress', label: 'In progress', group: 'active',   next: ['punch_list', 'complete', 'scheduled', 'cancelled'] },
  { key: 'punch_list',  label: 'Punch list',  group: 'active',   next: ['complete', 'in_progress', 'cancelled'] },
  { key: 'complete',    label: 'Complete',    group: 'closed',   next: ['punch_list'] },
  { key: 'cancelled',   label: 'Cancelled',   group: 'closed',   next: ['lead', 'estimating', 'scheduled'] },
];

export const STATUS_KEYS = STATUSES.map((s) => s.key);
export const PRIORITIES = ['low', 'normal', 'high'];

const byKey = new Map(STATUSES.map((s) => [s.key, s]));

export const statusLabel = (key) => byKey.get(key)?.label ?? key;
export const statusGroup = (key) => byKey.get(key)?.group ?? 'pipeline';
export const groupKeys = (group) => STATUSES.filter((s) => s.group === group).map((s) => s.key);

/** Same-status moves are a no-op rather than an error, so re-saving a form is safe. */
export function canTransition(from, to) {
  if (from === to) return true;
  return byKey.get(from)?.next.includes(to) ?? false;
}

export function allowedNext(from) {
  return byKey.get(from)?.next ?? [];
}
