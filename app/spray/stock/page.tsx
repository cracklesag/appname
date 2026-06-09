import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight, Boxes } from 'lucide-react';
import { Header } from '@/components/Header';
import { loadSprayProducts, loadSprayPurchases, loadSprayRecords, loadSettings } from '@/lib/data';
import { getFarmContext } from '@/lib/farm';
import { createSprayProduct } from '@/lib/actions';
import { computeSprayStock } from '@/lib/spray';

export const dynamic = 'force-dynamic';

export default async function SprayStockPage() {
  const [products, purchases, records, settings] = await Promise.all([
    loadSprayProducts(), loadSprayPurchases(), loadSprayRecords(), loadSettings(),
  ]);
  if (!settings.onboarded) redirect('/welcome');
  const ctx = await getFarmContext();
  const isAdmin = !!ctx?.isAdmin;
  const stock = computeSprayStock(products, purchases, records);
  const fmtL = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toString() : n.toFixed(1));

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="Spray stock" subtitle="Products & current stock" backHref="/spray" />
      <div style={{ padding: 16 }}>
        {products.length === 0 ? (
          <div className="card" style={{ padding: 22, textAlign: 'center', marginBottom: 16 }}>
            <Boxes size={24} style={{ color: 'var(--muted)' }} />
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 8 }}>No spray products yet</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>Add the sprays you keep, then log purchases to track stock.</div>
          </div>
        ) : (
          products.map((p) => {
            const st = stock.get(p.id);
            return (
              <Link key={p.id} href={`/spray/stock/${p.id}`} className="card" style={{ padding: 14, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, textDecoration: 'none' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{p.name}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>
                    {p.default_l_per_ha != null ? `Typical ${p.default_l_per_ha} L/ha` : 'No typical rate set'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 17, fontWeight: 800, color: (st && st.stockL < 0) ? 'var(--clay, #b06a37)' : 'var(--forest-dark)' }}>{st ? fmtL(st.stockL) : '0'} L</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>in stock</div>
                  </div>
                  <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
                </div>
              </Link>
            );
          })
        )}

        {/* Add product */}
        {isAdmin ? (
          <form action={createSprayProduct} className="card" style={{ padding: 14, marginTop: 6 }}>
            <div className="label" style={{ marginBottom: 8 }}>Add a product</div>
            <input type="text" name="name" className="input" placeholder="Spray name (e.g. Doxstar Pro)" required maxLength={120} style={{ marginBottom: 10 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <input type="number" name="default_l_per_ha" className="input" inputMode="decimal" step="any" min="0" placeholder="Typical rate" style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: 'var(--muted)', width: 90 }}>L / ha (optional)</span>
            </div>
            <input type="text" name="notes" className="input" placeholder="Notes (optional)" maxLength={240} style={{ marginBottom: 10 }} />
            <button type="submit" className="btn-primary" style={{ width: '100%' }}>Add product</button>
          </form>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginTop: 10 }}>Only a farm admin can add products.</div>
        )}
      </div>
    </div>
  );
}
