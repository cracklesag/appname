import { Header } from '@/components/Header';
import { CustomProductForm } from '@/components/CustomProductForm';
import { loadProduct, loadProductAnalyses } from '@/lib/data';
import { getFarmContext } from '@/lib/farm';
import { deleteProductAnalysis } from '@/lib/actions';
import { redirect } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Product, ProductAnalysis } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { return?: string };
}) {
  const id = parseInt(params.id, 10);
  const raw = searchParams.return ?? '/products';
  const returnTo = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/products';

  const ctx = await getFarmContext();
  if (!ctx?.isAdmin) redirect('/products');

  const product = Number.isFinite(id) ? await loadProduct(id) : null;
  if (!product || product.user_id == null) redirect('/products');

  const analyses = await loadProductAnalyses(id);

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="Edit product" subtitle={product.name} backHref={returnTo} />
      <CustomProductForm returnTo={returnTo} mode="edit" productId={id} initial={product} />

      {product.type !== 'lime' && analyses.length > 0 && (
        <div style={{ padding: '0 16px 24px' }}>
          <div className="label" style={{ marginBottom: 8 }}>Analysis history</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.45 }}>
            Each saved change adds a dated version. Past applications are valued using the version that was effective on their date.
          </div>
          {analyses.map((a) => (
            <VersionRow key={a.id} a={a} product={product} canDelete={analyses.length > 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function fmt(n: number | null): string {
  return n == null ? '–' : String(n);
}

function summarize(a: ProductAnalysis, product: Product): string {
  if (product.type === 'bag_fert') {
    return `N ${fmt(a.n_pct)} · P₂O₅ ${fmt(a.p2o5_pct)} · K₂O ${fmt(a.k2o_pct)}${a.s_pct ? ` · SO₃ ${fmt(a.s_pct)}` : ''} (%)`;
  }
  if (product.type === 'slurry') {
    return `N ${fmt(a.n_kg_per_m3)} · P₂O₅ ${fmt(a.p2o5_kg_per_m3)} · K₂O ${fmt(a.k2o_kg_per_m3)} kg/m³${a.dm_pct ? ` · ${fmt(a.dm_pct)}% DM` : ''}`;
  }
  if (product.type === 'solid_manure') {
    return `N ${fmt(a.n_kg_per_t)} · P₂O₅ ${fmt(a.p2o5_kg_per_t)} · K₂O ${fmt(a.k2o_kg_per_t)} kg/t${a.dm_pct ? ` · ${fmt(a.dm_pct)}% DM` : ''}`;
  }
  return '';
}

function VersionRow({ a, product, canDelete }: { a: ProductAnalysis; product: Product; canDelete: boolean }) {
  const isOriginal = a.effective_from <= '2000-01-01';
  return (
    <div className="card" style={{ padding: 12, marginBottom: 8, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
          {isOriginal ? 'Original values' : `From ${a.effective_from}`}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{summarize(a, product)}</div>
      </div>
      {canDelete && (
        <form action={deleteProductAnalysis}>
          <input type="hidden" name="analysis_id" value={a.id} />
          <input type="hidden" name="product_id" value={product.id} />
          <button type="submit" aria-label="Delete this version" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, flexShrink: 0 }}>
            <Trash2 size={16} />
          </button>
        </form>
      )}
    </div>
  );
}
