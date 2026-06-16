import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Header } from '@/components/Header';
import { loadAllocationTypes, loadFields } from '@/lib/data';
import { updateAllocationType, forkAllocationType } from '@/lib/actions';
import { TypeMembershipEditor } from '@/components/TypeMembershipEditor';
import { ALLOCATION_KIND_LABEL } from '@/lib/allocation_types';

export const dynamic = 'force-dynamic';

export default async function AllocationTypeDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [types, fields] = await Promise.all([loadAllocationTypes(), loadFields()]);
  const type = types.find((t) => t.id === params.id);
  if (!type) notFound();
  const isSeed = type.user_id === null;

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title={type.label} subtitle={`${ALLOCATION_KIND_LABEL[type.kind]} · allocation type`} backHref="/settings/allocation-types" />

      <div style={{ padding: '12px 16px' }}>
        {/* Params */}
        {isSeed ? (
          <div style={{ background: 'var(--forest-soft)', border: '1px solid var(--line)', borderRadius: 8, padding: 13, marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
              This is a seeded type, so its defaults are read-only. To set an N cap, an earliest-fert date or a note,
              make your own editable copy.
            </div>
            <form action={forkAllocationType} style={{ marginTop: 10 }}>
              <input type="hidden" name="source_id" value={type.id} />
              <button type="submit" className="btn-primary" style={{ width: '100%' }}>Customise (make an editable copy)</button>
            </form>
          </div>
        ) : (
          <form action={updateAllocationType} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: 14, marginBottom: 16 }}>
            <input type="hidden" name="id" value={type.id} />
            <label style={lbl}>Name</label>
            <input name="label" defaultValue={type.label} required style={inp} />
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>New rounds default to</label>
                <select name="regime_default" defaultValue={type.regime_default} style={inp}>
                  <option value="silage">A cut (silage/hay)</option>
                  <option value="grazing">Grazing</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Earliest fert (MM-DD)</label>
                <input name="earliest_fert_md" defaultValue={type.earliest_fert_md ?? ''} placeholder="02-15" style={inp} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>N cap (kg N/ha)</label>
                <input name="n_cap_kg_per_ha" type="number" inputMode="numeric" defaultValue={type.n_cap_kg_per_ha ?? ''} placeholder="optional" style={inp} />
              </div>
              <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, paddingBottom: 9 }}>
                <input type="checkbox" name="low_input" defaultChecked={type.low_input} style={{ width: 17, height: 17 }} /> Low input
              </label>
            </div>
            <label style={{ ...lbl, marginTop: 12 }}>Note</label>
            <input name="note" defaultValue={type.note ?? ''} placeholder="optional" style={inp} />
            <button type="submit" className="btn-primary" style={{ marginTop: 14, width: '100%' }}>Save details</button>
          </form>
        )}

        {/* Assignment */}
        <div className="label" style={{ marginBottom: 8 }}>Fields</div>
        <TypeMembershipEditor type={type} fields={fields} types={types} />
      </div>
    </div>
  );
}

const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', fontSize: 14, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', fontFamily: 'inherit', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 };
