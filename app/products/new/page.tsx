import { Header } from '@/components/Header';
import { CustomProductForm } from '@/components/CustomProductForm';

export const dynamic = 'force-dynamic';

export default function NewProductPage({
  searchParams,
}: {
  searchParams: { return?: string };
}) {
  // `return` is a relative path the user came from (e.g. /fields/abc/log).
  // We only accept relative paths to prevent open redirects.
  const raw = searchParams.return ?? '/products';
  const returnTo = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/products';

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="Add custom product" backHref={returnTo} />
      <CustomProductForm returnTo={returnTo} />
    </div>
  );
}
