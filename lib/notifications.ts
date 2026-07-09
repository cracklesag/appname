// Farm notifications — ADMIN-ONLY warnings surfaced on the home page.
//
// Design: warnings are DERIVED live from the applications the caller already
// holds, never persisted as rows. This means they can't go stale or get out of
// sync with the underlying data — the same self-healing approach used for the
// after-cut-N dismissal and the partials reconcile. The only thing we persist
// is which warnings the admin has DISMISSED (see dismissed_notifications), keyed
// by a deterministic id so a dismissal sticks to exactly one warning.
//
// The first (and currently only) warning class: the same slurry product applied
// to the same field twice within a short window — a strong signal of an
// accidental double-log (or a genuine double dose worth a second look).

import type { Application, Product } from './types';

/** Two applications of the same slurry product to one field within this many
 *  days flag as a possible duplicate. Slurry-specific by request. */
export const DUP_SLURRY_WINDOW_DAYS = 7;

export type FarmWarning = {
  /** Deterministic across reloads — the dismissal key. Built from the two
   *  application ids (sorted) so it names exactly this pair. */
  id: string;
  kind: 'duplicate_slurry';
  fieldId: string;
  fieldName: string;
  productName: string;
  /** The later (more recent) application's date — what the admin sees first. */
  latestDate: string;
  earlierDate: string;
  daysApart: number;
};

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + 'T00:00:00Z').getTime();
  const b = new Date(bIso + 'T00:00:00Z').getTime();
  return Math.round(Math.abs(a - b) / 86_400_000);
}

/**
 * Compute duplicate-slurry warnings. Pure — pass the farm's applications,
 * products, and a field-id→name map. Whole-field applications only; a pending
 * part-field application isn't a whole-field duplicate. Same product_id only.
 */
export function computeDuplicateSlurryWarnings(
  applications: Application[],
  products: Product[],
  fieldName: (id: string) => string,
): FarmWarning[] {
  const slurryIds = new Set(
    products.filter((p) => p.type === 'slurry').map((p) => p.id),
  );
  if (slurryIds.size === 0) return [];

  // Group whole-field slurry applications by (field, product).
  const groups = new Map<string, Application[]>();
  for (const a of applications) {
    if (!slurryIds.has(a.product_id)) continue;
    if (a.coverage === 'partial') continue;
    const key = `${a.field_id}::${a.product_id}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(a);
  }

  const warnings: FarmWarning[] = [];
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    // Sort by date ascending, then flag any ADJACENT pair inside the window.
    const sorted = [...rows].sort((x, y) => x.date_applied.localeCompare(y.date_applied));
    for (let i = 1; i < sorted.length; i++) {
      const earlier = sorted[i - 1];
      const later = sorted[i];
      const gap = daysBetween(earlier.date_applied, later.date_applied);
      if (gap <= DUP_SLURRY_WINDOW_DAYS) {
        const pairId = [earlier.id, later.id].sort().join('__');
        warnings.push({
          id: `dupslurry__${pairId}`,
          kind: 'duplicate_slurry',
          fieldId: later.field_id,
          fieldName: fieldName(later.field_id),
          productName: products.find((p) => p.id === later.product_id)?.name ?? 'Slurry',
          latestDate: later.date_applied,
          earlierDate: earlier.date_applied,
          daysApart: gap,
        });
      }
    }
  }

  // Most recent first.
  warnings.sort((a, b) => b.latestDate.localeCompare(a.latestDate));
  return warnings;
}

/**
 * At-logging check: would adding a slurry application of `productId` to `fieldId`
 * on `dateApplied` land within the window of an existing same-product whole-field
 * application? Returns the nearest clashing date, or null. Used to raise the
 * "are you sure?" prompt before the record is written.
 */
export function slurryClashOnLog(
  applications: Application[],
  products: Product[],
  fieldId: string,
  productId: number,
  dateApplied: string,
): { clashDate: string; daysApart: number } | null {
  const prod = products.find((p) => p.id === productId);
  if (!prod || prod.type !== 'slurry') return null;

  let nearest: { clashDate: string; daysApart: number } | null = null;
  for (const a of applications) {
    if (a.field_id !== fieldId || a.product_id !== productId) continue;
    if (a.coverage === 'partial') continue;
    const gap = daysBetween(a.date_applied, dateApplied);
    if (gap <= DUP_SLURRY_WINDOW_DAYS && (nearest == null || gap < nearest.daysApart)) {
      nearest = { clashDate: a.date_applied, daysApart: gap };
    }
  }
  return nearest;
}
