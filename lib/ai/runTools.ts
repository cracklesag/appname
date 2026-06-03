// Executes the assistant's tool calls by reusing the app's existing data
// loaders, so scoping/behaviour matches the rest of Swardly exactly. Each call
// is wrapped so a failure returns { error } the model can recover from rather
// than throwing the whole request.

import {
  loadFields, loadAllCuts, loadAllApplications, loadAllProducts,
  loadSettings, loadGrassSystems, loadGroups,
} from '@/lib/data';
import { getFarmContext } from '@/lib/farm';
import { createClient } from '@/lib/supabase/server';
import { resolveGrassSystem, methodLabel, SOIL_TYPE_LABELS } from '@/lib/rules';
import type { Field, Cut, Application, Product, GrassSystem, Group } from '@/lib/types';

type Json = Record<string, unknown>;

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function fieldView(f: Field, groups: Group[], systems: GrassSystem[]): Json {
  const group = f.group_id ? groups.find((g) => g.id === f.group_id)?.name ?? null : null;
  const system = resolveGrassSystem(f, systems);
  return {
    name: f.name,
    area_ha: f.ha,
    area_ac: f.acres,
    group,
    soil_type: SOIL_TYPE_LABELS[f.soil_type] ?? f.soil_type,
    grass_system: system?.name ?? 'Perennial ryegrass (default)',
    cut_profile: f.cut_profile,
    planned_cuts: f.planned_cuts,
    sampled: f.sampled,
    sample_date: f.sample_date,
    ph: f.ph,
    p_index: f.p_idx,
    k_index: f.k_idx,
    mg_index: f.mg_idx,
    notes: f.notes ?? null,
  };
}

async function findFieldByName(name: string): Promise<{ match?: Field; candidates?: string[]; all: Field[] }> {
  const all = await loadFields();
  const q = name.trim().toLowerCase();
  const exact = all.find((f) => f.name.toLowerCase() === q);
  if (exact) return { match: exact, all };
  const partial = all.filter((f) => f.name.toLowerCase().includes(q));
  if (partial.length === 1) return { match: partial[0], all };
  if (partial.length > 1) return { candidates: partial.map((f) => f.name), all };
  return { all };
}

export async function runTool(name: string, input: Json): Promise<Json> {
  try {
    switch (name) {
      case 'get_fields': {
        const [fields, groups, systems] = await Promise.all([loadFields(), loadGroups(), loadGrassSystems()]);
        return { fields: fields.filter((f) => !f.needs_setup).map((f) => fieldView(f, groups, systems)) };
      }

      case 'get_field': {
        const { match, candidates } = await findFieldByName(String(input.name ?? ''));
        if (candidates) return { ambiguous: true, candidates };
        if (!match) return { found: false, message: `No field named "${input.name}".` };
        const [groups, systems] = await Promise.all([loadGroups(), loadGrassSystems()]);
        return { field: fieldView(match, groups, systems) };
      }

      case 'rank_fields_by_soil': {
        const metric = String(input.metric ?? 'p');
        const order = input.order === 'desc' ? 'desc' : 'asc';
        const limit = num(input.limit, 5);
        const key = ({ ph: 'ph', p: 'p_idx', k: 'k_idx', mg: 'mg_idx' } as const)[metric as 'ph' | 'p' | 'k' | 'mg'] ?? 'p_idx';
        const [fields, groups, systems] = await Promise.all([loadFields(), loadGroups(), loadGrassSystems()]);
        const ranked = fields
          .filter((f) => !f.needs_setup && (f as unknown as Record<string, number | null>)[key] != null)
          .sort((a, b) => {
            const av = (a as unknown as Record<string, number>)[key];
            const bv = (b as unknown as Record<string, number>)[key];
            return order === 'asc' ? av - bv : bv - av;
          })
          .slice(0, limit)
          .map((f) => fieldView(f, groups, systems));
        return { metric, order, fields: ranked };
      }

      case 'get_recent_cuts': {
        const limit = num(input.limit, 20);
        let cuts: Cut[] = await loadAllCuts(); // newest first
        let fieldName: string | undefined;
        if (input.fieldName) {
          const { match } = await findFieldByName(String(input.fieldName));
          if (!match) return { found: false, message: `No field named "${input.fieldName}".` };
          fieldName = match.name;
          cuts = cuts.filter((c) => c.field_id === match.id);
        }
        const fields = await loadFields();
        const nameById = new Map(fields.map((f) => [f.id, f.name]));
        return {
          field: fieldName ?? null,
          cuts: cuts.slice(0, limit).map((c) => ({
            field: nameById.get(c.field_id) ?? null,
            cut_number: c.cut_number,
            date: c.cut_date,
            type: c.cut_type,
            yield_class: c.yield_class,
            whats_next: c.next_action,
          })),
        };
      }

      case 'get_recent_applications': {
        const limit = num(input.limit, 20);
        let apps: Application[] = await loadAllApplications(); // newest first
        let fieldName: string | undefined;
        if (input.fieldName) {
          const { match } = await findFieldByName(String(input.fieldName));
          if (!match) return { found: false, message: `No field named "${input.fieldName}".` };
          fieldName = match.name;
          apps = apps.filter((a) => a.field_id === match.id);
        }
        const [fields, products] = await Promise.all([loadFields(), loadAllProducts()]);
        const nameById = new Map(fields.map((f) => [f.id, f.name]));
        const prodById = new Map<number, Product>(products.map((p) => [p.id, p]));
        return {
          field: fieldName ?? null,
          applications: apps.slice(0, limit).map((a) => ({
            field: nameById.get(a.field_id) ?? null,
            product: prodById.get(a.product_id)?.name ?? null,
            date: a.date_applied,
            rate: `${a.rate_value} ${a.rate_unit}`,
            method: methodLabel(a.method) || null,
          })),
        };
      }

      case 'get_settings': {
        const s = await loadSettings();
        return {
          unit_system: s.unitSystem,
          soil_targets: s.soilTargets,
          n_targets_per_cut: s.nTargets,
          report_defaults: s.reportDefaults,
          timing_prompts: s.timingDefaults,
          farm_name: s.farmName ?? null,
        };
      }

      case 'get_products': {
        const products = await loadAllProducts();
        return {
          products: products.map((p) => ({
            name: p.name,
            category: p.category,
            type: p.type,
            custom: p.user_id != null,
            dm_pct: p.dm_pct,
            // Only the columns relevant to this product's type carry values.
            n_pct: p.n_pct, p2o5_pct: p.p2o5_pct, k2o_pct: p.k2o_pct, s_pct: p.s_pct,
            n_kg_per_m3: p.n_kg_per_m3, p2o5_kg_per_m3: p.p2o5_kg_per_m3, k2o_kg_per_m3: p.k2o_kg_per_m3,
            n_kg_per_t: p.n_kg_per_t, p2o5_kg_per_t: p.p2o5_kg_per_t, k2o_kg_per_t: p.k2o_kg_per_t,
          })),
        };
      }

      case 'submit_feature_request': {
        const summary = String(input.summary ?? '').trim();
        if (!summary) return { ok: false, message: 'A summary is required.' };
        const ctx = await getFarmContext();
        if (!ctx) return { ok: false, message: 'Not signed in.' };
        const supabase = createClient();
        const { error } = await supabase.from('feature_requests').insert({
          owner_id: ctx.ownerId,
          created_by: ctx.userId,
          summary,
          raw_request: input.raw_request ? String(input.raw_request) : null,
          context: input.context ? String(input.context) : null,
        });
        if (error) return { ok: false, message: 'Could not save the request.' };
        return { ok: true };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
