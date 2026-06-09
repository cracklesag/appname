import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, FileUp, ChevronRight, ClipboardList, ClipboardCheck, Repeat, Mountain, Wheat, Map as MapIcon, Sparkles, SprayCan } from 'lucide-react';
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
import { loadMapSettings } from '@/lib/map-data';
import { SetupChecklist } from '@/components/SetupChecklist';

export const dynamic = 'force-dynamic';

export default async function HomePage({ searchParams }: { searchParams: { setup?: string } }) {
  const settings = await loadSettings();
  if (!settings.onboarded) redirect('/welcome');
  if (settings.accountType === 'contractor') redirect('/jobs');

  const [fields, products, applications, cuts] = await Promise.all([
    loadFields(),
    loadAllProducts(),
    loadAllApplications(),
    loadAllCuts(),
  ]);

  const farmCtx = await getFarmContext();
  const isAdmin = farmCtx?.isAdmin ?? true;

  const mapSettings = await loadMapSettings();
  const fieldsWithSoil = fields.filter(
    (f) => f.ph != null || f.p_idx != null || f.k_idx != null || f.mg_idx != null,
  ).length;
  const setupComplete = fields.length > 0 && fieldsWithSoil > 0 && products.length > 0;
  const forcedSetup = searchParams?.setup === '1';
  const showSetup = isAdmin && (!setupComplete || forcedSetup);

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
        {showSetup && (
          <SetupChecklist
            onboarded={settings.onboarded}
            farmName={settings.farmName ?? null}
            unitsLabel={settings.unitSystem === 'acres' ? 'Acres' : 'Hectares'}
            hasFields={hasFields}
            fieldsTotal={fields.length}
            fieldsWithSoil={fieldsWithSoil}
            productCount={products.length}
            sbi={mapSettings?.sbi ?? null}
            licenceAccepted={!!mapSettings?.os_licence_accepted_at}
            defaultOpen={forcedSetup}
          />
        )}

        {hasFields && (
          <>
            {/* Log action — primary task */}
            <div style={{ marginBottom: 14 }}>
              <LogActionButton />
            </div>

            {/* Ask Swardly — in-app assistant (available to staff and admins) */}
            <Link href="/assistant" style={{ display: 'block', background: 'var(--forest-soft)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 13px', marginBottom: 14, textDecoration: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--forest)', color: 'var(--paper)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Sparkles size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--forest-dark)' }}>Ask Swardly</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.4 }}>Your fields, soil and how the app works — just ask.</div>
                </div>
                <ChevronRight size={16} style={{ color: 'var(--stone)', flexShrink: 0 }} />
              </div>
            </Link>

            {/* The Plan — consolidated "what to apply" (replaces P&K status,
                fertiliser plan, spread report and field snapshot). */}
            <Link href="/plan?from=/" style={{ display: 'block', background: 'var(--forest)', border: '1px solid var(--forest)', borderRadius: 10, padding: '14px 15px', marginBottom: 9, textDecoration: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <ClipboardList size={22} style={{ color: 'var(--brand-cream)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--brand-cream)' }}>Plan</div>
                  <div style={{ fontSize: 12, color: 'rgba(239,231,214,0.85)', lineHeight: 1.4 }}>What to spread on every field — slurry first, then granular.</div>
                  {pkReviewCount > 0 && (
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#FAC775', marginTop: 4 }}>
                      {pkReviewCount} field{pkReviewCount === 1 ? '' : 's'} below target for P/K
                    </div>
                  )}
                </div>
                <ChevronRight size={16} style={{ color: 'rgba(239,231,214,0.85)', flexShrink: 0 }} />
              </div>
            </Link>

            {/* Quick-access cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
              <Link href="/grazing" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--ink)' }}>
                <Repeat size={21} style={{ color: 'var(--slurry, #6a90b5)' }} />
                <span style={{ fontSize: 12, fontWeight: 500, textAlign: 'center' }}>Grazing</span>
              </Link>
              <Link href="/reports/grazing?from=/" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--ink)' }}>
                <ClipboardList size={21} style={{ color: 'var(--forest)' }} />
                <span style={{ fontSize: 12, fontWeight: 500, textAlign: 'center' }}>Grazing top-ups</span>
              </Link>
              <Link href="/reports/lime?from=/" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--ink)' }}>
                <Mountain size={21} style={{ color: '#8a7a4a' }} />
                <span style={{ fontSize: 12, fontWeight: 500, textAlign: 'center' }}>Lime status</span>
              </Link>
              <Link href="/crops?from=/" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--ink)' }}>
                <Wheat size={21} style={{ color: '#b8902f' }} />
                <span style={{ fontSize: 12, fontWeight: 500, textAlign: 'center' }}>Crop guide</span>
              </Link>
              <Link href="/spray" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--ink)' }}>
                <SprayCan size={21} style={{ color: '#7a6cb5' }} />
                <span style={{ fontSize: 12, fontWeight: 500, textAlign: 'center' }}>Spray records</span>
              </Link>
              <Link href="/jobs?from=/" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--ink)' }}>
                <ClipboardCheck size={21} style={{ color: '#c2683a' }} />
                <span style={{ fontSize: 12, fontWeight: 500, textAlign: 'center' }}>Job sheets</span>
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
