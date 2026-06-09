import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { loadSettings } from '@/lib/data';
import { getFarmContext } from '@/lib/farm';
import { saveSprayerSettings } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function SprayerSettingsPage() {
  const settings = await loadSettings();
  if (!settings.onboarded) redirect('/welcome');
  const ctx = await getFarmContext();
  const isAdmin = !!ctx?.isAdmin;
  const s = settings.sprayer ?? { widthM: null, nozzleFlowLMin: null, nozzleCount: null, defaultSpeedKmh: null };
  const total = (s.nozzleFlowLMin ?? 0) * (s.nozzleCount ?? 0);

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="Sprayer settings" subtitle="Used by the spray calculator" backHref="/spray" />
      <form action={saveSprayerSettings} style={{ padding: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5, marginBottom: 16 }}>
          The calculator works out your application volume (litres per hectare) from these.
          Total boom output = flow per nozzle × number of nozzles.
          If you only know the whole-boom output, put it in the flow box and set nozzles to 1.
        </div>

        <div style={{ marginBottom: 14 }}>
          <div className="label">Boom width</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="number" name="width_m" className="input" inputMode="decimal" step="any" min="0" defaultValue={s.widthM ?? undefined} placeholder="e.g. 12" style={{ flex: 1 }} />
            <span style={{ fontSize: 13, color: 'var(--muted)', width: 40 }}>m</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div className="label">Flow per nozzle</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="number" name="nozzle_flow_l_min" className="input" inputMode="decimal" step="any" min="0" defaultValue={s.nozzleFlowLMin ?? undefined} placeholder="e.g. 1.0" style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>L/min</span>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="label">Number of nozzles</div>
            <input type="number" name="nozzle_count" className="input" inputMode="numeric" step="1" min="1" defaultValue={s.nozzleCount ?? undefined} placeholder="e.g. 24" />
          </div>
        </div>

        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>
          Saved total boom output: <strong>{total > 0 ? `${total % 1 === 0 ? total : total.toFixed(1)} L/min` : '—'}</strong>
        </div>

        <div style={{ marginBottom: 16 }}>
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
