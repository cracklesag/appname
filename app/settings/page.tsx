import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Save, LogOut, ChevronRight, Users, UserPlus, SlidersHorizontal, FlaskConical, ListChecks, HardHat } from 'lucide-react';
import { ResetDataSection } from '@/components/ResetDataSection';
import { ExportDataSection } from '@/components/ExportDataSection';
import { DeleteAccountSection } from '@/components/DeleteAccountSection';
import { LegalLinksSection } from '@/components/LegalLinksSection';
import { loadSettings } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { getFarmContext } from '@/lib/farm';
import { saveSettings, signOut } from '@/lib/actions';
import { CUT_TYPE_LABELS } from '@/lib/rules';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const s = await loadSettings();
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');
  const isStaff = !ctx.isAdmin;

  // For the admin delete-account warning: how many staff would lose access.
  let staffCount = 0;
  if (ctx.isAdmin) {
    const sb = createClient();
    const { count } = await sb
      .from('farm_members')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', ctx.ownerId)
      .eq('role', 'staff');
    staffCount = count ?? 0;
  }

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
      {/* Branded hero — matches the rest of the app */}
      <div style={{ background: 'var(--forest-dark)', padding: '16px 18px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/swardly-mark-cream.png" alt="" width={30} height={22} style={{ objectFit: 'contain' }} />
          <span style={{ fontFamily: '"Fraunces", serif', fontSize: 21, fontWeight: 600, color: 'var(--brand-cream)' }}>swardly</span>
        </div>
        <div style={{ marginTop: 14 }}>
          <span style={{ fontFamily: '"Fraunces", serif', fontSize: 22, fontWeight: 600, color: 'var(--brand-cream)' }}>Settings</span>
        </div>
      </div>

      {isStaff ? (
        // Staff see a minimal settings page — they can't change farm
        // parameters. Just their account + a note about their access.
        <div style={{ padding: 16 }}>
          <div className="card" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', marginBottom: 6 }}>You&apos;re staff on this farm</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
              You can log cuts, fertiliser, slurry, manure and lime, and edit your own entries.
              Fields, soil, groups, products and settings are managed by the farm admin.
            </div>
          </div>
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.06em', color: 'var(--muted)',
            marginBottom: 8, paddingLeft: 2,
          }}>
            Account &amp; data
          </div>
          <ExportDataSection />
          <DeleteAccountSection isAdmin={false} staffCount={0} farmName={s.farmName ?? null} />
          <LegalLinksSection />
          <form action={signOut}>
            <button type="submit" className="btn-ghost" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <LogOut size={16} /> Sign out
            </button>
          </form>
        </div>
      ) : (
      <>
      {/* Setup guide — revisit the home checklist */}
      <div style={{ padding: '14px 16px 0' }}>
        <Link href="/?setup=1" className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 14, marginBottom: 4, textDecoration: 'none', color: 'inherit' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <ListChecks size={18} style={{ color: 'var(--forest)' }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Setup guide</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Revisit the getting-started steps</div>
            </div>
          </div>
          <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
        </Link>
      </div>

      {/* Team — admin only */}
      <div style={{ padding: '14px 16px 0' }}>
        <Link href="/settings/team" className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 14, marginBottom: 4, textDecoration: 'none', color: 'inherit' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <Users size={18} style={{ color: 'var(--forest)' }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Team</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Add staff who can log spreading and cuts</div>
            </div>
          </div>
          <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
        </Link>
        <Link href="/settings/contractors" className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 14, marginBottom: 4, textDecoration: 'none', color: 'inherit' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <HardHat size={18} style={{ color: 'var(--forest)' }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Contractors</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Send jobs to contractors, or get your code to receive them</div>
            </div>
          </div>
          <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
        </Link>
        <Link href="/join" className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 14, marginBottom: 4, textDecoration: 'none', color: 'inherit' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <UserPlus size={18} style={{ color: 'var(--forest)' }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Join a farm</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Got an invite code? Join as staff</div>
            </div>
          </div>
          <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
        </Link>
      </div>
      <form action={saveSettings}>
        <div style={{ padding: 16 }}>
          {/* Farm name */}
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 8 }}>Farm name</div>
            <input
              type="text"
              name="farm_name"
              className="input"
              placeholder="e.g. Mill Farm"
              defaultValue={s.farmName ?? ''}
              maxLength={60}
              autoComplete="off"
            />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
              Shown at the top of the app.
            </div>
          </div>

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

          {/* Advanced agronomy tuning — collapsed by default. Most users never
              touch these; they're the model multipliers and report defaults. */}
          <details style={{ marginBottom: 14 }}>
            <summary style={{
              listStyle: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 14, fontWeight: 700, color: 'var(--forest-dark)',
              padding: '12px 14px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8,
            }}>
              <SlidersHorizontal size={16} /> Advanced settings
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>model tuning &amp; report defaults</span>
            </summary>
            <div style={{ marginTop: 12 }}>

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
              How much available N each cut should receive (kg/ha). This is the per-cut N target the fertiliser plan works to.
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
              Field cards colour-code each metric against these targets. Grass-silage defaults: pH 6.0, P 2, K 2.
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
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Default 320 for intensive cut+grazed grass. Lower for clover-rich swards.</div>
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

            {/* Maintenance dose threshold — the kg N/ha that has to be
                applied to a maintenance-flagged field before it drops out
                of the spreading report's Maintenance mode. Slurry, liquid
                digestate and mineral fert all count toward this. FYM /
                solid manures / poultry / biosolids do not (slow-release). */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Maintenance dose threshold</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  N total a maintenance-flagged field needs before dropping from the report.
                  Slurry, liquid digestate and bag fert all count. FYM/solids/poultry do not.
                </div>
              </div>
              <input
                type="number" min="0" max="200" step="5"
                name="report_maintenance_threshold"
                className="input"
                style={{ width: 70, textAlign: 'right' }}
                defaultValue={s.reportDefaults.maintenanceDoseThresholdKgN}
              />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>kg N/ha</span>
            </div>
          </div>

          {/* Carryover release model (fert plan) */}
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 4 }}>Carryover release model</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5 }}>
              How much of an earlier slurry or muck application&apos;s P &amp; K the fertiliser plan
              treats as available now, by months since spreading. An estimate, not a published figure —
              tune it to what you see on your ground.
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 6 }}>Slurry / digestate (fast)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ flex: 1, fontSize: 12, color: 'var(--ink)' }}>Available in month spread</div>
              <input type="number" min="0" max="100" step="5" name="release_slurry_start" className="input" style={{ width: 64, textAlign: 'right' }} defaultValue={s.reportDefaults.releaseSlurryStartPct} />
              <span style={{ fontSize: 12, color: 'var(--muted)', width: 14 }}>%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1, fontSize: 12, color: 'var(--ink)' }}>Extra per month after</div>
              <input type="number" min="0" max="100" step="5" name="release_slurry_permonth" className="input" style={{ width: 64, textAlign: 'right' }} defaultValue={s.reportDefaults.releaseSlurryPerMonthPct} />
              <span style={{ fontSize: 12, color: 'var(--muted)', width: 14 }}>%</span>
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 6 }}>FYM / solid manure (slow)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ flex: 1, fontSize: 12, color: 'var(--ink)' }}>Available in month spread</div>
              <input type="number" min="0" max="100" step="5" name="release_fym_start" className="input" style={{ width: 64, textAlign: 'right' }} defaultValue={s.reportDefaults.releaseFymStartPct} />
              <span style={{ fontSize: 12, color: 'var(--muted)', width: 14 }}>%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ flex: 1, fontSize: 12, color: 'var(--ink)' }}>Extra per month after</div>
              <input type="number" min="0" max="100" step="5" name="release_fym_permonth" className="input" style={{ width: 64, textAlign: 'right' }} defaultValue={s.reportDefaults.releaseFymPerMonthPct} />
              <span style={{ fontSize: 12, color: 'var(--muted)', width: 14 }}>%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, fontSize: 12, color: 'var(--ink)' }}>Maximum ever released</div>
              <input type="number" min="0" max="100" step="5" name="release_fym_cap" className="input" style={{ width: 64, textAlign: 'right' }} defaultValue={s.reportDefaults.releaseFymCapPct} />
              <span style={{ fontSize: 12, color: 'var(--muted)', width: 14 }}>%</span>
            </div>
          </div>

          {/* Minimum spread rate (fert plan) */}
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 4 }}>Minimum spread rate</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5 }}>
              The fert plan won&apos;t recommend a granular rate below this — too small to spread
              accurately. A shortfall under the threshold is held and carried forward, then shows
              once it builds up enough to be worth applying. Set in kg of nutrient per hectare.
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ flex: 1, fontSize: 12, color: 'var(--ink)' }}>
                P₂O₅ minimum
                <span style={{ display: 'block', fontSize: 10, color: 'var(--muted)' }}>
                  ≈ {Math.round(s.reportDefaults.minSpreadP2O5KgPerHa / 2.4711)} kg/ac
                </span>
              </div>
              <input type="number" min="0" max="100" step="5" name="min_spread_p" className="input" style={{ width: 64, textAlign: 'right' }} defaultValue={s.reportDefaults.minSpreadP2O5KgPerHa} />
              <span style={{ fontSize: 12, color: 'var(--muted)', width: 38 }}>kg/ha</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, fontSize: 12, color: 'var(--ink)' }}>
                K₂O minimum
                <span style={{ display: 'block', fontSize: 10, color: 'var(--muted)' }}>
                  ≈ {Math.round(s.reportDefaults.minSpreadK2OKgPerHa / 2.4711)} kg/ac
                </span>
              </div>
              <input type="number" min="0" max="100" step="5" name="min_spread_k" className="input" style={{ width: 64, textAlign: 'right' }} defaultValue={s.reportDefaults.minSpreadK2OKgPerHa} />
              <span style={{ fontSize: 12, color: 'var(--muted)', width: 38 }}>kg/ha</span>
            </div>
          </div>
            </div>
          </details>
        </div>

        {/* Timing prompts — drive the home screen "Coming up" section */}
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 8, paddingLeft: 2 }}>
            Timing prompts
          </div>
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
              Controls the home screen&apos;s &ldquo;Act now&rdquo; and &ldquo;Plan ahead&rdquo; prompts. Nitrogen after a cut is the time-critical one.
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Nitrogen due after cut</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Days after a cut before N shows as due. 0 = same day.</div>
              </div>
              <input type="number" min="0" max="30" step="1" name="timing_n_due" className="input" style={{ width: 70, textAlign: 'right' }} defaultValue={s.timingDefaults.nDueAfterCutDays} />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>days</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Nitrogen overdue after cut</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Days after a cut before N is flagged overdue (amber).</div>
              </div>
              <input type="number" min="1" max="60" step="1" name="timing_n_overdue" className="input" style={{ width: 70, textAlign: 'right' }} defaultValue={s.timingDefaults.nOverdueAfterCutDays} />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>days</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Grazing dressing interval</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Days between topping dressings on grazing ground.</div>
              </div>
              <input type="number" min="7" max="120" step="1" name="timing_grazing_interval" className="input" style={{ width: 70, textAlign: 'right' }} defaultValue={s.timingDefaults.grazingDressingIntervalDays} />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>days</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Planning lead time</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>How many days ahead a dressing shows in &ldquo;Plan ahead&rdquo;.</div>
              </div>
              <input type="number" min="1" max="30" step="1" name="timing_lead" className="input" style={{ width: 70, textAlign: 'right' }} defaultValue={s.timingDefaults.planLeadTimeDays} />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>days</span>
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
        {/* Tools section */}
        <div style={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.06em', color: 'var(--muted)',
          marginBottom: 8, paddingLeft: 2,
        }}>
          Tools
        </div>
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
              Add or remove your own products on top of the built-in catalogue
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
        <Link
          href="/settings/grass-systems"
          className="card"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: 14, marginBottom: 14, textDecoration: 'none', color: 'inherit',
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Grass systems</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              Library of sward types (PRG, clover, herbal, IRG…) and custom systems
            </div>
          </div>
          <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
        </Link>
        <Link
          href="/settings/agronomy"
          className="card"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: 14, marginBottom: 14, textDecoration: 'none', color: 'inherit',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <FlaskConical size={18} style={{ color: 'var(--amber)' }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Agronomy <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· advanced</span></div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                P/K tables, offtakes, targets &amp; yields. Agronomist only.
              </div>
            </div>
          </div>
          <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
        </Link>
        <ResetDataSection />
        <div style={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.06em', color: 'var(--muted)',
          marginBottom: 8, marginTop: 4, paddingLeft: 2,
        }}>
          Account &amp; data
        </div>
        <ExportDataSection />
        <DeleteAccountSection isAdmin staffCount={staffCount} farmName={s.farmName ?? null} />
        <LegalLinksSection />
        <form action={signOut}>
          <button type="submit" className="btn-ghost" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <LogOut size={16} /> Sign out
          </button>
        </form>
      </div>
      </>
      )}
    </div>
  );
}
