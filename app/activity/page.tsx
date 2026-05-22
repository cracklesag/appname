import Link from 'next/link';
import { Droplets, Sprout, Mountain, Tractor } from 'lucide-react';
import { Header } from '@/components/Header';
import { FilterChips } from '@/components/FilterChips';
import {
  loadAllApplications,
  loadAllCuts,
  loadAllProducts,
  loadFields,
  loadSettings,
} from '@/lib/data';
import {
  displayRate,
  fmt,
  fmtDate,
  getNextCutType,
  getSeasonStart,
  methodLabel,
  NextCutType,
} from '@/lib/rules';

export const dynamic = 'force-dynamic';

type SortKey = 'date_desc' | 'date_asc' | 'field' | 'qty_desc';

type Search = {
  type?: 'all' | 'slurry' | 'bag_fert' | 'lime' | 'solid_manure';
  product?: string;
  period?: 'this_year' | 'last_12m' | 'all' | string;
  /** Filter by the field's next-planned cut type. Default 'active' excludes complete fields. */
  next?: 'active' | NextCutType;
  /** Sort key for the application list. Default date_desc (newest first). */
  sort?: SortKey;
};

export default async function ActivityPage({ searchParams }: { searchParams: Search }) {
  const type = searchParams.type || 'all';
  const productId = searchParams.product || 'all';
  const period = searchParams.period || 'this_year';
  const nextFilter = searchParams.next || 'active';
  const sortKey: SortKey = searchParams.sort || 'date_desc';

  const [applications, products, fields, cuts, settings] = await Promise.all([
    loadAllApplications(),
    loadAllProducts(),
    loadFields(),
    loadAllCuts(),
    loadSettings(),
  ]);

  const fieldById = Object.fromEntries(fields.map((f) => [f.id, f]));
  const productById = Object.fromEntries(products.map((p) => [p.id, p]));

  // Per-field next-cut-type, computed against the CURRENT season's logged cuts.
  // The activity page can show applications from prior years too, but the
  // "next cut" filter is always relative to today's state — i.e. the same
  // chip on activity matches the same chip on the home dashboard.
  const seasonStart = getSeasonStart();
  const nextCutTypeByField: Record<string, NextCutType> = {};
  fields.forEach((f) => {
    const fCuts = cuts.filter((c) => c.field_id === f.id && c.cut_date >= seasonStart);
    nextCutTypeByField[f.id] = getNextCutType(f, fCuts.length);
  });

  // Period window
  const today = new Date();
  let startDate: string, endDate: string;
  if (period === 'this_year') {
    const y = today.getFullYear();
    startDate = `${y}-01-01`;
    endDate = `${y}-12-31`;
  } else if (period === 'last_12m') {
    const d = new Date(today);
    d.setFullYear(d.getFullYear() - 1);
    startDate = d.toISOString().slice(0, 10);
    endDate = '9999-12-31';
  } else if (period === 'all') {
    startDate = '0000-01-01';
    endDate = '9999-12-31';
  } else {
    startDate = `${period}-01-01`;
    endDate = `${period}-12-31`;
  }

  // Available years from data
  const yearSet = new Set<number>();
  applications.forEach((a) => yearSet.add(new Date(a.date_applied).getFullYear()));
  const availableYears = Array.from(yearSet).sort((a, b) => b - a);

  // Filter
  const filtered = applications.filter((a) => {
    if (a.date_applied < startDate || a.date_applied > endDate) return false;
    const product = productById[a.product_id];
    if (!product) return false;
    if (type !== 'all' && product.type !== type) return false;
    if (type === 'bag_fert' && productId !== 'all' && String(a.product_id) !== productId) return false;
    // Next-cut-type filter: drop applications whose field's next-cut-type
    // doesn't match the chip. 'active' = anything not complete.
    const ncType = nextCutTypeByField[a.field_id];
    if (!ncType) return false;
    if (nextFilter === 'active') {
      if (ncType === 'complete') return false;
    } else if (ncType !== nextFilter) {
      return false;
    }
    return true;
  });

  /**
   * Total product applied, expressed in kg as a comparable cross-type number.
   * Slurry: 1 gallon ≈ 4.546 kg (water density × imperial gallon).
   * Lime + solid manure: tonnes → kg.
   * Bag fert: native kg.
   * Used for sorting and ranking only — never displayed.
   */
  function totalKgEquivalent(a: typeof applications[number]): number {
    const product = productById[a.product_id];
    const f = fieldById[a.field_id];
    if (!product || !f) return 0;
    if (product.type === 'slurry') {
      let galPerAc = a.rate_value;
      if (a.rate_unit === 'm3/ha') galPerAc = a.rate_value * 89.0;
      return galPerAc * f.acres * 4.546;
    }
    if (product.type === 'solid_manure') {
      let tPerHa = a.rate_value;
      if (a.rate_unit === 't/ac') tPerHa = a.rate_value / 0.4047;
      return tPerHa * f.ha * 1000;
    }
    if (product.type === 'lime') {
      let tPerAc = a.rate_value;
      if (a.rate_unit === 't/ha') tPerAc = a.rate_value * 0.4047;
      return tPerAc * f.acres * 1000;
    }
    // bag_fert
    let kgPerHa = a.rate_value;
    if (a.rate_unit === 'kg/ac')      kgPerHa = a.rate_value * 2.4711;
    else if (a.rate_unit === 'lb/ac') kgPerHa = a.rate_value * 1.1209;
    return kgPerHa * f.ha;
  }

  // Sort — applied AFTER filtering so totals/summary stay consistent
  // with the filter set, only the row order changes.
  if (sortKey === 'date_asc') {
    filtered.sort((a, b) => a.date_applied.localeCompare(b.date_applied));
  } else if (sortKey === 'field') {
    filtered.sort((a, b) => {
      const fa = fieldById[a.field_id]?.name ?? '';
      const fb = fieldById[b.field_id]?.name ?? '';
      const byField = fa.localeCompare(fb);
      // Same field → newest first to keep grouping readable
      return byField !== 0 ? byField : b.date_applied.localeCompare(a.date_applied);
    });
  } else if (sortKey === 'qty_desc') {
    filtered.sort((a, b) => totalKgEquivalent(b) - totalKgEquivalent(a));
  } else {
    // date_desc — explicit so the order matches the sort dropdown even if
    // the source data ordering ever changes.
    filtered.sort((a, b) => b.date_applied.localeCompare(a.date_applied));
  }

  // Totals
  let totalGal = 0, totalKg = 0, totalLimeT = 0, totalSolidT = 0;
  filtered.forEach((a) => {
    const product = productById[a.product_id];
    const f = fieldById[a.field_id];
    if (!product || !f) return;
    if (product.type === 'slurry') {
      let galPerAc = a.rate_value;
      if (a.rate_unit === 'm3/ha') galPerAc = a.rate_value * 89.0;
      totalGal += galPerAc * f.acres;
    } else if (product.type === 'solid_manure') {
      let tPerHa = a.rate_value;
      if (a.rate_unit === 't/ac') tPerHa = a.rate_value / 0.4047;
      totalSolidT += tPerHa * f.ha;
    } else if (product.type === 'bag_fert') {
      let kgPerHa = a.rate_value;
      if (a.rate_unit === 'kg/ac') kgPerHa = a.rate_value * 2.4711;
      else if (a.rate_unit === 'lb/ac') kgPerHa = a.rate_value * 1.1209;
      totalKg += kgPerHa * f.ha;
    } else if (product.type === 'lime') {
      let tPerAc = a.rate_value;
      if (a.rate_unit === 't/ha') tPerAc = a.rate_value * 0.4047;
      totalLimeT += tPerAc * f.acres;
    }
  });

  const periodLabel =
    period === 'this_year' ? 'This year'
    : period === 'last_12m' ? 'Last 12 months'
    : period === 'all' ? 'All time'
    : period;

  const bagProducts = products.filter((p) => p.type === 'bag_fert');

  const baseHref = (overrides: Partial<Search>) => {
    const merged = { type, product: productId, period, next: nextFilter, sort: sortKey, ...overrides };
    const sp = new URLSearchParams();
    if (merged.type && merged.type !== 'all') sp.set('type', merged.type);
    if (merged.type === 'bag_fert' && merged.product && merged.product !== 'all') sp.set('product', String(merged.product));
    if (merged.period && merged.period !== 'this_year') sp.set('period', String(merged.period));
    if (merged.next && merged.next !== 'active') sp.set('next', String(merged.next));
    if (merged.sort && merged.sort !== 'date_desc') sp.set('sort', String(merged.sort));
    const q = sp.toString();
    return `/activity${q ? `?${q}` : ''}`;
  };

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="Activity" subtitle="Cross-farm history" />

      <div style={{ padding: '12px 16px 0' }}>
        <FilterChips
          paramName="next"
          ariaLabel="Filter by next cut type"
          options={[
            { value: 'active',   label: 'Active' },
            { value: 'silage',   label: 'Silage' },
            { value: 'bales',    label: 'Bales' },
            { value: 'grazing',  label: 'Grazing' },
            { value: 'complete', label: 'Complete' },
          ]}
        />
      </div>

      <div className="tabs">
        {(['all', 'slurry', 'solid_manure', 'bag_fert', 'lime'] as const).map((t) => (
          <Link
            key={t}
            href={baseHref({ type: t, product: 'all' })}
            className={`tab ${type === t ? 'active' : ''}`}
            scroll={false}
          >
            {t === 'all' ? 'All'
              : t === 'bag_fert' ? 'Fert'
              : t === 'slurry' ? 'Slurry'
              : t === 'solid_manure' ? 'Solid'
              : 'Lime'}
          </Link>
        ))}
      </div>

      <div style={{ padding: 16 }}>
        {/* Filters — period and (for fert) product */}
        <form
          className="card"
          style={{ padding: 12, marginBottom: 14 }}
          action="/activity"
          method="get"
        >
          {/* hidden field to preserve the type tab on form submit */}
          {type !== 'all' && <input type="hidden" name="type" value={type} />}
          {/* hidden field to preserve the next-cut filter across form submit */}
          {nextFilter !== 'active' && <input type="hidden" name="next" value={nextFilter} />}

          <div style={{ marginBottom: 10 }}>
            <div className="label" style={{ marginBottom: 6 }}>Period</div>
            <select className="select" name="period" defaultValue={period}>
              <option value="this_year">This year</option>
              <option value="last_12m">Last 12 months</option>
              {availableYears.map((y) => <option key={y} value={String(y)}>{y}</option>)}
              <option value="all">All time</option>
            </select>
          </div>

          <div style={{ marginBottom: type === 'bag_fert' ? 10 : 0 }}>
            <div className="label" style={{ marginBottom: 6 }}>Sort</div>
            <select className="select" name="sort" defaultValue={sortKey}>
              <option value="date_desc">Date — newest first</option>
              <option value="date_asc">Date — oldest first</option>
              <option value="field">Field A–Z</option>
              <option value="qty_desc">Largest total first</option>
            </select>
          </div>

          {type === 'bag_fert' && (
            <div>
              <div className="label" style={{ marginBottom: 6 }}>Product</div>
              <select className="select" name="product" defaultValue={String(productId)}>
                <option value="all">All fertilisers</option>
                {bagProducts.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
              </select>
            </div>
          )}

          <button type="submit" className="btn-ghost" style={{ marginTop: 10, width: '100%' }}>Apply filters</button>
        </form>

        {/* Summary */}
        <div className="card" style={{ padding: 14, marginBottom: 14, background: 'var(--paper-deep)' }}>
          <div className="label" style={{ marginBottom: 6 }}>{periodLabel} · {filtered.length} application{filtered.length === 1 ? '' : 's'}</div>
          <div style={{ display: 'flex', gap: 14, fontSize: 14 }}>
            {(type === 'all' || type === 'slurry') && totalGal > 0 && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--slurry)', fontWeight: 700, textTransform: 'uppercase' }}>Slurry</div>
                <div className="nutrient-num" style={{ fontSize: 18, color: 'var(--ink)' }}>{fmt(totalGal)}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>gallons</div>
              </div>
            )}
            {(type === 'all' || type === 'solid_manure') && totalSolidT > 0 && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--forest)', fontWeight: 700, textTransform: 'uppercase' }}>Solid</div>
                <div className="nutrient-num" style={{ fontSize: 18, color: 'var(--ink)' }}>{fmt(totalSolidT, 1)}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>tonnes</div>
              </div>
            )}
            {(type === 'all' || type === 'bag_fert') && totalKg > 0 && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--forest-dark)', fontWeight: 700, textTransform: 'uppercase' }}>Fertiliser</div>
                <div className="nutrient-num" style={{ fontSize: 18, color: 'var(--ink)' }}>{fmt(totalKg / 1000, 2)}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>tonnes</div>
              </div>
            )}
            {(type === 'all' || type === 'lime') && totalLimeT > 0 && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--stone)', fontWeight: 700, textTransform: 'uppercase' }}>Lime</div>
                <div className="nutrient-num" style={{ fontSize: 18, color: 'var(--ink)' }}>{fmt(totalLimeT, 1)}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>tonnes</div>
              </div>
            )}
            {filtered.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>No applications in this period.</div>
            )}
          </div>
        </div>

        {/* List */}
        {filtered.map((a) => {
          const product = productById[a.product_id];
          const f = fieldById[a.field_id];
          if (!product || !f) return null;
          const disp = displayRate(a, settings, product.type);

          let totalQty: number, totalUnit: string;
          if (product.type === 'slurry') {
            let galPerAc = a.rate_value;
            if (a.rate_unit === 'm3/ha') galPerAc = a.rate_value * 89.0;
            totalQty = galPerAc * f.acres;
            totalUnit = 'gal';
          } else if (product.type === 'solid_manure') {
            let tPerHa = a.rate_value;
            if (a.rate_unit === 't/ac') tPerHa = a.rate_value / 0.4047;
            totalQty = tPerHa * f.ha;
            totalUnit = 't';
          } else if (product.type === 'lime') {
            let tPerAc = a.rate_value;
            if (a.rate_unit === 't/ha') tPerAc = a.rate_value * 0.4047;
            totalQty = tPerAc * f.acres;
            totalUnit = 't';
          } else {
            let kgPerHa = a.rate_value;
            if (a.rate_unit === 'kg/ac') kgPerHa = a.rate_value * 2.4711;
            else if (a.rate_unit === 'lb/ac') kgPerHa = a.rate_value * 1.1209;
            totalQty = kgPerHa * f.ha;
            totalUnit = 'kg';
          }

          const Icon =
            product.type === 'slurry'       ? Droplets :
            product.type === 'solid_manure' ? Tractor  :
            product.type === 'lime'         ? Mountain :
            Sprout;
          const iconColor =
            product.type === 'slurry'       ? 'var(--slurry)' :
            product.type === 'solid_manure' ? 'var(--forest-dark)' :
            product.type === 'lime'         ? 'var(--stone)' :
            'var(--forest)';

          return (
            <Link
              key={a.id}
              href={`/fields/${f.id}`}
              className="card field-row"
              style={{ padding: 12, marginBottom: 8 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Icon size={14} style={{ color: iconColor, flexShrink: 0 }} />
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.name}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{product.name}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>{fmtDate(a.date_applied)}</div>
                  <div className="nutrient-num" style={{ fontSize: 15, color: 'var(--ink)' }}>
                    {fmt(disp.value, product.type === 'lime' ? 1 : 0)}{' '}
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{disp.unit}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {totalUnit === 'kg' && totalQty >= 1000
                      ? `${fmt(totalQty / 1000, 2)} t total`
                      : `${fmt(totalQty, totalUnit === 't' ? 1 : 0)} ${totalUnit} total`}
                  </div>
                </div>
              </div>
              {a.method && (product.type === 'slurry' || product.type === 'solid_manure') && (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
                  {methodLabel(a.method)}
                </div>
              )}
              {a.notes && a.applied_by !== 'plan' && (
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', paddingTop: 6, borderTop: '1px solid var(--line-soft)' }}>
                  {a.notes}
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
