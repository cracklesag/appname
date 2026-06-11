import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ClipboardList, BarChart3, ChevronRight } from 'lucide-react';
import { loadFields, loadSettings, loadPlateReadings } from '@/lib/data';
import { GrazingMeasureCard } from '@/components/GrazingMeasureCard';

export const dynamic = 'force-dynamic';

export default async function GrazingHubPage() {
  const settings = await loadSettings();
  if (!settings.onboarded) redirect('/welcome');

  const [fields, readings] = await Promise.all([loadFields(), loadPlateReadings()]);
  const fieldOpts = fields
    .filter((f) => !f.needs_setup)
    .map((f) => ({ id: f.id, name: f.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Latest cover reading per field, for the grazing form to derive grass removed.
  const latestCoverByField: Record<string, { cover: number; date: string }> = {};
  for (const r of readings) {
    const cur = latestCoverByField[r.field_id];
    if (!cur || r.reading_date > cur.date) {
      latestCoverByField[r.field_id] = { cover: r.cover_kg_dm_ha, date: r.reading_date };
    }
  }

  const todayISO = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ paddingBottom: 60 }}>
      <div style={{ background: 'var(--forest-dark)', color: 'var(--brand-cream, #efe7d6)', padding: '18px 16px 20px' }}>
        <Link href="/" className="hero-back" style={{ color: 'rgba(239,231,214,0.85)' }}>
          <ArrowLeft size={15} /> Home
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 3px' }}>Grazing</h1>
        <p style={{ fontSize: 12.5, color: 'rgba(239,231,214,0.8)', margin: 0 }}>
          Rotation, grass measurement and field history
        </p>
      </div>

      <div style={{ padding: '14px 16px' }}>
        <Link href="/reports/grazing?from=/grazing" className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, textDecoration: 'none', color: 'inherit' }}>
          <ClipboardList size={20} style={{ color: 'var(--forest)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Grazing rotation</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Which paddocks are due, in rotation order</div>
          </div>
          <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
        </Link>

        <Link href="/reports/grazing-history?from=/grazing" className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, marginBottom: 18, textDecoration: 'none', color: 'inherit' }}>
          <BarChart3 size={20} style={{ color: 'var(--forest)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Field history &amp; performance</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>N applied &amp; grass grown, by field or block</div>
          </div>
          <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
        </Link>

        {/* Measuring & logging */}
        <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', margin: '8px 0 10px' }}>
          Measuring
        </h2>
        <GrazingMeasureCard fields={fieldOpts} todayISO={todayISO} latestCoverByField={latestCoverByField} />
      </div>
    </div>
  );
}
