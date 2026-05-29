import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { LogApplicationForm } from '@/components/LogApplicationForm';
import { loadFields, loadAllProducts, loadSettings, loadGroups, loadProductUsage } from '@/lib/data';
import type { ProductType } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Top-level "Log action" application entry — batch-capable. Reached from the
 * home Log action menu (Fertiliser / Slurry / Solid manure / Lime). Sets one
 * product/rate/date/method and applies it across any number of ticked fields,
 * with optional per-field rate override and group filtering.
 *
 * Cuts use /cuts/batch (their own flow); this route handles applications.
 */
const VALID_TYPES = ['bag_fert', 'slurry', 'solid_manure', 'lime'];

const TYPE_LABEL: Record<string, string> = {
  bag_fert: 'Fertiliser',
  slurry: 'Slurry',
  solid_manure: 'Solid manure',
  lime: 'Lime',
};

export default async function LogPage({
  searchParams,
}: {
  searchParams: { type?: string; flash?: string; count?: string };
}) {
  const type: ProductType = (VALID_TYPES.includes(searchParams.type ?? '')
    ? searchParams.type
    : 'bag_fert') as ProductType;

  const [fields, products, settings, groups, usage] = await Promise.all([
    loadFields(),
    loadAllProducts(),
    loadSettings(),
    loadGroups(),
    loadProductUsage(),
  ]);

  if (fields.length === 0) {
    redirect('/fields/new');
  }

  const refField = fields[0];

  return (
    <div style={{ paddingBottom: 80 }}>
      {/* Branded hero — matches Home and Fields for continuity */}
      <div style={{ background: 'var(--forest-dark)', padding: '14px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link href="/" aria-label="Back" style={{ color: 'var(--brand-cream)', display: 'inline-flex', marginLeft: -4 }}>
            <ArrowLeft size={22} />
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/swardly-mark-cream.png" alt="" width={26} height={19} style={{ objectFit: 'contain' }} />
            <span style={{ fontFamily: '"Fraunces", serif', fontSize: 18, fontWeight: 600, color: 'var(--brand-cream)' }}>swardly</span>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontFamily: '"Fraunces", serif', fontSize: 21, fontWeight: 600, color: 'var(--brand-cream)' }}>Log {TYPE_LABEL[type].toLowerCase()}</div>
          <div style={{ fontSize: 12, color: 'rgba(239,231,214,0.7)', marginTop: 1 }}>One or many fields</div>
        </div>
      </div>

      {searchParams.flash === 'apps_logged' && (
        <div style={{
          margin: '12px 16px 0',
          padding: '10px 12px',
          borderRadius: 8,
          background: 'var(--forest-soft, #eaf2dc)',
          color: 'var(--forest-dark, #3d5b29)',
          fontSize: 13,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <span>
            {searchParams.count
              ? `Logged on ${searchParams.count} field${searchParams.count === '1' ? '' : 's'}. Ready for the next.`
              : 'Logged. Ready for the next.'}
          </span>
          <Link href="/activity?from=/log" style={{ color: 'var(--forest-dark)', fontWeight: 700, textDecoration: 'underline', whiteSpace: 'nowrap' }}>
            View activity
          </Link>
        </div>
      )}

      <LogApplicationForm
        field={refField}
        batchFields={fields}
        groups={groups}
        products={products}
        settings={settings}
        initialType={type}
        usage={usage}
      />
    </div>
  );
}
