import Link from 'next/link';
import { Save, LogOut, ChevronRight } from 'lucide-react';
import { Header } from '@/components/Header';
import { ResetDataSection } from '@/components/ResetDataSection';
import { loadSettings } from '@/lib/data';
import { saveSettings, signOut } from '@/lib/actions';
import { CUT_TYPE_LABELS } from '@/lib/rules';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const s = await loadSettings();

  function Segment({
    name, value, options,
  }: { name: string; value: string; options: { value: string; label: string }[] }) {
    return (
      <div className="toggle-group">
        {options.map((opt) => (
          <label key={opt.value} className={`toggle-btn ${value === opt.value ? 'active' : ''}`} style={{ cursor: 'pointer' }}>
            <input
              type="radio"
              name={name}
              value={opt.value}
              defaultChecked={value === opt.value}
              style={{ display: 'none' }}
            />
            {opt.label}
          </label>
        ))}
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="Settings" />
      <form action={saveSettings}>
        <div style={{ padding: 16 }}>
          {/* Units */}
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 10 }}>Units</div>

            <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--line-soft)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>System</div>
              <Segment
                name="unit_system"
                value={s.unitSystem}
                options={[
                  { value: 'acres', label: 'Acres' },
                  { value: 'hectares', label: 'Hectares' },
                ]}
              />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
                Changes the default for field sizes, fertiliser, slurry and lime
                everywhere in the app. You can still pick different units per
                category below if you prefer to mix.
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Bag fertiliser</div>
              <Segment
                name="bag_fert_unit"
                value={s.bagFertUnit}
                options={[
                  { value: 'kg/ha', label: 'kg/ha' },
                  { value: 'kg/ac', label: 'kg/ac' },
                  { value: 'lb/ac', label: 'lb/ac' },
                  { value: 'units/ac', label: 'units/ac' },
                ]}
              />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
                "units/ac" is the traditional UK measure of nutrient applied
                (1 unit ≈ 1.12 lb/ac of N, P₂O₅ or K₂O). This setting only changes
                how nutrient totals are displayed — products are still logged in
                whatever unit you pick on the log screen.
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Slurry</div>
              <Segment
                name="slurry_unit"
                value={s.slurryUnit}
                options={[
                  { value: 'gal/ac', label: 'gal/ac' },
                  { value: 'm3/ha', label: 'm³/ha' },
                ]}
              />
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Lime</div>
              <Segment
                name="lime_unit"
                value={s.limeUnit}
                options={[
                  { value: 't/ac', label: 't/ac' },
                  { value: 't/ha', label: 't/ha' },
                ]}
              />
            </div>
          </div>

          {/* Yield class multipliers */}
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 6 }}>Yield class multipliers</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              Multiplied against the modelled yield to compute actual offtake.
            </div>
            {(['light', 'average', 'heavy'] as const).map((key) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 700, textTransform: 'capitalize' }}>{key}</div>
                <input
                  type="number" step="0.05" name={`yield_${key}`}
                  className="input" style={{ width: 80, textAlign: 'right' }}
                  defaultValue={s.yieldMultipliers[key]}
                />
                <span style={{ fontSize: 12, color: 'var(--muted)', width: 30 }}>×</span>
              </div>
            ))}
          </div>

          {/* Cut type multipliers */}
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 6 }}>Cut type multipliers</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              How much of the modelled yield each cut type lifts. Silage = 1.0, bales typically lighter, grazing matches silage but most nutrients return.
            </div>
            {(['silage', 'bales', 'grazing'] as const).map((key) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{CUT_TYPE_LABELS[key]}</div>
                <input
                  type="number" step="0.05" name={`ct_${key}`}
                  className="input" style={{ width: 80, textAlign: 'right' }}
                  defaultValue={s.cutTypeMultipliers[key]}
                />
                <span style={{ fontSize: 12, color: 'var(--muted)', width: 30 }}>×</span>
              </div>
            ))}
          </div>

          {/* Grazing return */}
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 6 }}>Grazing nutrient return</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              Percentage of grazed nutrients returned via dung and urine.
            </div>
            <input
              type="number" min="0" max="100" step="5" name="grazing_return"
              className="input"
              defaultValue={Math.round(s.grazingReturnPct * 100)}
            />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>0–100 %</div>
          </div>

          {/* N targets */}
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 6 }}>N target per cut</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              How much available N each cut should receive (kg/ha).
            </div>
            {[1, 2, 3, 4].map((n) => (
              <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>Cut {n}</div>
                <input
                  type="number" name={`n_cut${n}`}
                  className="input" style={{ width: 90, textAlign: 'right' }}
                  defaultValue={s.nTargets[n as 1|2|3|4] ?? 0}
                />
                <span style={{ fontSize: 12, color: 'var(--muted)', width: 50 }}>kg/ha</span>
              </div>
            ))}
          </div>

          {/* Soil targets */}
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 6 }}>Soil targets</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              Field cards colour-code each metric against these targets. RB209 grass-silage defaults: pH 6.0, P 2, K 2.
            </div>
            {[
              { name: 'target_ph',   label: 'pH',      value: s.soilTargets.pH,   step: '0.1' },
              { name: 'target_pidx', label: 'P index', value: s.soilTargets.pIdx, step: '0.1' },
              { name: 'target_kidx', label: 'K index', value: s.soilTargets.kIdx, step: '0.1' },
            ].map((row) => (
              <div key={row.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{row.label}</div>
                <input type="number" step={row.step} name={row.name} className="input" style={{ width: 90, textAlign: 'right' }} defaultValue={row.value} />
              </div>
            ))}
          </div>

          {/* Report defaults */}
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 6 }}>Report defaults</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              Defaults applied when generating spreading recommendation reports. You can adjust them per report when needed.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Split dressing — first N %</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>How much of the N target goes on the first dressing (40-80). 60 = front-loaded. P and K stay full on every dressing.</div>
              </div>
              <input
                type="number" min="40" max="80" step="5"
                name="report_split_pct"
                className="input"
                style={{ width: 90, textAlign: 'right' }}
                defaultValue={s.reportDefaults.splitFrontLoadPct}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Annual N cap (kg N/ha)</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>RB209 default 320 for intensive cut+grazed grass. Lower for clover-rich swards.</div>
              </div>
              <input
                type="number" min="100" max="400" step="10"
                name="report_n_cap"
                className="input"
                style={{ width: 90, textAlign: 'right' }}
                defaultValue={s.reportDefaults.annualNCapKgPerHa}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Grazing N cadence</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Top-up rate while continually grazing. Used by the grazing report.</div>
              </div>
              <input
                type="number" min="10" max="80" step="5"
                name="report_grazing_n"
                className="input"
                style={{ width: 60, textAlign: 'right' }}
                defaultValue={s.reportDefaults.grazingCadenceKgN}
              />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>kg/ha every</span>
              <input
                type="number" min="1" max="12" step="1"
                name="report_grazing_weeks"
                className="input"
                style={{ width: 50, textAlign: 'right' }}
                defaultValue={s.reportDefaults.grazingCadenceWeeks}
              />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>weeks</span>
            </div>
          </div>
        </div>

        <div className="sticky-footer">
          <button type="submit" className="btn-primary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Save size={18} /> Save settings
          </button>
        </div>
      </form>

      <div style={{ padding: 16 }}>
        <Link
          href="/reports/spreading"
          className="card"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: 14, marginBottom: 14, textDecoration: 'none', color: 'inherit',
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Spreading report</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              Plan a round of inputs and see remaining shortfall per field
            </div>
          </div>
          <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
        </Link>
        <Link
          href="/reports/grazing"
          className="card"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: 14, marginBottom: 14, textDecoration: 'none', color: 'inherit',
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Grazing top-up</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              N cadence schedule for grazing fields — when each field is due
            </div>
          </div>
          <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
        </Link>
        <Link
          href="/products"
          className="card"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: 14, marginBottom: 14, textDecoration: 'none', color: 'inherit',
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Custom products</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              Add or remove your own products on top of the RB209 catalogue
            </div>
          </div>
          <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
        </Link>
        <Link
          href="/settings/groups"
          className="card"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: 14, marginBottom: 14, textDecoration: 'none', color: 'inherit',
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Groups</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              Organise fields into blocks of land for filtering and reports
            </div>
          </div>
          <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
        </Link>
        <ResetDataSection />
        <form action={signOut}>
          <button type="submit" className="btn-ghost" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <LogOut size={16} /> Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
