import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Header } from '@/components/Header';
import { loadAllocationTypes, loadFields } from '@/lib/data';
import { createAllocationType, deleteAllocationType } from '@/lib/actions';
import { ALLOCATION_KIND_LABEL } from '@/lib/allocation_types';
import { ChevronRight, Plus, Trash2, Lock } from 'lucide-react';

export const dynamic = 'force-dynamic';

function mdLabel(md: string | null): string | null {
  if (!md) return null;
  const [m, d] = md.split('-').map((x) => parseInt(x, 10));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return m >= 1 && m <= 12 ? `${d} ${months[m - 1]}` : md;
}

export default async function AllocationTypesPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [types, fields] = await Promise.all([loadAllocationTypes(), loadFields()]);
  const countByType: Record<string, number> = {};
  for (const f of fields) if (f.allocation_type_id) countByType[f.allocation_type_id] = (countByType[f.allocation_type_id] ?? 0) + 1;

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="Allocation types" subtitle="How each field is run" backHref="/settings/land" />

      <div style={{ padding: '12px 16px' }}>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
          One per field, swappable. Carries advisory management defaults — earliest-fert date, an N cap, low-input —
          that feed warnings and the composed cap. Custom types you add here behave just like the seeded four.
        </p>

        {/* Existing types */}
        {types.map((t) => {
          const isSeed = t.user_id === null;
          const bits = [
            ALLOCATION_KIND_LABEL[t.kind],
            t.low_input ? 'low input' : null,
            t.n_cap_kg_per_ha != null ? `≤${t.n_cap_kg_per_ha} kg N/ha` : null,
            mdLabel(t.earliest_fert_md) ? `from ${mdLabel(t.earliest_fert_md)}` : null,
          ].filter(Boolean).join(' · ');
          return (
            <div key={t.id} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 13px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ fontFamily: '"Fraunces", serif', fontSize: 16, fontWeight: 600 }}>{t.label}</span>
                  {isSeed && <Lock size={11} style={{ color: 'var(--muted)' }} aria-label="Seeded — customise to edit" />}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                  {bits}{countByType[t.id] ? ` · ${countByType[t.id]} field${countByType[t.id] === 1 ? '' : 's'}` : ' · no fields'}
                </div>
              </div>
              <Link href={`/settings/allocation-types/${t.id}`} aria-label={`Edit and assign ${t.label}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: 700, color: 'var(--forest-dark)', textDecoration: 'none' }}>
                {isSeed ? 'Assign / customise' : 'Edit & assign'} <ChevronRight size={15} />
              </Link>
              {!isSeed && (
                <form action={deleteAllocationType}>
                  <input type="hidden" name="id" value={t.id} />
                  <button type="submit" aria-label={`Delete ${t.label}`} style={{ border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', display: 'inline-flex', padding: 4 }}>
                    <Trash2 size={15} />
                  </button>
                </form>
              )}
            </div>
          );
        })}

        {/* Add a custom type */}
        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: 'var(--forest-dark)', display: 'inline-flex', alignItems: 'center', gap: 6, listStyle: 'none' }}>
            <Plus size={15} /> Add a custom type
          </summary>
          <form action={createAllocationType} style={{ marginTop: 12, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: 14 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>Name</label>
            <input name="label" required placeholder="e.g. Hay aftermath" style={inp} />

            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>New rounds default to</label>
                <select name="regime_default" defaultValue="silage" style={inp}>
                  <option value="silage">A cut (silage/hay)</option>
                  <option value="grazing">Grazing</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Earliest fert (MM-DD)</label>
                <input name="earliest_fert_md" placeholder="02-15" style={inp} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>N cap (kg N/ha)</label>
                <input name="n_cap_kg_per_ha" type="number" inputMode="numeric" placeholder="optional" style={inp} />
              </div>
              <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, paddingBottom: 9 }}>
                <input type="checkbox" name="low_input" style={{ width: 17, height: 17 }} /> Low input
              </label>
            </div>

            <label style={{ ...lbl, marginTop: 12 }}>Note</label>
            <input name="note" placeholder="optional" style={inp} />

            <button type="submit" className="btn-primary" style={{ marginTop: 14, width: '100%' }}>Add type</button>
          </form>
        </details>
      </div>
    </div>
  );
}

const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', fontSize: 14, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', fontFamily: 'inherit', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 };
