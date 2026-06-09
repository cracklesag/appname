import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { loadSettings } from '@/lib/data';
import { getFarmContext } from '@/lib/farm';
import { saveSprayerSettings } from '@/lib/actions';
import { readSprayerSettings } from '@/lib/spray';

export const dynamic = 'force-dynamic';

export default async function SprayerSettingsPage() {
  const settings = await loadSettings();
  if (!settings.onboarded) redirect('/welcome');
  const ctx = await getFarmContext();
  const isAdmin = !!ctx?.isAdmin;
  const s = readSprayerSettings(settings);

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="Sprayer settings" subtitle="Used by the spray calculator" backHref="/spray" />
      <form action={saveSprayerSettings} style={{ padding: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5, marginBottom: 16 }}>
          The calculator uses these to work out your application volume (litres per hectare):
          total output × 600 ÷ (speed × width).
        </div>

        <div style={{ marginBottom: 16 }}>
          <div className="label">Boom width</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="number" name="width_m" className="input" inputMode="decimal" step="any" min="0" defaultValue={s.widthM ?? undefined} placeholder="e.g. 12" style={{ flex: 1 }} />
            <span style={{ fontSize: 13, color: 'var(--muted)', width: 40 }}>m</span>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div className="label">Total output</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="number" name="total_flow_l_min" className="input" inputMode="decimal" step="any" min="0" defaultValue={s.totalFlowLMin ?? undefined} placeholder="e.g. 33" style={{ flex: 1 }} />
            <span style={{ fontSize: 13, color: 'var(--muted)', width: 56 }}>L/min</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, lineHeight: 1.45 }}>
            All nozzles together at your working pressure. If you only know the per-nozzle figure, multiply it by the number of nozzles.
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div className="label">Tank size <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--muted)' }}>· optional</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="number" name="tank_l" className="input" inputMode="decimal" step="any" min="0" defaultValue={s.tankLitres ?? undefined} placeholder="e.g. 1000" style={{ flex: 1 }} />
            <span style={{ fontSize: 13, color: 'var(--muted)', width: 56 }}>L</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>Lets the calculator split a field into tank loads. Leave blank if you&apos;d rather just see whole-field totals.</div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div className="label">Usual forward speed</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="number" name="default_speed_kmh" className="input" inputMode="decimal" step="any" min="0" defaultValue={s.defaultSpeedKmh ?? undefined} placeholder="e.g. 10" style={{ flex: 1 }} />
            <span style={{ fontSize: 13, color: 'var(--muted)', width: 40 }}>km/h</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>Pre-fills the calculator; you can change it per job.</div>
        </div>

        <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={!isAdmin}>Save sprayer settings</button>
        {!isAdmin && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, textAlign: 'center' }}>Only a farm admin can change these.</div>}
      </form>
    </div>
  );
}
