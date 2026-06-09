import { redirect } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { loadSprayProducts, loadSprayPurchases, loadSprayRecords, loadSettings } from '@/lib/data';
import { getFarmContext } from '@/lib/farm';
import { updateSprayProduct, deleteSprayProduct, addSprayPurchase, deleteSprayPurchase } from '@/lib/actions';
import { computeSprayStock } from '@/lib/spray';
import { fmtDate } from '@/lib/rules';

export const dynamic = 'force-dynamic';

export default async function SprayProductPage({ params }: { params: { id: string } }) {
  const [products, purchases, records, settings] = await Promise.all([
    loadSprayProducts(), loadSprayPurchases(), loadSprayRecords(), loadSettings(),
  ]);
  if (!settings.onboarded) redirect('/welcome');
  const product = products.find((p) => p.id === params.id);
  if (!product) redirect('/spray/stock');
  const ctx = await getFarmContext();
  const isAdmin = !!ctx?.isAdmin;

  const stock = computeSprayStock(products, purchases, records).get(product.id) ?? { purchasedL: 0, usedL: 0, stockL: 0 };
  const myPurchases = purchases.filter((pu) => pu.product_id === product.id);
  const today = new Date().toISOString().slice(0, 10);
  const fmtL = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toString() : n.toFixed(1));

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title={product.name} subtitle="Spray product" backHref="/spray/stock" />
      <div style={{ padding: 16 }}>
        {/* Stock summary */}
        <div className="card" style={{ padding: 16, marginBottom: 14, display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: stock.stockL < 0 ? 'var(--clay, #b06a37)' : 'var(--forest-dark)' }}>{fmtL(stock.stockL)}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>L in stock</div>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{fmtL(stock.purchasedL)}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>L bought</div>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{fmtL(stock.usedL)}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>L used</div>
          </div>
        </div>

        {/* Edit product */}
        {isAdmin && (
          <form action={updateSprayProduct} className="card" style={{ padding: 14, marginBottom: 14 }}>
            <input type="hidden" name="id" value={product.id} />
            <div className="label" style={{ marginBottom: 8 }}>Product details</div>
            <input type="text" name="name" className="input" defaultValue={product.name} required maxLength={120} style={{ marginBottom: 10 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <input type="number" name="default_l_per_ha" className="input" inputMode="decimal" step="any" min="0" defaultValue={product.default_l_per_ha ?? undefined} placeholder="Typical rate" style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: 'var(--muted)', width: 90 }}>L / ha</span>
            </div>
            <input type="text" name="notes" className="input" defaultValue={product.notes ?? ''} placeholder="Notes (optional)" maxLength={240} style={{ marginBottom: 10 }} />
            <button type="submit" className="btn-primary" style={{ width: '100%' }}>Save changes</button>
          </form>
        )}

        {/* Add purchase */}
        {isAdmin && (
          <form action={addSprayPurchase} className="card" style={{ padding: 14, marginBottom: 14 }}>
            <input type="hidden" name="product_id" value={product.id} />
            <div className="label" style={{ marginBottom: 8 }}>Log a purchase</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input type="date" name="purchase_date" className="input" defaultValue={today} max={today} required style={{ flex: 1 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                <input type="number" name="litres" className="input" inputMode="decimal" step="any" min="0" placeholder="litres" required style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>L</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>£</span>
                <input type="number" name="unit_cost" className="input" inputMode="decimal" step="any" min="0" placeholder="per L (optional)" style={{ flex: 1 }} />
              </div>
              <input type="text" name="supplier" className="input" placeholder="Supplier (optional)" maxLength={120} style={{ flex: 1 }} />
            </div>
            <button type="submit" className="btn-primary" style={{ width: '100%' }}>Add purchase</button>
          </form>
        )}

        {/* Purchase history */}
        <div className="label" style={{ marginBottom: 8 }}>Purchase history</div>
        {myPurchases.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)', padding: '4px 0 12px' }}>No purchases logged yet.</div>
        ) : (
          myPurchases.map((pu) => (
            <div key={pu.id} className="card" style={{ padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{fmtL(pu.litres)} L · {fmtDate(pu.purchase_date)}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {pu.unit_cost != null ? `£${pu.unit_cost}/L${pu.litres ? ` · £${(pu.unit_cost * pu.litres).toFixed(0)} total` : ''}` : ''}
                  {pu.unit_cost != null && pu.supplier ? ' · ' : ''}
                  {pu.supplier ?? ''}
                </div>
              </div>
              {isAdmin && (
                <form action={deleteSprayPurchase}>
                  <input type="hidden" name="id" value={pu.id} />
                  <input type="hidden" name="product_id" value={product.id} />
                  <button type="submit" aria-label="Delete purchase" style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 4 }}><Trash2 size={15} /></button>
                </form>
              )}
            </div>
          ))
        )}

        {/* Delete product */}
        {isAdmin && (
          <form action={deleteSprayProduct} style={{ marginTop: 16 }}>
            <input type="hidden" name="id" value={product.id} />
            <button type="submit" className="btn-ghost" style={{ width: '100%', color: 'var(--clay, #b06a37)' }}>Delete product</button>
          </form>
        )}
      </div>
    </div>
  );
}
