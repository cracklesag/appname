// Diary calendar — event derivation. Pure functions, no queries.
//
// The calendar stores NOTHING. Events are derived live from data the app
// already loads (applications, cuts, jobs, dated to-dos), so the calendar can
// never drift from reality — the same philosophy as the home-page warnings.
// Each event carries a layer key; the UI shows filter chips to toggle layers
// on/off so the grid stays uncluttered.

import type { Application, Cut, Job, Product, Todo } from './types';

export type DiaryLayerKey = 'manure' | 'fert' | 'lime' | 'spray' | 'cuts' | 'jobs' | 'todos';

export const DIARY_LAYERS: { key: DiaryLayerKey; label: string; color: string }[] = [
  { key: 'manure', label: 'Manure',  color: 'var(--slurry)' },
  { key: 'fert',   label: 'Fert',    color: 'var(--forest)' },
  { key: 'lime',   label: 'Lime',    color: '#8a8578' },
  { key: 'spray',  label: 'Spray',   color: '#5f7fa8' },
  { key: 'cuts',   label: 'Cuts',    color: 'var(--amber)' },
  { key: 'jobs',   label: 'Jobs',    color: '#b06a37' },
  { key: 'todos',  label: 'To-dos',  color: 'var(--ink)' },
];

export interface DiaryEvent {
  /** ISO date (yyyy-mm-dd) the event sits on. */
  date: string;
  layer: DiaryLayerKey;
  label: string;
  /** Where tapping the event goes. */
  href: string;
  /** Stable key for React lists. */
  key: string;
}

/** Map a product to its calendar layer. */
function layerForProduct(p: Product | undefined): DiaryLayerKey {
  if (!p) return 'fert';
  if (p.type === 'slurry' || p.type === 'solid_manure') return 'manure';
  if (p.type === 'lime') return 'lime';
  return 'fert';
}

/**
 * Build the full event list for the calendar. Pass everything; the UI filters
 * by layer. Spray records are optional (pass [] when not loaded).
 */
export function buildDiaryEvents(opts: {
  applications: Application[];
  cuts: Cut[];
  jobs: Job[];
  todos: Todo[];
  products: Product[];
  fieldName: (id: string) => string;
  sprayDates?: { id: string; date: string; fieldId: string }[];
}): DiaryEvent[] {
  const { applications, cuts, jobs, todos, products, fieldName, sprayDates = [] } = opts;
  const prodById = new Map(products.map((p) => [p.id, p]));
  const events: DiaryEvent[] = [];

  for (const a of applications) {
    const p = prodById.get(a.product_id);
    events.push({
      date: a.date_applied,
      layer: layerForProduct(p),
      label: `${fieldName(a.field_id)} — ${p?.name ?? 'Application'}`,
      href: `/fields/${a.field_id}?tab=season`,
      key: `app-${a.id}`,
    });
  }

  for (const c of cuts) {
    events.push({
      date: c.cut_date,
      layer: 'cuts',
      label: `${fieldName(c.field_id)} — Cut ${c.cut_number}`,
      href: `/fields/${c.field_id}?tab=season`,
      key: `cut-${c.id}`,
    });
  }

  for (const s of sprayDates) {
    events.push({
      date: s.date,
      layer: 'spray',
      label: `${fieldName(s.fieldId)} — Spray`,
      href: `/fields/${s.fieldId}?tab=season`,
      key: `spray-${s.id}`,
    });
  }

  for (const j of jobs) {
    // A job appears on its due date while open, and on its completion date
    // once approved — one date per job, whichever describes it now.
    const date = j.status === 'approved'
      ? (j.approved_at ? j.approved_at.slice(0, 10) : null)
      : (j.due_date ?? null);
    if (!date) continue;
    events.push({
      date,
      layer: 'jobs',
      label: `${j.title}${j.status === 'approved' ? ' (done)' : ''}`,
      href: `/jobs/${j.id}`,
      key: `job-${j.id}`,
    });
  }

  for (const t of todos) {
    if (!t.due_date) continue; // undated to-dos live on the list, not the grid
    events.push({
      date: t.due_date,
      layer: 'todos',
      label: `${t.done_at ? '✓ ' : ''}${t.title}`,
      href: '/diary',
      key: `todo-${t.id}`,
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  return events;
}

/** Group events by ISO date for the month grid. */
export function eventsByDay(events: DiaryEvent[], visible: Set<DiaryLayerKey>): Map<string, DiaryEvent[]> {
  const map = new Map<string, DiaryEvent[]>();
  for (const e of events) {
    if (!visible.has(e.layer)) continue;
    (map.get(e.date) ?? map.set(e.date, []).get(e.date)!).push(e);
  }
  return map;
}
