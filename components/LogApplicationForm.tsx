'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Droplets, Sprout, Mountain, Save, Tractor } from 'lucide-react';
import {
  Application, Field, Product, ProductType, Settings, SlurryMethod, SolidMethod,
  ApplicationMethod,
} from '@/lib/types';
import {
  calcNutrients, displayBagAmount, displayFieldArea, fmt,
  METHOD_LABELS, SOLID_METHOD_LABELS, CATEGORY_LABELS,
} from '@/lib/rules';
import { saveApplication, updateApplication } from '@/lib/actions';
import { validateApplicationRate, validateDate } from '@/lib/validation';
import { InlineWarning, ErrorBanner } from './InlineWarning';

const LIME_RATES = [1, 1.5, 2, 2.5, 3] as const;

/** Distinct categories under a given product type, in sort-order order. */
function categoriesForType(products: Product[], type: ProductType): string[] {
  const seen = new Map<string, number>();  // category -> min sort_order across rows
  for (const p of products) {
    if (p.type !== type) continue;
    const cat = p.category ?? 'custom';
    const cur = seen.get(cat);
    if (cur == null || (p.sort_order ?? 0) < cur) {
      seen.set(cat, p.sort_order ?? 0);
    }
  }
  return Array.from(seen.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([cat]) => cat);
}

/** All products in a (type, category) bucket, sorted by sort_order then dm_pct. */
function productsInCategory(products: Product[], type: ProductType, category: string): Product[] {
  return products
    .filter((p) => p.type === type && (p.category ?? 'custom') === category)
    .sort((a, b) => {
      const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      if (so !== 0) return so;
      return (a.dm_pct ?? 0) - (b.dm_pct ?? 0);
    });
}

/** Type → "first product of that type" for default initial selection. */
function defaultProductIdFor(products: Product[], type: ProductType): number | null {
  const matching = products
    .filter((p) => p.type === type)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return matching[0]?.id ?? null;
}

// ---- Sub-picker derivation helpers --------------------------------
//
// Some product categories have sub-variants encoded in the product name
// (rather than as schema columns). The helpers below derive sub-picker
// state from a product, and resolve sub-picker state back to a product.
// This is name-pattern based — fragile if names change, but adding schema
// columns for one UI concern was deemed not worth the migration cost.

export type Feedstock = 'farm' | 'food';
export type DigestateForm = 'whole' | 'liquor' | 'fibre';
export type PoultrySource = 'layer_loose' | 'layer_housed' | 'broiler' | 'deep_pit';

function digestateFeedstockOf(p: Product): Feedstock {
  return p.name.toLowerCase().includes('food') ? 'food' : 'farm';
}
function digestateFormOf(p: Product): DigestateForm {
  const n = p.name.toLowerCase();
  if (n.includes('liquor')) return 'liquor';
  if (n.includes('fibre'))  return 'fibre';
  return 'whole';
}
function poultrySourceOf(p: Product): PoultrySource {
  const n = p.name.toLowerCase();
  if (n.includes('housed')) return 'layer_housed';
  if (n.includes('loose'))  return 'layer_loose';
  if (n.includes('broiler') || n.includes('turkey')) return 'broiler';
  return 'deep_pit';
}

/** Find a digestate product matching (feedstock, form). Returns null if not found. */
function findDigestate(
  products: Product[],
  type: ProductType,           // 'slurry' for whole/liquor, 'solid_manure' for fibre
  feedstock: Feedstock,
  form: DigestateForm,
): Product | null {
  return products.find((p) =>
    p.type === type &&
    p.category === 'digestate' &&
    digestateFeedstockOf(p) === feedstock &&
    digestateFormOf(p) === form
  ) ?? null;
}

function findPoultry(products: Product[], source: PoultrySource): Product | null {
  return products.find((p) =>
    p.type === 'solid_manure' &&
    p.category === 'poultry' &&
    poultrySourceOf(p) === source
  ) ?? null;
}

export function LogApplicationForm({
  field, products, settings, existing,
}: {
  field: Field;
  products: Product[];
  settings: Settings;
  existing?: Application;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const isEdit = !!existing;
  const pathname = usePathname() || `/fields/${field.id}/log`;

  // Determine initial type from existing application's product
  const initialType = useMemo<ProductType>(() => {
    if (!existing) return 'slurry';
    const p = products.find((p) => p.id === existing.product_id);
    return (p?.type as ProductType) ?? 'slurry';
  }, [existing, products]);

  const [type, setType] = useState<ProductType>(initialType);
  const [productId, setProductId] = useState<number>(() => {
    if (existing) return existing.product_id;
    // Prefer dairy slurry 6% DM (id 4) as the historical Mill Farm default.
    const dairy6 = products.find((p) => p.category === 'dairy_slurry' && p.dm_pct === 6);
    if (dairy6) return dairy6.id;
    return defaultProductIdFor(products, 'slurry') ?? 4;
  });
  const [date, setDate] = useState(existing?.date_applied ?? today);
  const [rateValue, setRateValue] = useState(() => {
    if (!existing) return '';
    if (initialType === 'lime') return '';
    return String(existing.rate_value);
  });

  // Method handling diverges by product type:
  //   slurry        — splash/dribble/trail
  //   solid_manure  — surface/soil-incorporated
  //   bag_fert/lime — none
  const initialSlurryMethod: SlurryMethod =
    existing?.method && (['splash_plate', 'dribble_bar', 'trail_shoe'] as const).includes(existing.method as SlurryMethod)
      ? (existing.method as SlurryMethod) : 'splash_plate';
  const initialSolidMethod: SolidMethod =
    existing?.method && (['surface', 'soil_incorporated'] as const).includes(existing.method as SolidMethod)
      ? (existing.method as SolidMethod) : 'surface';
  const [slurryMethod, setSlurryMethod] = useState<SlurryMethod>(initialSlurryMethod);
  const [solidMethod,  setSolidMethod]  = useState<SolidMethod>(initialSolidMethod);

  const [limeRate, setLimeRate] = useState<number>(
    existing && initialType === 'lime' ? existing.rate_value : 2
  );
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const product = products.find((p) => p.id === productId);
  const currentCategory = product?.category ?? null;

  // Category list for the dropdown — one entry per category in current type.
  const categoryList = useMemo(() => categoriesForType(products, type), [products, type]);

  // Products that share the current category (used by sub-pickers).
  const siblings = useMemo(() => {
    if (!currentCategory) return [] as Product[];
    return productsInCategory(products, type, currentCategory);
  }, [products, type, currentCategory]);

  /** Select a category and default to the first product in it. */
  function selectCategory(category: string) {
    const candidates = productsInCategory(products, type, category);
    if (candidates.length === 0) return;
    // For dairy/pig slurry default to the middle DM band if available
    // (6% DM for dairy, 4% DM for pig), otherwise first by sort_order.
    let chosen = candidates[0];
    if (category === 'dairy_slurry') {
      chosen = candidates.find((p) => p.dm_pct === 6) ?? chosen;
    } else if (category === 'pig_slurry') {
      chosen = candidates.find((p) => p.dm_pct === 4) ?? chosen;
    }
    setProductId(chosen.id);
  }

  // Sub-picker derived state (read from currentCategory + current product).
  const dmSiblings = useMemo(() => {
    if (currentCategory !== 'dairy_slurry' && currentCategory !== 'pig_slurry') return [];
    return [...siblings].sort((a, b) => (a.dm_pct ?? 0) - (b.dm_pct ?? 0));
  }, [currentCategory, siblings]);

  const showDigestateSubPickers = currentCategory === 'digestate';
  const showPoultrySubPicker    = currentCategory === 'poultry' && type === 'solid_manure';
  const digestateFeedstock = (product && showDigestateSubPickers) ? digestateFeedstockOf(product) : 'farm';
  const digestateForm      = (product && showDigestateSubPickers) ? digestateFormOf(product)      : 'whole';
  const poultrySource      = (product && showPoultrySubPicker)    ? poultrySourceOf(product)      : 'layer_loose';

  /** Switch digestate feedstock, preserving form if a matching product exists. */
  function switchDigestateFeedstock(feedstock: Feedstock) {
    const match = findDigestate(products, type, feedstock, digestateForm)
               ?? findDigestate(products, type, feedstock, 'whole')
               ?? findDigestate(products, type, feedstock, 'liquor');
    if (match) setProductId(match.id);
  }

  /** Switch digestate form, preserving feedstock if a matching product exists. */
  function switchDigestateForm(form: DigestateForm) {
    const match = findDigestate(products, type, digestateFeedstock, form);
    if (match) setProductId(match.id);
  }

  function switchPoultrySource(source: PoultrySource) {
    const match = findPoultry(products, source);
    if (match) setProductId(match.id);
  }

  // Unit-aware edit: when editing, respect the stored unit rather than the user's
  // current display setting. New applications use the user's preferred unit.
  const displayUnit = useMemo(() => {
    if (isEdit && existing) {
      // For lime / solid manure, honour stored unit (t/ac or t/ha).
      if (existing.rate_unit === 't/ha' || existing.rate_unit === 't/ac') return existing.rate_unit;
      if (existing.rate_unit === 'kg/ha' || existing.rate_unit === 'kg/ac' || existing.rate_unit === 'lb/ac') return existing.rate_unit;
      if (existing.rate_unit === 'gal/ac' || existing.rate_unit === 'm3/ha') return existing.rate_unit;
    }
    if (type === 'slurry') return settings.slurryUnit;
    if (type === 'lime')   return settings.limeUnit;
    if (type === 'solid_manure') {
      // No dedicated setting for solid manure — follow the user's area system.
      return settings.unitSystem === 'acres' ? 't/ac' : 't/ha';
    }
    // For bag-fert input, units/ac is not a valid product-rate (it's a nutrient
    // display preference). Fall back to kg/ha for the input dropdown default.
    return settings.bagFertUnit === 'units/ac' ? 'kg/ha' : settings.bagFertUnit;
  }, [isEdit, existing, type, settings]);

  // When type changes, swap to the first category in that type and
  // select the sensible default product within it.
  function changeType(newType: ProductType) {
    if (isEdit) return; // Type is locked when editing — products differ per type
    setType(newType);
    const cats = categoriesForType(products, newType);
    const firstCat = cats[0];
    if (firstCat) {
      const candidates = productsInCategory(products, newType, firstCat);
      // Mirror the category-default logic in selectCategory.
      let chosen = candidates[0];
      if (firstCat === 'dairy_slurry') {
        chosen = candidates.find((p) => p.dm_pct === 6) ?? chosen;
      } else if (firstCat === 'pig_slurry') {
        chosen = candidates.find((p) => p.dm_pct === 4) ?? chosen;
      }
      if (chosen) setProductId(chosen.id);
    } else {
      const fallback = defaultProductIdFor(products, newType);
      if (fallback != null) setProductId(fallback);
    }
    if (newType !== 'lime') setRateValue('');
  }

  // Convert lime rate (t/ac) to the right field for the calc engine.
  const numericRate = type === 'lime' ? limeRate : parseFloat(rateValue) || 0;
  const storedUnit = type === 'lime' ? 't/ac' : displayUnit;

  // Pick the right method for the calc (null for bag_fert and lime).
  const methodForCalc: ApplicationMethod | null =
    type === 'slurry'       ? slurryMethod :
    type === 'solid_manure' ? solidMethod  :
    null;

  const nut = useMemo(
    () => calcNutrients(product, numericRate, storedUnit as any, date, methodForCalc),
    [product, numericRate, storedUnit, date, methodForCalc]
  );

  const totalQty = useMemo(() => {
    if (type === 'lime') return { value: limeRate * field.acres, unit: 't' };
    if (type === 'slurry') {
      const galPerAc = displayUnit === 'm3/ha' ? numericRate * 89.0 : numericRate;
      return { value: galPerAc * field.acres, unit: 'gal' };
    }
    if (type === 'solid_manure') {
      let tPerHa = numericRate;
      if (displayUnit === 't/ac') tPerHa = numericRate / 0.4047;
      return { value: tPerHa * field.ha, unit: 't' };
    }
    let kgPerHa = numericRate;
    if (displayUnit === 'kg/ac') kgPerHa = numericRate * 2.4711;
    else if (displayUnit === 'lb/ac') kgPerHa = numericRate * 1.1209;
    return { value: kgPerHa * field.ha, unit: 'kg' };
  }, [type, limeRate, numericRate, displayUnit, field]);

  const rateWarning = useMemo(
    () => validateApplicationRate(numericRate, type, displayUnit),
    [numericRate, type, displayUnit]
  );
  const dateWarning = useMemo(() => validateDate(date), [date]);

  const hasBlockingError = !!(rateWarning?.kind === 'error' || dateWarning?.kind === 'error');
  // Block save when no product of the current type is selected — happens
  // when the user switches to a type that has no products yet. Stops the
  // form silently submitting with a stale product from the previous type.
  const productMatchesType = !!product && product.type === type;
  const canSave = productMatchesType && date && numericRate > 0 && !hasBlockingError && !submitting;

  // Method to write into FormData (empty string omitted server-side).
  const methodForForm: string =
    type === 'slurry'       ? slurryMethod :
    type === 'solid_manure' ? solidMethod  :
    '';

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      if (isEdit) {
        await updateApplication(fd);
      } else {
        await saveApplication(fd);
      }
      // Server action will redirect on success
    } catch (err) {
      if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) {
        setSubmitError(err.message);
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ paddingBottom: 100 }}>
      {isEdit && existing && <input type="hidden" name="id" value={existing.id} />}
      <input type="hidden" name="field_id" value={field.id} />
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="rate_value" value={numericRate} />
      <input type="hidden" name="rate_unit" value={storedUnit} />
      {(type === 'slurry' || type === 'solid_manure') && (
        <input type="hidden" name="method" value={methodForForm} />
      )}

      <div style={{ padding: 16 }}>
        {!isEdit && (
          <div className="toggle-group" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
            <button type="button" className={`toggle-btn ${type === 'slurry' ? 'active' : ''}`} onClick={() => changeType('slurry')}><Droplets size={16} /> Slurry</button>
            <button type="button" className={`toggle-btn ${type === 'solid_manure' ? 'active' : ''}`} onClick={() => changeType('solid_manure')}><Tractor size={16} /> Solid manure</button>
            <button type="button" className={`toggle-btn ${type === 'bag_fert' ? 'active' : ''}`} onClick={() => changeType('bag_fert')}><Sprout size={16} /> Bag fert</button>
            <button type="button" className={`toggle-btn ${type === 'lime' ? 'active' : ''}`} onClick={() => changeType('lime')}><Mountain size={16} /> Lime</button>
          </div>
        )}

        {type !== 'lime' && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div className="label">Product</div>
              <Link
                href={`/products/new?type=${type}&return=${encodeURIComponent(pathname)}`}
                style={{ fontSize: 12, color: 'var(--forest-dark)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                title="Add a custom product"
              >
                + New
              </Link>
            </div>
            {/* Category select shown only when there's a meaningful choice
                to make. Bag fert + Lime typically resolve to a single
                category so the redundant "Bag fertiliser" header in the
                dropdown is hidden. Slurry / solid manure usually have
                multiple categories (dairy / pig / FYM / poultry / etc.)
                and the picker is genuinely useful there. */}
            {categoryList.length > 1 && (
              <select
                className="select"
                value={currentCategory ?? ''}
                onChange={(e) => selectCategory(e.target.value)}
                disabled={isEdit}
                title={isEdit ? 'Product locked when editing — delete and re-log to change' : undefined}
              >
                {categoryList.map((cat) => {
                  const label = (CATEGORY_LABELS as any)[cat] ?? cat;
                  return <option key={cat} value={cat}>{label}</option>;
                })}
              </select>
            )}
          </div>
        )}

        {/* Empty state — no products of this type exist yet. Encourages
            the user to add one rather than silently rendering nothing or
            (worse) leaving a stale product from another type selected. */}
        {type !== 'lime' && siblings.length === 0 && (
          <div style={{
            padding: 12,
            marginBottom: 14,
            border: '1px solid var(--line)',
            borderRadius: 4,
            background: 'var(--card)',
            fontSize: 12,
            color: 'var(--muted)',
          }}>
            No {type === 'bag_fert' ? 'bag fertilisers' : type === 'slurry' ? 'slurries' : 'solid manures'} yet.
            Tap <strong>+ New</strong> above to add one.
          </div>
        )}

        {/* Product-level selector — shown when the category has multiple
            products AND there's no specialised sub-picker for that category
            (DM bands for dairy/pig slurry; feedstock/form for digestate;
            source for poultry). Used by bag fert, lime, FYM, separated,
            biosolids, and any user-created custom products. Without this,
            users with multiple bag-fert products (typical) couldn't pick
            between them. */}
        {type !== 'lime' && siblings.length > 1 && (() => {
          const handledByDmPicker = currentCategory === 'dairy_slurry' || currentCategory === 'pig_slurry';
          const handledByDigestatePicker = currentCategory === 'digestate';
          const handledByPoultryPicker = currentCategory === 'poultry' && type === 'solid_manure';
          if (handledByDmPicker || handledByDigestatePicker || handledByPoultryPicker) return null;
          return (
            <div style={{ marginBottom: 14 }}>
              <div className="label">Choose product</div>
              <select
                className="select"
                value={productId}
                onChange={(e) => setProductId(parseInt(e.target.value, 10))}
                disabled={isEdit}
                title={isEdit ? 'Product locked when editing — delete and re-log to change' : undefined}
              >
                {siblings.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          );
        })()}

        {/* Sub-picker: Dairy/Pig slurry — DM band quick-pick. */}
        {dmSiblings.length > 1 && (
          <div style={{ marginBottom: 14 }}>
            <div className="label">Dry matter</div>
            <div className="toggle-group" role="group" aria-label="Dry matter band">
              {dmSiblings.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`toggle-btn ${p.id === productId ? 'active' : ''}`}
                  onClick={() => setProductId(p.id)}
                  disabled={isEdit}
                  title={isEdit ? 'DM band locked when editing — delete and re-log to change' : undefined}
                >
                  {p.dm_pct}% DM
                </button>
              ))}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
              NPK shifts with DM — RB209 values for {product?.dm_pct}% DM shown below.
            </div>
          </div>
        )}

        {/* Sub-pickers: Digestate — feedstock (farm/food) and (for liquids) form (whole/liquor). */}
        {showDigestateSubPickers && (
          <>
            <div style={{ marginBottom: 14 }}>
              <div className="label">Feedstock</div>
              <div className="toggle-group" role="group" aria-label="Digestate feedstock">
                <button
                  type="button"
                  className={`toggle-btn ${digestateFeedstock === 'farm' ? 'active' : ''}`}
                  onClick={() => switchDigestateFeedstock('farm')}
                  disabled={isEdit}
                >
                  Farm-sourced
                </button>
                <button
                  type="button"
                  className={`toggle-btn ${digestateFeedstock === 'food' ? 'active' : ''}`}
                  onClick={() => switchDigestateFeedstock('food')}
                  disabled={isEdit}
                >
                  Food-based
                </button>
              </div>
            </div>
            {type === 'slurry' && (
              <div style={{ marginBottom: 14 }}>
                <div className="label">Form</div>
                <div className="toggle-group" role="group" aria-label="Digestate form">
                  <button
                    type="button"
                    className={`toggle-btn ${digestateForm === 'whole' ? 'active' : ''}`}
                    onClick={() => switchDigestateForm('whole')}
                    disabled={isEdit}
                  >
                    Whole
                  </button>
                  <button
                    type="button"
                    className={`toggle-btn ${digestateForm === 'liquor' ? 'active' : ''}`}
                    onClick={() => switchDigestateForm('liquor')}
                    disabled={isEdit}
                  >
                    Liquor
                  </button>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                  Fibre fraction lives under Solid manure → Digestate.
                </div>
              </div>
            )}
          </>
        )}

        {/* Sub-picker: Poultry — by source. */}
        {showPoultrySubPicker && (
          <div style={{ marginBottom: 14 }}>
            <div className="label">Source</div>
            <div className="toggle-group" role="group" aria-label="Poultry manure source" style={{ flexWrap: 'wrap' }}>
              {([
                ['layer_loose',  'Layer (loose)'],
                ['layer_housed', 'Layer (housed)'],
                ['broiler',      'Broiler / turkey'],
                ['deep_pit',     'Deep-pit / dried'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`toggle-btn ${poultrySource === key ? 'active' : ''}`}
                  onClick={() => switchPoultrySource(key)}
                  disabled={isEdit}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <div className="label">Date applied</div>
          <input type="date" name="date_applied" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
          <InlineWarning warning={dateWarning} />
        </div>

        {type === 'lime' ? (
          <div style={{ marginBottom: 14 }}>
            <div className="label">Rate (t/ac)</div>
            <select className="select" value={limeRate} onChange={(e) => setLimeRate(parseFloat(e.target.value))}>
              {LIME_RATES.map((r) => <option key={r} value={r}>{r} t/ac</option>)}
            </select>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
              {(() => {
                const a = displayFieldArea(field, settings.unitSystem);
                return `= ${fmt(totalQty.value, 1)} t total over ${fmt(a.value, 1)} ${a.unit}`;
              })()}
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <div className="label">Rate ({displayUnit})</div>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              className="input"
              placeholder={
                type === 'slurry'
                  ? (displayUnit === 'gal/ac' ? 'e.g. 2000' : 'e.g. 22')
                  : type === 'solid_manure'
                  ? (displayUnit === 't/ha' ? 'e.g. 25' : 'e.g. 10')
                  : (displayUnit === 'kg/ha' ? 'e.g. 440' : displayUnit === 'kg/ac' ? 'e.g. 178' : 'e.g. 392')
              }
              value={rateValue}
              onChange={(e) => setRateValue(e.target.value)}
            />
            {numericRate > 0 && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                {(() => {
                  const a = displayFieldArea(field, settings.unitSystem);
                  return `= ${fmt(totalQty.value)} ${totalQty.unit} total over ${fmt(a.value, 1)} ${a.unit}`;
                })()}
              </div>
            )}
            <InlineWarning warning={rateWarning} />
          </div>
        )}

        {type === 'slurry' && (
          <div style={{ marginBottom: 14 }}>
            <div className="label">Application method</div>
            <select className="select" value={slurryMethod} onChange={(e) => setSlurryMethod(e.target.value as SlurryMethod)}>
              {(['splash_plate', 'dribble_bar', 'trail_shoe'] as const).map((m) => (
                <option key={m} value={m}>{METHOD_LABELS[m]}</option>
              ))}
            </select>
          </div>
        )}

        {type === 'solid_manure' && (
          <div style={{ marginBottom: 14 }}>
            <div className="label">Application method</div>
            <select className="select" value={solidMethod} onChange={(e) => setSolidMethod(e.target.value as SolidMethod)}>
              {(['surface', 'soil_incorporated'] as const).map((m) => (
                <option key={m} value={m}>{SOLID_METHOD_LABELS[m]}</option>
              ))}
            </select>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
              Soil-incorporated within 24h gets a higher N availability credit (typically ×1.5 of surface).
            </div>
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <div className="label">Notes (optional)</div>
          <textarea name="notes" className="textarea" rows={2} placeholder="Anything worth recording…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {type !== 'lime' && numericRate > 0 && (
          <div className="card" style={{ padding: 14, background: 'var(--forest-soft)', borderColor: 'var(--forest)' }}>
            <div className="label" style={{ color: 'var(--forest-dark)' }}>This application delivers</div>
            <div style={{ display: 'flex', gap: 14, marginTop: 4 }}>
              {(() => {
                const nView = displayBagAmount(nut.nPerHa,    settings.bagFertUnit);
                const pView = displayBagAmount(nut.p2o5PerHa, settings.bagFertUnit);
                const kView = displayBagAmount(nut.k2oPerHa,  settings.bagFertUnit);
                const showsAvail = type === 'slurry' || type === 'solid_manure';
                return (
                  <>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: 'var(--forest-dark)', textTransform: 'uppercase', fontWeight: 700 }}>N</div>
                      <div className="nutrient-num" style={{ fontSize: 22, color: 'var(--forest-dark)' }}>{fmt(nView.value)}</div>
                      <div style={{ fontSize: 11, color: 'var(--forest-dark)' }}>{nView.unit} {showsAvail ? 'avail' : ''}</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: 'var(--forest-dark)', textTransform: 'uppercase', fontWeight: 700 }}>P₂O₅</div>
                      <div className="nutrient-num" style={{ fontSize: 22, color: 'var(--forest-dark)' }}>{fmt(pView.value)}</div>
                      <div style={{ fontSize: 11, color: 'var(--forest-dark)' }}>{pView.unit}</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: 'var(--forest-dark)', textTransform: 'uppercase', fontWeight: 700 }}>K₂O</div>
                      <div className="nutrient-num" style={{ fontSize: 22, color: 'var(--forest-dark)' }}>{fmt(kView.value)}</div>
                      <div style={{ fontSize: 11, color: 'var(--forest-dark)' }}>{kView.unit}</div>
                    </div>
                  </>
                );
              })()}
            </div>
            {(nut.so3PerHa > 0 || nut.mgoPerHa > 0) && (() => {
              const sView = displayBagAmount(nut.so3PerHa, settings.bagFertUnit);
              const mView = displayBagAmount(nut.mgoPerHa, settings.bagFertUnit);
              return (
                <div style={{
                  display: 'flex', gap: 18, marginTop: 8, paddingTop: 8,
                  borderTop: '1px solid var(--forest)', fontSize: 12, color: 'var(--forest-dark)',
                }}>
                  {nut.so3PerHa > 0 && (
                    <div>
                      <span style={{ fontWeight: 700 }}>SO₃</span>{' '}
                      <span className="nutrient-num">{fmt(sView.value)}</span>{' '}
                      <span style={{ opacity: 0.75 }}>{sView.unit}</span>
                    </div>
                  )}
                  {nut.mgoPerHa > 0 && (
                    <div>
                      <span style={{ fontWeight: 700 }}>MgO</span>{' '}
                      <span className="nutrient-num">{fmt(mView.value)}</span>{' '}
                      <span style={{ opacity: 0.75 }}>{mView.unit}</span>
                    </div>
                  )}
                </div>
              );
            })()}
            {nut.nNote && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--forest-dark)', fontStyle: 'italic' }}>N basis: {nut.nNote}</div>}
            {(type === 'slurry' || type === 'solid_manure') && nut.availFactor === 0 && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--forest)', fontSize: 12, color: 'var(--forest-dark)' }}>
                <strong>Autumn application:</strong> N assumed leached before spring growth. P and K still bank in the soil and count in full.
              </div>
            )}
          </div>
        )}
        {type === 'lime' && (
          <div className="card" style={{ padding: 14, background: 'var(--stone-soft)', borderColor: 'var(--stone)' }}>
            <div style={{ fontSize: 13, color: 'var(--stone)', fontWeight: 700 }}>pH amendment</div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>
              Lime doesn't deliver N/P/K. It raises soil pH, which unlocks N uptake and lifts grass response — resample 6–12 months after application to confirm pH movement.
            </div>
          </div>
        )}
      </div>

      <div style={{ position: 'sticky', bottom: 0, padding: '0 16px 16px', background: 'linear-gradient(to top, var(--paper) 70%, transparent)' }}>
        <ErrorBanner error={submitError} />
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href={`/fields/${field.id}`} className="btn-ghost" style={{ flex: 1, textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Cancel</Link>
          <button type="submit" className="btn-primary" style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} disabled={!canSave}>
            <Save size={18} /> {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Save entry'}
          </button>
        </div>
      </div>
    </form>
  );
}
