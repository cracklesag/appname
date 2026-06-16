import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { loadedCropsByCategory, EVIDENCE_LABEL, CropProfile } from '@/lib/crops';
import { loadCrops } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function CropsPage({
  searchParams,
}: {
  searchParams: { from?: string };
}) {
  const crops = await loadCrops();
  const groups = loadedCropsByCategory(crops);
  const fromHref = searchParams.from || '/crops';

  return (
    <div style={{ paddingBottom: 80 }}>
      {/* Hero */}
      <div style={{ background: 'linear-gradient(135deg, #6b5b2e 0%, #4a3f1f 100%)', color: 'var(--brand-cream, #efe7d6)', padding: '18px 16px 20px' }}>
        <Link href={fromHref} className="hero-back" style={{ color: 'rgba(239,231,214,0.85)' }}>
          <ArrowLeft size={15} /> Back
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 3px' }}>Crop nutrition guide</h1>
        <p style={{ fontSize: 12.5, color: 'rgba(239,231,214,0.8)', margin: 0, lineHeight: 1.5 }}>
          Nutrient schedules for non-grass crops — yields, offtake, nitrogen timing and soil fit.
        </p>
      </div>

      <div style={{ padding: '14px 16px' }}>
        <div style={{
          background: '#F4EFE2', border: '1px solid #E4D9BD', borderRadius: 10,
          padding: '10px 12px', fontSize: 11.5, color: '#6B5D34', lineHeight: 1.5, marginBottom: 16,
        }}>
          A reference for planning non-grass crops. To put a crop on a field — with rates worked from that
          field&apos;s own soil indices and slurry — open the field and tap <strong>Crops</strong>. Your grassland
          fields and reports are unaffected.
        </div>

        {groups.map((g) => (
          <div key={g.category} style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 10, paddingLeft: 2 }}>
              {g.label}
            </div>
            {g.crops.map((c) => <CropCard key={c.id} crop={c.profile} />)}
          </div>
        ))}

        <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginTop: 4 }}>
          Figures follow published AHDB and PDA guidance, with trial data where that is thin — each crop shows how settled
          its defaults are. Phosphate and potash are offtake-replacement at Index 2; adjust up at low index,
          down (or skip) above target. Nitrogen rates are a guide — set them against your soil nitrogen supply.
          An estimate to plan from, not a substitute for a current soil report.
        </p>
      </div>
    </div>
  );
}

function Badge({ children, bg, color }: { children: React.ReactNode; bg: string; color: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: bg, color }}>
      {children}
    </span>
  );
}

function CropCard({ crop }: { crop: CropProfile }) {
  const o = crop.offtake;
  return (
    <div className="card" style={{ padding: 14, marginBottom: 10 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{crop.label}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{crop.summary}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <Badge bg="#EFEBE0" color="#6B5D34">{EVIDENCE_LABEL[crop.evidence]}</Badge>
          <div style={{ display: 'flex', gap: 4 }}>
            {crop.needsMg && <Badge bg="#E7EEF6" color="#2C5A86">Mg</Badge>}
            {crop.needsNa && <Badge bg="#F1E7F0" color="#7A3B72">Na</Badge>}
          </div>
        </div>
      </div>

      {/* Yield + offtake figures */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, padding: '9px 0', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', marginBottom: 9 }}>
        <Figure label="Yield" value={`${crop.yieldDefault}`} unit={crop.yieldUnit} sub={crop.yieldRange} />
        {o.n != null && <Figure label="N offtake" value={`${o.n}`} unit="kg/t" />}
        <Figure label="P₂O₅" value={`${o.p2o5}`} unit="kg/t" />
        <Figure label="K₂O" value={`${o.k2o}`} unit="kg/t" />
        {o.mgo != null && <Figure label="MgO" value={`${o.mgo}`} unit="kg/t" />}
        {o.na2o != null && <Figure label="Na₂O" value={`${o.na2o}`} unit="kg/t" />}
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.45 }}>
        Offtake {o.basis}
      </div>

      {/* Nitrogen plan */}
      <Section title="Nitrogen">
        <div style={{ fontSize: 12, color: 'var(--ink-soft, #444)', lineHeight: 1.5, marginBottom: 8 }}>{crop.totalN}</div>
        {crop.nStages.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
            <span style={{ flexShrink: 0, width: 7, height: 7, borderRadius: '50%', background: 'var(--forest)', marginTop: 4 }} />
            <div style={{ fontSize: 12, color: 'var(--ink)' }}>
              <span style={{ fontWeight: 700 }}>{s.label}</span>
              <span style={{ color: 'var(--muted)' }}> · {s.timing}</span>
              {s.note && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.note}</div>}
            </div>
          </div>
        ))}
      </Section>

      {/* pH / soil / manure */}
      <Section title="pH & soil">
        <KeyVal k="Target pH" v={`${crop.targetPh.toFixed(1)}${crop.phNote ? ' — ' + crop.phNote : ''}`} />
        <KeyVal k="Soil fit" v={crop.soilFit} />
        <KeyVal k="Manure" v={crop.manureFit} />
      </Section>
    </div>
  );
}

function Figure({ label, value, unit, sub }: { label: string; value: string; unit: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div className="nutrient-num" style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink)' }}>
        {value} <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--muted)' }}>{unit}</span>
      </div>
      {sub && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--forest-dark)', marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function KeyVal({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ fontSize: 12, color: 'var(--ink-soft, #444)', lineHeight: 1.5, marginBottom: 4 }}>
      <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{k}: </span>{v}
    </div>
  );
}
