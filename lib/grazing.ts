// Single source of truth for the rotational-grazing N top-up schedule.
//
// Both the Grazing top-up report (components/GrazingReportShell) and the AI
// assistant's get_grazing_schedule tool call this, so they can never disagree
// about which fields are on grazing, when N was last applied, or when the next
// dose is due. Previously the report computed this inline while the assistant
// re-derived it from raw applications, which drifted (wrong field set, off-by-
// one dates, false "none on record" when the last N was older than the tool's
// row limit).

import { Field, Cut, Application, Product, GrassSystem, Settings } from '@/lib/types';
import {
  resolveFieldNextAction,
  isHeadingForRotationalGrazing,
  resolveGrassSystem,
  getNCap,
  sumNutrients,
} from '@/lib/rules';
import { meteredApps, fieldAreaHa } from '@/lib/partials';

export type GrazingDueStatus =
  | { kind: 'overdue'; days: number }
  | { kind: 'due_now' }
  | { kind: 'upcoming'; days: number }
  | { kind: 'no_history' };

export interface GrazingScheduleRow {
  field: Field;
  /** Resolved grass system, or undefined when not assigned. */
  grassSystem: GrassSystem | undefined;
  /** Most recent N-bearing application this season, or undefined if none. */
  lastNApp?: { date: string; nPerHa: number };
  /** Next-due date = lastNApp.date + cadence weeks. If no app, today. */
  nextDueIso: string;
  /** Days from today to next due. Negative = overdue. */
  daysToNextDue: number;
  /** Total season N applied (any source) — for the cap warning. */
  seasonNApplied: number;
  /** N cap for this field. */
  nCap: number;
  status: GrazingDueStatus;
}

function isoAddDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

export function computeGrazingSchedule(args: {
  fields: Field[];
  applications: Application[];
  cuts: Cut[];
  products: Product[];
  grassSystems: GrassSystem[];
  settings: Settings;
  seasonStart: string;
  todayIso: string;
}): GrazingScheduleRow[] {
  const { fields, applications, cuts, products, grassSystems, settings, seasonStart, todayIso } = args;
  const cadenceWeeks = settings.reportDefaults.grazingCadenceWeeks;
  const productById = new Map(products.map((p) => [p.id, p]));

  return fields
    .map((f): GrazingScheduleRow | null => {
      const fCuts = cuts.filter((c) => c.field_id === f.id && c.cut_date >= seasonStart);

      // Eligibility — field is heading for rotational grazing per its most
      // recent cut's next_action (or planned_cuts[0] for fields with no cuts,
      // via the resolver fallback).
      const resolved = resolveFieldNextAction(f, fCuts);
      if (!isHeadingForRotationalGrazing(resolved)) return null;

      // Season applications, area-metered. Pick the most recent N-bearing one
      // (a product that delivers any N — slurry/manure N is the crop-available
      // fraction; lime never counts as a top-up).
      const fApps = meteredApps(
        applications.filter((a) => a.field_id === f.id && a.date_applied >= seasonStart),
        () => fieldAreaHa(f),
      );
      const nBearing = fApps
        .filter((a) => {
          const p = productById.get(a.product_id);
          return !!p && p.type !== 'lime';
        })
        .sort((a, b) => b.date_applied.localeCompare(a.date_applied));

      let lastNApp: GrazingScheduleRow['lastNApp'] = undefined;
      if (nBearing.length > 0) {
        const top = nBearing[0];
        const ntot = sumNutrients([top], products).n;
        if (ntot > 0) lastNApp = { date: top.date_applied, nPerHa: ntot };
      }

      const nextDueIso = lastNApp ? isoAddDays(lastNApp.date, cadenceWeeks * 7) : todayIso;
      const daysToNextDue = daysBetween(todayIso, nextDueIso);

      const seasonNApplied = sumNutrients(fApps, products).n;
      const system = resolveGrassSystem(f, grassSystems);
      const nCap = getNCap(f, settings, system);

      const status: GrazingDueStatus = !lastNApp
        ? { kind: 'no_history' }
        : daysToNextDue < -1
          ? { kind: 'overdue', days: Math.abs(daysToNextDue) }
          : daysToNextDue <= 1
            ? { kind: 'due_now' }
            : { kind: 'upcoming', days: daysToNextDue };

      return { field: f, grassSystem: system, lastNApp, nextDueIso, daysToNextDue, seasonNApplied, nCap, status };
    })
    .filter((s): s is GrazingScheduleRow => s != null);
}
