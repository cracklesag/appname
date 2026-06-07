import Link from 'next/link';
import { Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { ProductPill } from '@/components/ProductPill';
import { Product } from '@/lib/types';
import { DeleteProductButton } from '@/components/DeleteProductButton';
import { seedStarterProducts } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: { return?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const returnTo = searchParams.return || '/settings';

  // RLS already restricts what the user can see, but we filter explicitly
  // to show ONLY their custom rows on this management screen.
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('user_id', user.id)
    .order('id', { ascending: false });
  const products = (error || !data ? [] : data) as Product[];

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header
        title="Custom products"
        subtitle="Your own products"
        backHref={returnTo}
        right={
          <Link
            href={`/products/new?return=${encodeURIComponent(returnTo)}`}
            className="btn-primary"
            style={{ padding: '8px 12px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
          >
            <Plus size={14} /> New
          </Link>
        }
      />
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
          Products you've added on top of the built-in catalogue. These appear in the picker when logging an application.
        </div>

        {products.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.45, marginBottom: 12 }}>
            Tip: slurry and FYM values are starting defaults. To match your own analysis, add your slurry from your sheet and remove the default if it is not needed.
          </div>
        )}

        {products.length === 0 ? (
          <div className="card" style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: 'var(--ink-soft)', marginBottom: 12 }}>
              No custom products yet. Add the common UK set to get started, then edit to match what you buy.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <form action={seedStarterProducts}>
                <button type="submit" className="btn-primary" style={{ padding: '10px 14px', fontSize: 13, cursor: 'pointer', border: 'none' }}>
                  Add common products
                </button>
              </form>
              <Link
                href="/products/new"
                style={{ padding: '10px 14px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--ink-soft)', fontWeight: 700 }}
              >
                <Plus size={14} /> Add my own
              </Link>
            </div>
          </div>
        ) : (
          products.map((p) => <ProductRow key={p.id} product={p} />)
        )}
      </div>
    </div>
  );
}

function ProductRow({ product }: { product: Product }) {
  // Build a one-line summary of the nutrient values for quick scanning.
  let summary = '';
  if (product.type === 'bag_fert') {
    const parts: string[] = [];
    if (product.n_pct)    parts.push(`${product.n_pct} N`);
    if (product.p2o5_pct) parts.push(`${product.p2o5_pct} P`);
    if (product.k2o_pct)  parts.push(`${product.k2o_pct} K`);
    if (product.s_pct)    parts.push(`${product.s_pct} SO₃`);
    summary = parts.join(' · ') + (parts.length ? ' (%)' : '');
  } else if (product.type === 'slurry') {
    const parts: string[] = [];
    if (product.n_kg_per_m3)    parts.push(`${product.n_kg_per_m3} N`);
    if (product.p2o5_kg_per_m3) parts.push(`${product.p2o5_kg_per_m3} P`);
    if (product.k2o_kg_per_m3)  parts.push(`${product.k2o_kg_per_m3} K`);
    summary = parts.join(' · ') + (parts.length ? ' (kg/m³)' : '');
  } else if (product.type === 'solid_manure') {
    const parts: string[] = [];
    if (product.n_kg_per_t)    parts.push(`${product.n_kg_per_t} N`);
    if (product.p2o5_kg_per_t) parts.push(`${product.p2o5_kg_per_t} P`);
    if (product.k2o_kg_per_t)  parts.push(`${product.k2o_kg_per_t} K`);
    summary = parts.join(' · ') + (parts.length ? ' (kg/t)' : '');
  } else if (product.type === 'lime') {
    summary = 'pH amendment';
  }
  if (product.dm_pct != null) {
    summary += summary ? ` · ${product.dm_pct}% DM` : `${product.dm_pct}% DM`;
  }

  return (
    <div className="card" style={{ padding: 12, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ marginBottom: 4 }}><ProductPill product={product} /></div>
          {summary && (
            <div className="nutrient-num" style={{ fontSize: 12, color: 'var(--muted)' }}>{summary}</div>
          )}
        </div>
        <DeleteProductButton productId={product.id} />
      </div>
    </div>
  );
}
