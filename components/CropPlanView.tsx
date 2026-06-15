import { CropPlan } from '@/lib/cropplan';
import { EVIDENCE_LABEL } from '@/lib/crops';
import { AlertTriangle } from 'lucide-react';

function Badge({ children, bg, color }: { children: React.ReactNode; bg: string; color: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: bg, color }}>
      {children}
    </span>
  );
}

function Stat({ label, value, unit, sub, accent }: { label: string; value: string; unit?: string; sub?: string; accent?: boolean }) {
  return (
    <div style={{ minWidth: 92 }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div className="nutrient-num" style={{ fontSize: 18, fontWeight: 800, color: accent ? 'var(--forest-dark)' : 'var(--ink)' }}>
        {value}{unit && <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--muted)' }}> {unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--forest-dark)', marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

/**
 * Renders a field's crop plan. Pure presentational — the heavy lifting is in
 * lib/cropplan.ts:buildCropPlan.
 */
export function CropPlanView({ plan, planned }: { plan: CropPlan; planned?: boolean }) {
  return (
    <div className="card" style={{ padding: 16, marginBottom: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink)' }}>{plan.cropLabel}</div>
            {planned && <Badge bg="#EFEBE0" color="#6B5D34">Planned</Badge>}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>
            Season {plan.season} · {plan.areaValue} {plan.areaUnit} · expected {plan.yieldT} {plan.yieldUnit}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <Badge bg="#EFEBE0" color="#6B5D34">{EVIDENCE_LABEL[plan.evidence]}</Badge>
          <div style={{ display: 'flex', gap: 4 }}>
            {plan.mg && <Badge bg="#E7EEF6" color="#2C5A86">Mg</Badge>}
            {plan.na && <Badge bg="#F1E7F0" color="#7A3B72">Na</Badge>}
            {plan.sulphur && <Badge bg="#FBF1DE" color="#8A6D1E">S</Badge>}
          </div>
        </div>
      </div>

      {/* Warnings first — clubroot / pH below target */}
      {(plan.clubrootWarning || plan.phLow) && (
        <div style={{ background: 'var(--amber-soft)', border: '1px solid var(--amber)', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
          {plan.clubrootWarning && (
            <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 11.5, color: '#7a5b12', lineHeight: 1.45 }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{plan.clubrootWarning}</span>
            </div>
          )}
          {plan.phLow && (
            <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 11.5, color: '#7a5b12', lineHeight: 1.45, marginTop: plan.clubrootWarning ? 5 : 0 }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Soil pH {plan.ph?.toFixed(1)} is below the {plan.targetPh.toFixed(1)} target for this crop — lime to lift it.</span>
            </div>
          )}
        </div>
      )}

      {/* To-apply headline numbers */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '10px 0', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
        <Stat label="N to apply" value={`${plan.nToApply}`} unit="kg/ha" sub={`target ${plan.nTarget}${plan.nIsCeiling ? ' (max)' : ''} · applied ${plan.appliedN}`} accent />
        <Stat label="P₂O₅ to apply" value={`${plan.p2o5ToApply}`} unit="kg/ha" sub={`target ${plan.p2o5Target} · Index ${plan.pIndex}`} accent />
        <Stat label="K₂O to apply" value={`${plan.k2oToApply}`} unit="kg/ha" sub={`target ${plan.k2oTarget} · Index ${plan.kIndex}`} accent />
      </div>
      {!plan.sampled && (
        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 8, lineHeight: 1.45 }}>
          No current soil index — P/K assume target Index 2. Sample to refine.
        </div>
      )}

      {/* Nitrogen plan */}
      <Section title="Nitrogen">
        <div style={{ fontSize: 12, color: 'var(--ink-soft, #444)', lineHeight: 1.5, marginBottom: 8 }}>{plan.totalNNote}</div>
        {plan.nStages.map((s, i) => (
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

      {/* Phosphate & potash basis */}
      <Section title="Phosphate & potash">
        <div style={{ fontSize: 12, color: 'var(--ink-soft, #444)', lineHeight: 1.5 }}>{plan.pkBasis}</div>
      </Section>

      {/* Other advisories (Mg / Na / S / micros / K-lift) — the notes the
          warnings block didn't already cover. */}
      {plan.notes.filter((n) => !n.toLowerCase().includes('clubroot') && !n.toLowerCase().startsWith('soil ph')).length > 0 && (
        <Section title="Also worth noting">
          {plan.notes
            .filter((n) => !n.toLowerCase().includes('clubroot') && !n.toLowerCase().startsWith('soil ph'))
            .map((n, i) => (
              <div key={i} style={{ fontSize: 11.5, color: 'var(--ink-soft, #444)', lineHeight: 1.5, marginBottom: 5, display: 'flex', gap: 7 }}>
                <span style={{ color: 'var(--muted)', flexShrink: 0 }}>•</span><span>{n}</span>
              </div>
            ))}
        </Section>
      )}

      <div style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.5, marginTop: 12 }}>
        {plan.sources} · An estimate to plan from, worked from this field&apos;s own soil and logged organic — not a substitute for a current soil report.
      </div>
    </div>
  );
}
