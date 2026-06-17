import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ClipboardList, ChevronRight, Sprout } from 'lucide-react';
import { Header } from '@/components/Header';
import {
  loadFields,
  loadAllApplications,
  loadAllProducts,
  loadAllocationTypes,
  loadSettings,
  loadCropAllocations,
} from '@/lib/data';
import { getSeasonStart, getSeasonLabel } from '@/lib/rules';
import { activeCropFieldIds } from '@/lib/grouping';

export const dynamic = 'force-dynamic';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export default async function LowInputReviewPage({
  searchParams,
}: {
  searchParams: { from?: string };
}) {
  const settings = await loadSettings();
  if (!settings.onboarded) redirect('/welcome');

  const [fields, applications, products, allocationTypes, cropAllocations] = await Promise.all([
    loadFields(),
    loadAllApplications(),
    loadAllProducts(),
    loadAllocationTypes(),
    loadCropAllocations(),
  ]);

  const seasonStart = getSeasonStart();
  const productById = new Map(products.map((p) => [p.id, p]));
  const typeLabelById = new Map(allocationTypes.map((t) => [t.id, t.label]));
  const reviewTypeIds = new Set(
    allocationTypes.filter((t) => t.dressing_rhythm === 'none').map((t) => t.id),
  );
  const activeCropIds = activeCropFieldIds(cropAllocations);

  const hasN = (productId: number): boolean => {
    const p = productById.get(productId);
    if (!p) return false;
    return ((p.n_pct ?? 0) || (p.n_kg_per_m3 ?? 0) || (p.n_kg_per_t ?? 0)) > 0;
  };

  type Row = {
    fieldId: string;
    fieldName: string;
    typeLabel: string;
    lastDressing: string | null;
    apps: { date: string; label: string; partial: boolean; n: boolean }[];
  };

  const rows: Row[] = fields
    .filter((f) => f.allocation_type_id != null && reviewTypeIds.has(f.allocation_type_id) && !activeCropIds.has(f.id))
    .map((f) => {
      const apps = applications
        .filter((a) => a.field_id === f.id && a.date_applied >= seasonStart)
        .sort((a, b) => b.date_applied.localeCompare(a.date_applied))
        .map((a) => {
          const p = productById.get(a.product_id);
          const name = p?.name ?? 'Application';
          return {
            date: a.date_applied,
            label: `${name} · ${a.rate_value} ${a.rate_unit}`,
            partial: a.coverage === 'partial' && a.reconciled_at == null,
            n: hasN(a.product_id),
          };
        });
      const lastDressing = apps.find((a) => a.n)?.date ?? null;
      return {
        fieldId: f.id,
        fieldName: f.name,
        typeLabel: f.allocation_type_id ? (typeLabelById.get(f.allocation_type_id) ?? 'Low input') : 'Low input',
        lastDressing,
        apps,
      };
    })
    // Longest since a dressing first (no dressing this season floats to the top).
    .sort((a, b) => {
      if (a.lastDressing === b.lastDressing) return a.fieldName.localeCompare(b.fieldName);
      if (a.lastDressing == null) return -1;
      if (b.lastDressing == null) return 1;
      return a.lastDressing.localeCompare(b.lastDressing);
    });

  const lbl = { fontSize: 11, color: 'var(--muted)', fontWeight: 700 as const, letterSpacing: '0.02em' };

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header tone="forest" title="Low input review" subtitle={`${getSeasonLabel()} · no automatic cadence`} backHref={searchParams.from || '/'} />

      <div style={{ padding: '14px 16px 0' }}>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
          These fields aren&apos;t on a recurring dressing cadence — they get an early-season input then a manual call.
          Here&apos;s what each has had this season and when, so you can decide whether anything&apos;s due.
        </p>

        {rows.length === 0 ? (
          <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: 18, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            No low-input fields yet. Set a field&apos;s <strong>Type</strong> to Low input — or set any type&apos;s
            dressing rhythm to <strong>Review only</strong> in Settings — and it&apos;ll appear here.
          </div>
        ) : (
          <>
            {rows.map((r) => (
              <div key={r.fieldId} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '13px 14px', marginBottom: 10 }}>
                <Link
                  href={`/fields/${r.fieldId}?from=/reports/low-input`}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', textDecoration: 'none', color: 'inherit', gap: 10 }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{r.fieldName}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>{r.typeLabel}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ ...lbl, fontWeight: 400 }}>Last dressing</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: r.lastDressing ? 'var(--text)' : 'var(--brand-amber, #b97f1d)' }}>
                        {r.lastDressing ? fmtDate(r.lastDressing) : 'none this season'}
                      </div>
                    </div>
                    <ChevronRight size={16} style={{ color: 'var(--muted)' }} />
                  </div>
                </Link>

                {r.apps.length > 0 && (
                  <div style={{ marginTop: 11, borderTop: '1px dashed var(--line)', paddingTop: 10 }}>
                    <div style={{ ...lbl, marginBottom: 6 }}>THIS SEASON</div>
                    {r.apps.map((a, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '3px 0', fontSize: 13 }}>
                        <span style={{ color: 'var(--text)', minWidth: 0 }}>
                          {a.label}
                          {a.partial && <span style={{ fontSize: 10.5, color: 'var(--muted)', marginLeft: 6 }}>(part field)</span>}
                        </span>
                        <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtDate(a.date)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <Link
              href="/jobs/new?from=/reports/low-input"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'var(--forest-dark, #2f5d3a)', color: 'var(--brand-cream, #efe7d6)', borderRadius: 10, padding: '13px 14px', marginTop: 6, textDecoration: 'none', fontWeight: 700, fontSize: 14 }}
            >
              <ClipboardList size={17} /> Build a job sheet from this
            </Link>
            <p style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
              <Sprout size={12} /> Decide what (if anything) these fields need, then raise a sheet for yourself or a contractor.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
