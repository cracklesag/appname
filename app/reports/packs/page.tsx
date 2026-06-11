import { Header } from '@/components/Header';
import { FileDown } from 'lucide-react';
import { loadSettings } from '@/lib/data';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const REPORTS = [
  { key: 'full', title: 'Full inspection pack', sub: 'Everything below in one document — for Red Tractor and farm assurance' },
  { key: 'organic', title: 'Organic manures report', sub: 'Slurry and FYM records with volume, tonnage and N·P·K totals' },
  { key: 'fertiliser', title: 'Fertiliser report', sub: 'Bag fertiliser records with product tonnage and N·P·K totals' },
  { key: 'lime', title: 'Lime report', sub: 'Lime applications with total tonnage and area' },
  { key: 'spray', title: 'Spray report', sub: 'Spray records with product litres and area treated' },
  { key: 'soil', title: 'Soil analysis report', sub: 'pH and P/K/Mg indices by field, with resample flags' },
];

export default async function ReportPacksPage() {
  const settings = await loadSettings();
  if (settings.accountType === 'contractor') redirect('/jobs');

  return (
    <div>
      <Header tone="forest" title="Inspection reports" subtitle="Season PDFs with totals" backHref="/settings" />
      <div style={{ padding: 16 }}>
        {REPORTS.map((r) => (
          <a
            key={r.key}
            href={`/api/reports/inspection?report=${r.key}`}
            className="card"
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, marginBottom: 10, textDecoration: 'none', color: 'inherit' }}
          >
            <FileDown size={19} style={{ color: 'var(--forest)', flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink)' }}>{r.title}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, lineHeight: 1.4 }}>{r.sub}</div>
            </div>
          </a>
        ))}
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
          Each PDF covers the current season (1 Oct – 30 Sep). Downloads land in your phone&apos;s Files app or browser downloads.
        </div>
      </div>
    </div>
  );
}
