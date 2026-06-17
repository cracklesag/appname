import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Sprout, Trash2 } from 'lucide-react';
import {
  loadField, loadCrops, loadCropAllocationsForField, loadApplicationsForField,
  loadAllProducts, loadSettings,
} from '@/lib/data';
import { getFarmContext } from '@/lib/farm';
import {
  buildCropPlan, currentCropSeason, seasonLabel, type CropPlan,
} from '@/lib/cropplan';
import { loadedCropsByCategory, type LoadedCrop } from '@/lib/crops';
import { FieldCropAllocation } from '@/lib/types';
import {
  allocateFieldToCrop, setCropAllocationStatus, deleteCropAllocation,
} from '@/lib/actions';
import { CropPlanView } from '@/components/CropPlanView';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned', active: 'Active', harvested: 'Harvested', terminated: 'Terminated',
};
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  planned: { bg: '#EFEBE0', color: '#6B5D34' },
  active: { bg: '#E2EFE2', color: '#2F6B36' },
  harvested: { bg: '#E7EEF6', color: '#2C5A86' },
  terminated: { bg: '#F0E6E6', color: '#8A4A4A' },
};

function seasonOptions(current: number): number[] {
  return [current - 1, current, current + 1];
}

export default async function FieldCropPage({
  params, searchParams,
}: {
  params: { id: string };
  searchParams: { from?: string };
}) {
  const [field, crops, allocations, applications, products, settings, farmCtx] = await Promise.all([
    loadField(params.id),
    loadCrops(),
    loadCropAllocationsForField(params.id),
    loadApplicationsForField(params.id),
    loadAllProducts(),
    loadSettings(),
    getFarmContext(),
  ]);
  if (!field) notFound();

  const canLog = !!farmCtx && farmCtx.role !== 'agronomist';
  const currentSeason = currentCropSeason();
  const backHref = searchParams.from || `/fields/${field.id}`;

  const cropById = new Map<string, LoadedCrop>(crops.map((c) => [c.id, c]));
  const cropGroups = loadedCropsByCategory(crops);

  // Prior brassica seasons on this field — drives the clubroot warning.
  const priorBrassicaSeasons = allocations
    .filter((a) => cropById.get(a.crop_id)?.profile.family === 'brassica')
    .map((a) => a.season);

  // Focus allocation: the active one, else the most recent for this season.
  const active = allocations.find((a) => a.status === 'active') ?? null;
  const focus = active
    ?? allocations.find((a) => a.season === currentSeason)
    ?? allocations[0]
    ?? null;

  let focusPlan: CropPlan | null = null;
  if (focus) {
    const lc = cropById.get(focus.crop_id);
    if (lc) {
      focusPlan = buildCropPlan(field, focus, lc.profile, applications, products, settings, {
        priorBrassicaSeasons: priorBrassicaSeasons.filter((s) => s !== focus.season),
      });
    }
  }

  return (
    <div style={{ paddingBottom: 90 }}>
      {/* Hero */}
      <div style={{ background: 'linear-gradient(135deg, #6b5b2e 0%, #4a3f1f 100%)', color: 'var(--brand-cream, #efe7d6)', padding: '18px 16px 20px' }}>
        <Link href={backHref} className="hero-back" style={{ color: 'rgba(239,231,214,0.85)' }}>
          <ArrowLeft size={15} /> Back
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sprout size={18} />
          <h1 style={{ fontSize: 21, fontWeight: 800, margin: '2px 0 3px' }}>Crops · {field.name}</h1>
        </div>
        <p style={{ fontSize: 12.5, color: 'rgba(239,231,214,0.8)', margin: 0, lineHeight: 1.5 }}>
          Put this field on a non-grass crop for a season and get its nutrient plan — worked from this field&apos;s
          own soil and slurry. While a crop is active, this field drops out of the grass reports for that season.
        </p>
      </div>

      <div style={{ padding: '14px 16px' }}>
        {/* Focus plan */}
        {focusPlan && <CropPlanView plan={focusPlan} planned={focus?.status !== 'active'} />}
        {focus && !focusPlan && (
          <div className="card" style={{ padding: 14, marginBottom: 14, fontSize: 12, color: 'var(--muted)' }}>
            This allocation&apos;s crop is no longer in your catalogue. Delete it and re-allocate.
          </div>
        )}

        {/* Allocations on this field */}
        {allocations.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', margin: '4px 2px 10px' }}>
              Allocations
            </div>
            {allocations.map((a) => {
              const lc = cropById.get(a.crop_id);
              const st = STATUS_STYLE[a.status] ?? STATUS_STYLE.planned;
              return (
                <div key={a.id} className="card" style={{ padding: 12, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                        {lc?.profile.label ?? a.crop_key ?? 'Unknown crop'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                        {a.season} harvest
                        {a.expected_yield != null && ` · ${a.expected_yield} ${a.expected_yield_unit ?? ''}`.trimEnd()}
                        {a.sown_date && ` · sown ${a.sown_date}`}
                        {a.harvest_date && ` · harvest ${a.harvest_date}`}
                      </div>
                      {a.notes && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, lineHeight: 1.4 }}>{a.notes}</div>}
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: st.bg, color: st.color, flexShrink: 0 }}>
                      {STATUS_LABEL[a.status] ?? a.status}
                    </span>
                  </div>

                  {canLog && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, alignItems: 'center' }}>
                      {a.status !== 'active' && a.status !== 'terminated' && (
                        <StatusButton id={a.id} status="active" label="Set active" />
                      )}
                      {a.status === 'active' && (
                        <>
                          <StatusButton id={a.id} status="harvested" label="Mark harvested" />
                          <StatusButton id={a.id} status="terminated" label="Terminate" />
                        </>
                      )}
                      <form action={deleteCropAllocation} style={{ marginLeft: 'auto' }}>
                        <input type="hidden" name="allocation_id" value={a.id} />
                        <button type="submit" title="Delete allocation" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600, color: '#8A4A4A', background: 'transparent', border: '1px solid #E3CFCF', borderRadius: 7, padding: '5px 9px', cursor: 'pointer' }}>
                          <Trash2 size={12} /> Delete
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              );
            })}
            {active && (
              <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.45, margin: '2px 2px 0' }}>
                Setting another crop active will mark the current active crop harvested — that&apos;s the catch-crop → main-crop handover.
              </div>
            )}
          </div>
        )}

        {/* Allocate form */}
        {canLog ? (
          <div className="card" style={{ padding: 14 }}>
            <div className="label" style={{ marginBottom: 10 }}>Allocate this field to a crop</div>
            <form action={allocateFieldToCrop} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input type="hidden" name="field_id" value={field.id} />

              <label style={{ display: 'block' }}>
                <span style={fieldLabel}>Crop</span>
                <select name="crop_id" required defaultValue="" style={inputStyle}>
                  <option value="" disabled>Choose a crop…</option>
                  {cropGroups.map((g) => (
                    <optgroup key={g.category} label={g.label}>
                      {g.crops.map((c) => (
                        <option key={c.id} value={c.id}>{c.profile.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              <label style={{ display: 'block' }}>
                <span style={fieldLabel}>Season</span>
                <select name="season" defaultValue={String(currentSeason)} style={inputStyle}>
                  {seasonOptions(currentSeason).map((s) => (
                    <option key={s} value={s}>{seasonLabel(s)}</option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'block' }}>
                <span style={fieldLabel}>Expected yield <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional — blank uses the crop default)</span></span>
                <input type="number" name="expected_yield" step="0.1" min="0" placeholder="e.g. 12" style={inputStyle} />
              </label>

              <div style={{ display: 'flex', gap: 10 }}>
                <label style={{ display: 'block', flex: 1 }}>
                  <span style={fieldLabel}>Sown date <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></span>
                  <input type="date" name="sown_date" style={inputStyle} />
                </label>
                <label style={{ display: 'block', flex: 1 }}>
                  <span style={fieldLabel}>Harvest date <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></span>
                  <input type="date" name="harvest_date" style={inputStyle} />
                </label>
              </div>

              <label style={{ display: 'block' }}>
                <span style={fieldLabel}>Notes <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></span>
                <input type="text" name="notes" placeholder="e.g. after second-cut silage" style={inputStyle} />
              </label>

              <button type="submit" style={{ background: 'var(--forest)', color: '#fff', border: 'none', borderRadius: 9, padding: '11px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                Allocate crop
              </button>
              <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.45 }}>
                Becomes this field&apos;s active crop unless one is already active, in which case it&apos;s queued as planned — activate it once the current crop is harvested.
              </div>
            </form>
          </div>
        ) : (
          <div className="card" style={{ padding: 14, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
            You have read-only access to this farm&apos;s crops. Allocating and changing crops is done by the farm&apos;s admin or staff.
          </div>
        )}
      </div>
    </div>
  );
}

function StatusButton({ id, status, label }: { id: string; status: string; label: string }) {
  return (
    <form action={setCropAllocationStatus}>
      <input type="hidden" name="allocation_id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--forest-dark)', background: 'var(--forest-soft, #EAF1EA)', border: '1px solid var(--forest-line, #CFE0CF)', borderRadius: 7, padding: '5px 10px', cursor: 'pointer' }}>
        {label}
      </button>
    </form>
  );
}

const fieldLabel: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--ink)', marginBottom: 5,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 11px', fontSize: 14, border: '1px solid var(--line)',
  borderRadius: 8, background: '#fff', color: 'var(--ink)', boxSizing: 'border-box',
};
