import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { LogApplicationForm } from '@/components/LogApplicationForm';
import { loadFields, loadAllProducts, loadSettings } from '@/lib/data';
import type { ProductType } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Top-level "Log action" application entry — batch-capable. Reached from the
 * home Log action menu (Fertiliser / Slurry / Solid manure / Lime). Sets one
 * product/rate/date/method and applies it across any number of ticked fields,
 * with optional per-field rate override. Ticking a single field is just a
 * batch of one, so this covers both single and multi entry.
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
  searchParams: { type?: string };
}) {
  const type: ProductType = (VALID_TYPES.includes(searchParams.type ?? '')
    ? searchParams.type
    : 'bag_fert') as ProductType;

  const [fields, products, settings] = await Promise.all([
    loadFields(),
    loadAllProducts(),
    loadSettings(),
  ]);

  if (fields.length === 0) {
    redirect('/fields/new');
  }

  // Reference field for the form's unit/maths defaults (any field works;
  // the actual fields applied to come from the tick-list).
  const refField = fields[0];

  return (
    <div>
      <Header title={`Log ${TYPE_LABEL[type].toLowerCase()}`} subtitle="One or many fields" backHref="/" />
      <LogApplicationForm
        field={refField}
        batchFields={fields}
        products={products}
        settings={settings}
        initialType={type}
      />
    </div>
  );
}
