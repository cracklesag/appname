import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, FileUp, Calendar, Flame, FileText, ChevronRight, Sprout, ClipboardList, Repeat, Mountain, Wheat, Map as MapIcon } from 'lucide-react';
import { LogActionButton } from '@/components/LogActionButton';
import { HomeTiles, ComingUpEntry } from '@/components/HomeTiles';
import {
  loadAllProducts,
  loadFields,
  loadAllApplications,
  loadAllCuts,
  loadSettings,
} from '@/lib/data';
import {
  getComingUpForField,
  getSeasonLabel,
} from '@/lib/rules';
import { getFarmContext } from '@/lib/farm';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const settings = await loadSettings();
  if (!settings.onboarded) redirect('/welcome');

  const [fields, products, applications, cuts] = await Promise.all([
    loadFields(),
    loadAllProducts(),
    loadAllApplications(),
    loadAllCuts(),
  ]);

  const farmCtx = await getFarmContext();
  const isAdmin = farmCtx?.isAdmin ?? true;

  const seasonLabel = getSeasonLabel();

  // Coming-up timing prompts (pure timing — no RB209 dependency).
  const comingUp = fields
    .map((f) => {
      const fCuts = cuts.filter((c) => c.field_id === f.id);
      const fApps = applications.filter((a) => a.field_id === f.id);
      return getComingUpForField(f, fCuts, fApps, products, settings);
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  const nNow: ComingUpEntry[] = comingUp
    .filter((c) => c.kind === 'n_due' || c.kind === 'n_overdue')
    .sort((a, b) => {
      const rank = (k: string) => (k === 'n_overdue' ? 0 : 1);
      if (rank(a.kind) !== rank(b.kind)) return rank(a.kind) - rank(b.kind);
      return b.days - a.days;
    })
    .map((c) => ({ fieldId: c.fieldId, fieldName: c.fieldName, kind: c.kind, days: c.days }));

  const grazingDue: ComingUpEntry[] = comingUp
    .filter((c) => c.kind === 'grazing_due')
    .sort((a, b) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0))
    .map((c) => ({ fieldId: c.fieldId, fieldName: c.fieldName, kind: c.kind, days: c.days, daysUntil: c.daysUntil }));

  // P/K review nudge: fields whose soil P or K index is below target. A light
  // proxy for "worth reviewing" that doesn't need the full target/carryover
  // engine (which is being reworked for RB209). The real shortfall amounts
  // land with the RB209 engine + P/K-to-apply view.
  const pTarget = settings.soilTargets?.pIdx ?? 2;
  const kTarget = settings.soilTargets?.kIdx ?? 2;
  const pkReviewCount = fields.filter(
    (f) =>
      (f.p_idx != null && f.p_idx < pTarget) ||
      (f.k_idx != null && f.k_idx < kTarget),
  ).length;

  const hasFields = fields.length > 0;

  return (
    <div style={{ paddingBottom: 80 }}>
      {/* Branded hero with tappable summary tiles */}
      <div style={{ background: 'var(--forest-dark)', padding: '16px 18px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/swardly-mark-cream.png" alt="" width={30} height={22} style={{ objectFit: 'contain' }} />
            <span style={{ fontFamily: '"Fraunces", serif', fontSize: 21, fontWeight: 600, color: 'var(--brand-cream)' }}>swardly</span>
          </div>
          <div style={{ display: 'inline-flex', gap: 6 }}>
            {isAdmin && (
            <Link href="/import" aria-label="Import a document" style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(239,231,214,0.12)', color: 'var(--brand-cream)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
              <FileUp size={15} />
            </Link>
            )}
            {isAdmin && (
            <Link href="/fields/new" aria-label="Add field" style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(239,231,214,0.12)', color: 'var(--brand-cream)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
              <Plus size={16} />
            </Link>
            )}
          </div>
        </div>

        {settings.farmName && (
          <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: 'var(--brand-cream)', opacity: 0.85, letterSpacing: '0.01em' }}>
            {settings.farmName}
          </div>
        )}

        {hasFields ? (
          <div style={{ marginTop: 16 }}>
            <HomeTiles nNow={nNow} grazingDue={grazingDue} />
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'rgba(239,231,214,0.8)', marginTop: 12 }}>{seasonLabel}</div>
        )}
      </div>

      <div style={{ padding: '14px 16px' }}>
        {!hasFields && (
          <div className="card" style={{ padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 14 }}>
              No fields yet. Add your first to get started.
            </div>
            <Link href="/fields/new" className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
              <Plus size={16} /> Add field
            </Link>
          </div>
        )}

        {hasFields && (
          <>
            {/* Log action — primary task */}
            <div style={{ marginBottom: 14 }}>
              <LogActionButton />
            </div>

            {/* Plan ahead — grazing dressings + gentle P/K review nudge */}
            {(grazingDue.length > 0 || pkReviewCount > 0) && (
              <Link href="/reports/spreading?from=/" style={{ display: 'block', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 13px', marginBottom: 14, textDecoration: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <Calendar size={15} style={{ color: 'var(--forest)' }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Plan ahead</span>
                  </div>
                  <ChevronRight size={15} style={{ color: 'var(--stone)' }} />
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
                  {grazingDue.length > 0 && grazingDue.slice(0, 1).map((c) => (
                    <span key={c.fieldId}>{c.fieldName} grazing — dressing {(c.daysUntil ?? 0) <= 0 ? 'due now' : `in ~${c.daysUntil} days`}.{' '}</span>
                  ))}
                  {pkReviewCount > 0 && <>{pkReviewCount} field{pkReviewCount === 1 ? '' : 's'} below target for P/K.</>}
                </div>
              </Link>
            )}

            {/* Quick-access cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
              <Link href="/reports/pk?from=/" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--ink)' }}>
                <Sprout size={21} style={{ color: 'var(--forest)' }} />
                <span style={{ fontSize: 12, fontWeight: 500, textAlign: 'center' }}>P &amp; K status</span>
              </Link>
              <Link href="/reports/fert-plan?from=/" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--ink)' }}>
                <ClipboardList size={21} style={{ color: 'var(--forest)' }} />
                <span style={{ fontSize: 12, fontWeight: 500, textAlign: 'center' }}>Fertiliser plan</span>
              </Link>
              <Link href="/reports/spreading?from=/" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--ink)' }}>
                <FileText size={21} style={{ color: 'var(--forest)' }} />
                <span style={{ fontSize: 12, fontWeight: 500, textAlign: 'center' }}>Spread report</span>
              </Link>
              <Link href="/reports/snapshot?from=/" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--ink)' }}>
                <Flame size={21} style={{ color: 'var(--amber)' }} />
                <span style={{ fontSize: 12, fontWeight: 500, textAlign: 'center' }}>Field snapshot</span>
              </Link>
              <Link href="/grazing" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--ink)' }}>
                <Repeat size={21} style={{ color: 'var(--slurry, #6a90b5)' }} />
                <span style={{ fontSize: 12, fontWeight: 500, textAlign: 'center' }}>Grazing</span>
              </Link>
              <Link href="/reports/lime?from=/" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--ink)' }}>
                <Mountain size={21} style={{ color: '#8a7a4a' }} />
                <span style={{ fontSize: 12, fontWeight: 500, textAlign: 'center' }}>Lime status</span>
              </Link>
              <Link href="/crops?from=/" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--ink)' }}>
                <Wheat size={21} style={{ color: '#b8902f' }} />
                <span style={{ fontSize: 12, fontWeight: 500, textAlign: 'center' }}>Crop guide</span>
              </Link>
              <Link href="/map" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--ink)' }}>
                <MapIcon size={21} style={{ color: '#2f7d6a' }} />
                <span style={{ fontSize: 12, fontWeight: 500, textAlign: 'center' }}>Farm map</span>
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
