import { Header } from '@/components/Header';
import { CustomProductForm } from '@/components/CustomProductForm';
import { ProductType } from '@/lib/types';

export const dynamic = 'force-dynamic';

const VALID_TYPES: ProductType[] = ['slurry', 'solid_manure', 'bag_fert', 'lime'];

export default function NewProductPage({
  searchParams,
}: {
  searchParams: { return?: string; type?: string };
}) {
  // `return` is a relative path the user came from (e.g. /fields/abc/log).
  // We only accept relative paths to prevent open redirects.
  const raw = searchParams.return ?? '/products';
  const returnTo = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/products';

  // `type` (optional) lets the caller pre-select the right product type so
  // the user lands on Bag fert when they came from the bag-fert picker, etc.
  // Validated against the four allowed values; falls back to slurry if missing
  // or unrecognised.
  const initialType: ProductType = VALID_TYPES.includes(searchParams.type as ProductType)
    ? (searchParams.type as ProductType)
    : 'slurry';

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="Add custom product" backHref={returnTo} />
      <CustomProductForm returnTo={returnTo} initialType={initialType} />
    </div>
  );
}
