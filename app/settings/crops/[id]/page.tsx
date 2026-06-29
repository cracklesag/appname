import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Header } from '@/components/Header';
import { loadCrops } from '@/lib/data';
import { updateCrop, forkCrop } from '@/lib/actions';
import { CATEGORY_LABEL, EVIDENCE_LABEL, type CropCategory, type EvidenceGrade, type PKRegime } from '@/lib/crops';
import { ChevronRight } from 'lucide-react';

export const dynamic = 'force-dynamic';

const CATEGORIES: CropCategory[] = ['forage', 'cereal_grain', 'catch'];
const PK_REGIMES: { value: PKRegime; label: string }[] = [
  { value: 'offtake_replacement', label: 'Offtake replacement' },
  { value: 'seedbed_low_index_only', label: 'Seedbed only (low index)' },
];
const EVIDENCE: EvidenceGrade[] = ['rb209', 'rb209_plus_trial', 'trial'];

export default async function CropEditPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const crops = await loadCrops();
  const crop = crops.find((c) => c.id === params.id);
  if (!crop) notFound();
  const isSeed = crop.userId === null;
  const p = crop.profile;
  const o = p.offtake;

  return (
    <div style={{ paddingBottom: 90 }}>
      <Header title={p.label} subtitle="Crop catalogue" backHref="/settings/crops" />

      <div style={{ padding: '12px 16px' }}>
        {isSeed ? (
          <div style={{ background: 'var(--forest-soft)', border: '1px solid var(--line)', borderRadius: 8, padding: 13 }}>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
              This is a seeded crop, so its figures are read-only. To tune the yield, offtake, nitrogen target or pH for
              your ground, make your own editable custom version.
            </div>
            <form action={forkCrop} style={{ marginTop: 10 }}>
              <input type="hidden" name="crop_id" value={crop.id} />
              <button type="submit" className="btn-primary" style={{ width: '100%' }}>Make an editable custom version</button>
            </form>
          </div>
        ) : (
          <form action={updateCrop} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: 14 }}>
            <input type="hidden" name="id" value={crop.id} />

            <label style={lbl}>Name</label>
            <input name="label" defaultValue={p.label} required style={inp} />

            <label style={{ ...lbl, marginTop: 12 }}>Category</label>
            <select name="category" defaultValue={p.category} style={inp}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>

            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Default yield</label>
                <input name="yield_default" type="number" step="0.1" inputMode="decimal" defaultValue={p.yieldDefault} style={inp} />
              </div>
              <div style={{ flex: 1.4 }}>
                <label style={lbl}>Yield unit</label>
                <input name="yield_unit" defaultValue={p.yieldUnit} placeholder="t DM/ha" style={inp} />
              </div>
            </div>
            <label style={{ ...lbl, marginTop: 12 }}>Yield range (text)</label>
            <input name="yield_range" defaultValue={p.yieldRange} placeholder="10–14 t DM/ha" style={inp} />

            {/* Everyday figures stay at the top; the detail sits under Advanced. */}
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>N target (kg N/ha)</label>
                <input name="n_target_kg_per_ha" type="number" step="1" inputMode="numeric" defaultValue={p.nTargetKgPerHa} style={inp} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Target pH</label>
                <input name="target_ph" type="number" step="0.1" inputMode="decimal" defaultValue={p.targetPh} style={inp} />
              </div>
            </div>
            <label style={{ ...lbl, marginTop: 12 }}>pH note <span style={{ fontWeight: 400 }}>(opt)</span></label>
            <input name="ph_note" defaultValue={p.phNote ?? ''} style={inp} />

            <details style={{ marginTop: 16 }}>
              <summary style={advSummary}>
                <ChevronRight size={15} /> Advanced nutrient detail
              </summary>
              <div style={{ paddingTop: 2 }}>
                <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5, margin: '2px 0 6px' }}>
                  Offtake, micronutrients and provenance. The figures carried from the crop you based this on are sensible
                  defaults — only change them if you have numbers for your ground.
                </p>

                <div style={sectionHdr}>Offtake (kg per unit of yield)</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>P₂O₅</label>
                    <input name="offtake_p2o5" type="number" step="0.1" inputMode="decimal" defaultValue={o.p2o5} style={inp} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>K₂O</label>
                    <input name="offtake_k2o" type="number" step="0.1" inputMode="decimal" defaultValue={o.k2o} style={inp} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>N <span style={{ fontWeight: 400 }}>(opt)</span></label>
                    <input name="offtake_n" type="number" step="0.1" inputMode="decimal" defaultValue={o.n ?? ''} placeholder="—" style={inp} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>MgO <span style={{ fontWeight: 400 }}>(opt)</span></label>
                    <input name="offtake_mgo" type="number" step="0.1" inputMode="decimal" defaultValue={o.mgo ?? ''} placeholder="—" style={inp} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>Na₂O <span style={{ fontWeight: 400 }}>(opt)</span></label>
                    <input name="offtake_na2o" type="number" step="0.1" inputMode="decimal" defaultValue={o.na2o ?? ''} placeholder="—" style={inp} />
                  </div>
                  <div style={{ flex: 1 }} />
                </div>
                <label style={{ ...lbl, marginTop: 10 }}>Offtake basis (text)</label>
                <input name="offtake_basis" defaultValue={o.basis} placeholder="per t fresh weight" style={inp} />

                <div style={sectionHdr}>Nitrogen &amp; P/K</div>
                <label style={lbl}>Total-N description</label>
                <input name="total_n" defaultValue={p.totalN} style={inp} />
                <label style={{ ...lbl, marginTop: 12 }}>P/K regime</label>
                <select name="pk_regime" defaultValue={p.pkRegime} style={inp}>
                  {PK_REGIMES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>

                <div style={sectionHdr}>Soil fit &amp; micronutrients</div>
                <label style={lbl}>Soil fit</label>
                <input name="soil_fit" defaultValue={p.soilFit} style={inp} />
                <label style={{ ...lbl, marginTop: 12 }}>Manure fit</label>
                <input name="manure_fit" defaultValue={p.manureFit} style={inp} />
                <div style={{ display: 'flex', gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
                  <label style={chk}><input type="checkbox" name="needs_mg" defaultChecked={!!p.needsMg} style={cbox} /> Needs Mg</label>
                  <label style={chk}><input type="checkbox" name="needs_na" defaultChecked={!!p.needsNa} style={cbox} /> Needs Na</label>
                  <label style={chk}><input type="checkbox" name="needs_s" defaultChecked={!!p.needsS} style={cbox} /> Sulphur-hungry</label>
                </div>
                <label style={{ ...lbl, marginTop: 12 }}>Sulphur note <span style={{ fontWeight: 400 }}>(opt)</span></label>
                <input name="sulphur_note" defaultValue={p.sulphurNote ?? ''} style={inp} />

                <div style={sectionHdr}>Rotation</div>
                <label style={chk}><input type="checkbox" name="is_brassica" defaultChecked={p.family === 'brassica'} style={cbox} /> Brassica (clubroot rotation risk)</label>
                <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginTop: 5 }}>
                  Flags this crop as a brassica so the plan warns when a field has grown brassicas too recently for a safe clubroot break.
                </div>

                <div style={sectionHdr}>Provenance</div>
                <label style={lbl}>Evidence grade</label>
                <select name="evidence" defaultValue={p.evidence} style={inp}>
                  {EVIDENCE.map((e) => <option key={e} value={e}>{EVIDENCE_LABEL[e]}</option>)}
                </select>
                <label style={{ ...lbl, marginTop: 12 }}>Sources</label>
                <input name="sources" defaultValue={p.sources} style={inp} />
                <label style={{ ...lbl, marginTop: 12 }}>Summary (one line)</label>
                <input name="summary" defaultValue={p.summary} style={inp} />

                <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginTop: 14, background: 'var(--paper-deep, #f4efe2)', borderRadius: 6, padding: '8px 10px' }}>
                  The nitrogen stage timings and micronutrient notes are carried from the crop you based this on and aren&apos;t
                  edited here — the figures above drive the plan&apos;s rates.
                </div>
              </div>
            </details>

            <button type="submit" className="btn-primary" style={{ marginTop: 14, width: '100%' }}>Save crop</button>
          </form>
        )}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', fontSize: 14, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', fontFamily: 'inherit', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 };
const chk: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 };
const cbox: React.CSSProperties = { width: 17, height: 17 };
const advSummary: React.CSSProperties = { cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--forest-dark)', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 0' };
const sectionHdr: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--forest-dark)', margin: '18px 0 8px' };
