import { Header } from '@/components/Header';
import { ReportRow } from '@/components/ReportRow';
import { loadSettings } from '@/lib/data';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const REPORTS = [
  { key: 'full', title: 'Full inspection pack', sub: 'Everything below in one document — for Red Tractor and farm assurance' },
  { key: 'organic', title: 'Organic manures report', sub: 'Slurry and FYM records with volume, tonnage and N·P·K totals' },
  { key: 'fertiliser', title: 'Fertiliser report', sub: 'Bag fertiliser records with product tonnage and N·P·K totals' },
  { key: 'lime', title: 'Lime report', sub: 'Lime applications with total tonnage and area' },
  { key: 'spray', title: 'Spray report', sub: 'Spray records with product litres, weather and area treated' },
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
          <ReportRow
            key={r.key}
            url={`/api/reports/inspection?report=${r.key}`}
            title={r.title}
            sub={r.sub}
            filename={`swardly-${r.key}-report.pdf`}
          />
        ))}
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
          Each PDF covers the current season (1 Oct – 30 Sep). <strong>Open</strong> shows it in a new tab; <strong>Share</strong> sends it straight to email, WhatsApp or your Files app.
        </div>
      </div>
    </div>
  );
}
