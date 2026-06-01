import { Application, Cut, Field, Product, Settings } from '@/lib/types';
import {
  calcNutrients, displayRate, fmt, fmtDate, getOfftakeForCut, nutrientPerArea,
  MONTH_NAMES, slurryNAvailability, METHOD_LABELS, CUT_TYPE_LABELS, YIELD_CLASS_LABELS,
} from '@/lib/rules';
import { ProductPill } from './ProductPill';
import { EditDeleteControls } from './EditDeleteControls';
import { deleteApplication, deleteCut } from '@/lib/actions';
import { Scissors } from 'lucide-react';

export function ApplicationCard({
  app, products, settings, fieldId, canEdit = true,
}: {
  app: Application;
  products: Product[];
  settings: Settings;
  fieldId: string;
  /** Whether to show edit/delete controls. Staff only edit their own entries. */
  canEdit?: boolean;
}) {
  const product = products.find((p) => p.id === app.product_id);
  const nut = calcNutrients(product, app.rate_value, app.rate_unit, app.date_applied, app.method);
  const isLime = product?.type === 'lime';
  const disp = product ? displayRate(app, settings, product.type) : { value: app.rate_value, unit: app.rate_unit };
  const isPlanItem = app.applied_by === 'plan';
  // Show what THIS application supplied, in the user's area unit (so it matches
  // the rest of the app — the calc engine works in kg/ha internally).
  const nutUnit = settings.unitSystem === 'acres' ? 'kg/ac' : 'kg/ha';
  const av = (kgHa: number) => Math.round(nutrientPerArea(kgHa, settings.unitSystem));
  return (
    <div className="card" style={{ padding: 12, marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 700 }}>{fmtDate(app.date_applied)}</div>
          <div style={{ marginTop: 4 }}><ProductPill product={product} /></div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="nutrient-num" style={{ fontSize: 15, color: 'var(--ink)' }}>
            {fmt(disp.value, isLime ? 1 : 0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{disp.unit}</div>
        </div>
      </div>
      {!isLime ? (
        <>
          <div style={{ display: 'flex', gap: 12, fontSize: 13, paddingTop: 8, borderTop: '1px solid var(--line-soft)' }}>
            <div><span style={{ color: 'var(--muted)' }}>N</span> <span className="nutrient-num" style={{ color: 'var(--ink)' }}>{fmt(av(nut.nPerHa))}</span></div>
            <div><span style={{ color: 'var(--muted)' }}>P</span> <span className="nutrient-num" style={{ color: 'var(--ink)' }}>{fmt(av(nut.p2o5PerHa))}</span></div>
            <div><span style={{ color: 'var(--muted)' }}>K</span> <span className="nutrient-num" style={{ color: 'var(--ink)' }}>{fmt(av(nut.k2oPerHa))}</span></div>
            <div style={{ color: 'var(--muted)', fontSize: 11, alignSelf: 'center' }}>{nutUnit}</div>
            {nut.nNote && <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>{nut.nNote}</div>}
          </div>
          {(nut.so3PerHa > 0 || nut.mgoPerHa > 0) && (
            <div style={{ display: 'flex', gap: 12, fontSize: 12, marginTop: 4, color: 'var(--muted)' }}>
              {nut.so3PerHa > 0 && (
                <div>SO₃ <span className="nutrient-num" style={{ color: 'var(--ink-soft)' }}>{fmt(av(nut.so3PerHa))}</span></div>
              )}
              {nut.mgoPerHa > 0 && (
                <div>MgO <span className="nutrient-num" style={{ color: 'var(--ink-soft)' }}>{fmt(av(nut.mgoPerHa))}</span></div>
              )}
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--muted)', paddingTop: 8, borderTop: '1px solid var(--line-soft)', fontStyle: 'italic' }}>
          pH amendment — resample 6–12 months later
        </div>
      )}
      {app.notes && !isPlanItem && (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>{app.notes}</div>
      )}
      {canEdit && (
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--line-soft)', display: 'flex', justifyContent: 'flex-end' }}>
        <EditDeleteControls
          editHref={`/fields/${fieldId}/applications/${app.id}/edit?from=${encodeURIComponent(`/fields/${fieldId}?tab=season`)}`}
          deleteAction={deleteApplication}
          hiddenInputs={{ id: app.id, field_id: fieldId }}
          label="application"
        />
      </div>
      )}
    </div>
  );
}

export function CutEntry({ cut, field, settings, canEdit = true, from }: { cut: Cut; field: Field; settings: Settings; canEdit?: boolean; from?: string }) {
  const off = getOfftakeForCut(field.cut_profile, cut.cut_number, cut.yield_class, settings, cut.cut_type);
  // Where to return after editing — caller passes its own URL (filtered activity
  // view or a field tab); default to the field's season tab.
  const editFrom = from || `/fields/${field.id}?tab=season`;
  return (
    <div className="card" style={{ padding: 12, marginBottom: 8, background: 'var(--amber-soft)', borderColor: 'var(--amber)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Scissors size={18} style={{ color: 'var(--amber)' }} />
          <div>
            <div style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Cut {cut.cut_number} · {CUT_TYPE_LABELS[cut.cut_type]} · {YIELD_CLASS_LABELS[cut.yield_class]}
            </div>
            <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 700 }}>{fmtDate(cut.cut_date)}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--ink-soft)' }}>
          <div>Offtake ({fmt(off.yieldDM, 1)} t DM/ha)</div>
          <div className="nutrient-num" style={{ fontSize: 12 }}>{fmt(off.n)} N · {fmt(off.p2o5)} P · {fmt(off.k2o)} K</div>
        </div>
      </div>
      {cut.notes && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-soft)', fontStyle: 'italic' }}>{cut.notes}</div>}
      {canEdit && (
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.08)', display: 'flex', justifyContent: 'flex-end' }}>
        <EditDeleteControls
          editHref={`/fields/${field.id}/cuts/${cut.id}/edit?from=${encodeURIComponent(editFrom)}`}
          deleteAction={deleteCut}
          hiddenInputs={{ id: cut.id, field_id: field.id }}
          label="cut"
        />
      </div>
      )}
    </div>
  );
}

export function NAvailabilityStrip() {
  const today = new Date();
  const currentMonth = today.getMonth();
  const months = [8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7].map((idx) => {
    const yearShift = idx >= 8 ? -1 : 0;
    const repDate = new Date(today.getFullYear() + yearShift, idx, 15);
    const pct = Math.round(slurryNAvailability(repDate.toISOString().slice(0, 10), 'splash_plate') * 100);
    return { idx, label: MONTH_NAMES[idx][0], pct, isCurrent: idx === currentMonth };
  });
  return (
    <div className="card" style={{ padding: 12, marginBottom: 14 }}>
      <div className="label" style={{ marginBottom: 8 }}>
        Slurry N availability through the season{' '}
        <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--muted)' }}>· splash plate</span>
      </div>
      <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 56 }}>
        {months.map((m) => (
          <div key={m.idx} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{
              fontSize: 10,
              color: m.pct === 0 ? 'var(--muted)' : 'var(--ink)',
              fontWeight: 700,
              fontFamily: "'Fraunces', serif",
              fontVariantNumeric: 'tabular-nums',
            }}>{m.pct}</div>
            <div style={{
              width: '100%',
              height: Math.max(2, m.pct * 0.4),
              background: m.isCurrent ? 'var(--forest)' : m.pct === 0 ? 'var(--line)' : 'var(--slurry)',
              borderRadius: 1,
            }} />
            <div style={{ fontSize: 10, color: m.isCurrent ? 'var(--ink)' : 'var(--muted)', fontWeight: m.isCurrent ? 700 : 400 }}>{m.label}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
        Sep–Dec: P and K still count, N assumed leached. Jan–Mar ramps. Dribble bar / trail shoe lift each figure 2–5 pts.
      </div>
    </div>
  );
}
