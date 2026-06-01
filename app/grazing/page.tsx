import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ClipboardList, BarChart3, ChevronRight } from 'lucide-react';
import { loadFields, loadSettings } from '@/lib/data';
import { PlateReadingForm } from '@/components/PlateReadingForm';

export const dynamic = 'force-dynamic';

export default async function GrazingHubPage() {
  const settings = await loadSettings();
  if (!settings.onboarded) redirect('/welcome');

  const fields = await loadFields();
  const fieldOpts = fields
    .filter((f) => !f.needs_setup)
    .map((f) => ({ id: f.id, name: f.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const todayISO = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ paddingBottom: 60 }}>
      <div style={{ background: 'linear-gradient(135deg, #3d5b29 0%, #2c4220 100%)', color: 'var(--brand-cream, #efe7d6)', padding: '18px 16px 20px' }}>
        <Link href="/" className="hero-back" style={{ color: 'rgba(239,231,214,0.85)' }}>
          <ArrowLeft size={15} /> Home
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 3px' }}>Grazing</h1>
        <p style={{ fontSize: 12.5, color: 'rgba(239,231,214,0.8)', margin: 0 }}>
          Rotation, grass measurement and field history
        </p>
      </div>

      <div style={{ padding: '14px 16px' }}>
        {/* Quick links */}
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
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Field history</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>N applied & grass grown by field this season</div>
          </div>
          <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
        </Link>

        {/* Plate-meter logging */}
        <div className="card" style={{ padding: 14 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '0 0 3px' }}>Log a plate-meter reading</h2>
          <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
            Optional. Record a paddock’s grass cover now and then to track growth and build the field-history
            comparison. Two or more readings on a field and its growth shows up.
          </p>
          <PlateReadingForm fields={fieldOpts} todayISO={todayISO} />
        </div>
      </div>
    </div>
  );
}
