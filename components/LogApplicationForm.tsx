'use client';

import { useMemo, useState, useEffect } from 'react';
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
import { saveApplication, updateApplication, saveBatchApplications } from '@/lib/actions';
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
  field, products, settings, existing, initialType: initialTypeProp, batchFields, groups, usage,
}: {
  field: Field;
  products: Product[];
  settings: Settings;
  existing?: Application;
  initialType?: ProductType;
  batchFields?: Field[];
  /** Field groups, for the batch field-list group filter. */
  groups?: { id: string; name: string }[];
  /** product_id -> times used, for most-used-first ordering of bag fert. */
  usage?: Record<number, number>;
}) {
  const isBatch = Array.isArray(batchFields) && batchFields.length > 0;
  const today = new Date().toISOString().slice(0, 10);
  const isEdit = !!existing;
  const pathname = usePathname() || `/fields/${field.id}/log`;

  // Determine initial type from existing application's product
  const initialType = useMemo<ProductType>(() => {
    if (existing) {
      const p = products.find((p) => p.id === existing.product_id);
      return (p?.type as ProductType) ?? 'slurry';
    }
    if (initialTypeProp) return initialTypeProp;
    return 'slurry';
  }, [existing, products, initialTypeProp]);

  const [type, setType] = useState<ProductType>(initialType);
  const [productId, setProductId] = useState<number>(() => {
    if (existing) return existing.product_id;
    // If a type was preselected (from the Log action menu), default to that
    // type's first sensible product. For slurry specifically, prefer dairy
    // 6% DM rather than the first-by-sort-order band (which is 2% DM).
    if (initialTypeProp) {
      if (initialTypeProp === 'slurry') {
        const dairy6 = products.find((p) => p.category === 'dairy_slurry' && p.dm_pct === 6);
        if (dairy6) return dairy6.id;
      }
      return defaultProductIdFor(products, initialTypeProp) ?? 4;
    }
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

  // Batch mode state: which fields are ticked, and any per-field rate
  // overrides (field id -> rate string). A field absent from overrides uses
  // the shared rate set above.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [showPerField, setShowPerField] = useState(false);
  // Group filter for the batch field list. 'all' = no filter.
  const [groupFilter, setGroupFilter] = useState<string>('all');
  // Bag fert: which form (granular/liquid) the product list is filtered to.
  const [bagFormFilter, setBagFormFilter] = useState<'granular' | 'liquid'>(() => {
    if (existing) {
      const p = products.find((pr) => pr.id === existing.product_id);
      if (p?.form === 'liquid') return 'liquid';
    }
    return 'granular';
  });

  const product = products.find((p) => p.id === productId);
  const currentCategory = product?.category ?? null;

  // Category list for the dropdown — one entry per category in current type.
  const categoryList = useMemo(() => categoriesForType(products, type), [products, type]);

  // Products that share the current category (used by sub-pickers).
  const siblings = useMemo(() => {
    if (!currentCategory) return [] as Product[];
    let list = productsInCategory(products, type, currentCategory);
    // Bag fert splits by form: show only granular OR liquid products to match
    // the form toggle. Treat a null form as granular (legacy rows pre-migration).
    if (type === 'bag_fert') {
      list = list.filter((p) => {
        const f = p.form === 'liquid' ? 'liquid' : 'granular';
        return f === bagFormFilter;
      });
    }
    // Bag fert has no sub-pickers, so order the dropdown most-used-first
    // (then alphabetical for ties / unused). Other types keep sort_order so
    // their DM/feedstock sub-pickers stay in their natural order.
    if (type === 'bag_fert' && usage) {
      return [...list].sort((a, b) => {
        const ua = usage[a.id] ?? 0;
        const ub = usage[b.id] ?? 0;
        if (ub !== ua) return ub - ua;
        return a.name.localeCompare(b.name);
      });
    }
    return list;
  }, [products, type, currentCategory, usage, bagFormFilter]);

  // Keep the selected product consistent with the bag-fert form filter: if the
  // current selection isn't in the filtered list (e.g. on first load the
  // default product was liquid but the filter is granular), snap to the first
  // visible product. Only for new entries (editing locks the product).
  useEffect(() => {
    if (isEdit || type !== 'bag_fert' || siblings.length === 0) return;
    if (!siblings.some((p) => p.id === productId)) {
      setProductId(siblings[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bagFormFilter, type, siblings]);

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
    // Bag fert: liquid products are dosed in litres; granular in kg.
    if (type === 'bag_fert' && product?.form === 'liquid') {
      return settings.unitSystem === 'acres' ? 'l/ac' : 'l/ha';
    }
    // For bag-fert input, units/ac is not a valid product-rate (it's a nutrient
    // display preference). Fall back to kg/ha for the input dropdown default.
    return settings.bagFertUnit === 'units/ac' ? 'kg/ha' : settings.bagFertUnit;
  }, [isEdit, existing, type, settings, product]);

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

  /** Switch the bag-fert form (granular/liquid) and select the first product
   *  of that form (most-used if usage known), so the picker isn't left on a
   *  product from the other form. */
  function switchBagForm(form: 'granular' | 'liquid') {
    if (isEdit) return;
    setBagFormFilter(form);
    const inForm = products.filter((p) => {
      if (p.type !== 'bag_fert') return false;
      const f = p.form === 'liquid' ? 'liquid' : 'granular';
      return f === form;
    });
    if (inForm.length > 0) {
      // Prefer most-used if we have usage data, else first by sort_order.
      let chosen = inForm[0];
      if (usage) {
        chosen = [...inForm].sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0))[0];
      }
      setProductId(chosen.id);
    }
    setRateValue('');
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

  // Per-field rate validity: in "different rate per field" mode the shared
  // rate box is irrelevant — what matters is that every ticked field has its
  // own positive rate. In shared mode, the single rate box must be positive.
  const allPickedHaveRate = useMemo(() => {
    if (picked.size === 0) return false;
    for (const fid of picked) {
      const ov = parseFloat(overrides[fid] ?? '');
      // Valid if this field has its own positive rate, or there's a positive
      // shared rate it can fall back to.
      if (!(ov > 0) && !(numericRate > 0)) return false;
    }
    return true;
  }, [picked, overrides, numericRate]);

  // The effective rate requirement depends on mode.
  const rateOk = isBatch && showPerField ? allPickedHaveRate : numericRate > 0;

  const canSave = isBatch
    ? (productMatchesType && date && rateOk && !hasBlockingError && !submitting && picked.size > 0)
    : (productMatchesType && date && numericRate > 0 && !hasBlockingError && !submitting);

  // Method to write into FormData (empty string omitted server-side).
  const methodForForm: string =
    type === 'slurry'       ? slurryMethod :
    type === 'solid_manure' ? solidMethod  :
    '';

  function toggleField(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      if (isBatch) {
        // Build rows: one per ticked field. In per-field mode each field uses
        // its own override rate; in shared mode all use the single rate. (When
        // per-field, validation already ensured every field has a rate.)
        const rows = Array.from(picked).map((fid) => {
          const ov = overrides[fid];
          const hasOv = ov != null && ov !== '' && parseFloat(ov) > 0;
          const r = hasOv ? parseFloat(ov) : numericRate;
          return { field_id: fid, rate_value: r, rate_unit: storedUnit };
        });
        fd.set('rows', JSON.stringify(rows));
        await saveBatchApplications(fd);
      } else if (isEdit) {
        await updateApplication(fd);
      } else {
        await saveApplication(fd);
      }
      // Server action will redirect on success
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      // A Next.js redirect throws NEXT_REDIRECT by design — the save
      // succeeded and navigation is happening, so don't treat it as an error.
      // We still schedule a submitting reset as a safety net: if the
      // navigation stalls (slow revalidation), the button won't stay frozen
      // on "Saving…" — the user can retry or navigate without restarting.
      if (msg.includes('NEXT_REDIRECT')) {
        setTimeout(() => setSubmitting(false), 1500);
        return;
      }
      setSubmitError(msg || 'Could not save — please try again');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ paddingBottom: 100 }}>
      {isEdit && existing && <input type="hidden" name="id" value={existing.id} />}
      {!isBatch && <input type="hidden" name="field_id" value={field.id} />}
      <input type="hidden" name="product_id" value={productId} />
      {isBatch && <input type="hidden" name="log_type" value={type} />}
      {!isBatch && <input type="hidden" name="rate_value" value={numericRate} />}
      <input type="hidden" name="rate_unit" value={storedUnit} />
      {(type === 'slurry' || type === 'solid_manure') && (
        <input type="hidden" name="method" value={methodForForm} />
      )}

      <div style={{ padding: 16 }}>
        {!isEdit && (
          <div className="toggle-group" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
            <button type="button" className={`toggle-btn ${type === 'slurry' ? 'active' : ''}`} onClick={() => changeType('slurry')}><Droplets size={16} /> Slurry</button>
            <button type="button" className={`toggle-btn ${type === 'solid_manure' ? 'active' : ''}`} onClick={() => changeType('solid_manure')}><Tractor size={16} /> Solid manure</button>
            <button type="button" className={`toggle-btn ${type === 'bag_fert' ? 'active' : ''}`} onClick={() => changeType('bag_fert')}><Sprout size={16} /> Fertiliser</button>
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

        {/* Bag fert form toggle: Granular vs Liquid. Splits the product list
            so the user picks the form first, then the product within it. */}
        {type === 'bag_fert' && (
          <div style={{ marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 6 }}>Fertiliser form</div>
            <div className="toggle-group" role="group" aria-label="Fertiliser form">
              <button
                type="button"
                className={`toggle-btn ${bagFormFilter === 'granular' ? 'active' : ''}`}
                onClick={() => switchBagForm('granular')}
                disabled={isEdit}
                title={isEdit ? 'Locked when editing — delete and re-log to change' : undefined}
              >
                Granular
              </button>
              <button
                type="button"
                className={`toggle-btn ${bagFormFilter === 'liquid' ? 'active' : ''}`}
                onClick={() => switchBagForm('liquid')}
                disabled={isEdit}
                title={isEdit ? 'Locked when editing — delete and re-log to change' : undefined}
              >
                Liquid
              </button>
            </div>
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
            {type === 'bag_fert'
              ? `No ${bagFormFilter} fertilisers yet. Tap + New above to add one.`
              : <>No {type === 'slurry' ? 'slurries' : 'solid manures'} yet. Tap <strong>+ New</strong> above to add one.</>}
          </div>
        )}

        {/* Product-level selector / name display.
            - Lime IS included here (earlier bug: it was excluded, so users
              with multiple lime products couldn't choose between them).
            - When the category has a specialised sub-picker (DM bands for
              dairy/pig slurry; feedstock/form for digestate; source for
              poultry), selection happens there, so this is skipped.
            - When >1 product: a dropdown to choose.
            - When exactly 1 product: a read-only name line so the user can
              see WHAT is selected (previously a lone custom slurry/solid
              manure showed only the category "Custom" with no name). */}
        {(() => {
          const handledByDmPicker = currentCategory === 'dairy_slurry' || currentCategory === 'pig_slurry';
          const handledByDigestatePicker = currentCategory === 'digestate';
          const handledByPoultryPicker = currentCategory === 'poultry' && type === 'solid_manure';
          if (handledByDmPicker || handledByDigestatePicker || handledByPoultryPicker) return null;
          if (siblings.length === 0) return null;
          if (siblings.length === 1) {
            // Single product — show its name read-only so it's never a
            // mystery what's selected.
            const only = siblings[0];
            return (
              <div style={{ marginBottom: 14 }}>
                <div className="label">Product</div>
                <div style={{
                  padding: '10px 12px',
                  border: '1px solid var(--line)',
                  borderRadius: 4,
                  background: 'var(--card)',
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--ink)',
                }}>
                  {only.name}
                </div>
              </div>
            );
          }
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

        {isBatch && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="label" style={{ margin: 0 }}>Fields ({picked.size} picked)</div>
              <div style={{ display: 'inline-flex', gap: 10 }}>
                <button type="button" onClick={() => {
                  // "All" ticks the currently-visible (filtered) fields.
                  const visible = batchFields!.filter((f) => groupFilter === 'all' || (groupFilter === 'ungrouped' ? !f.group_id : f.group_id === groupFilter));
                  setPicked((prev) => { const n = new Set(prev); visible.forEach((f) => n.add(f.id)); return n; });
                }} style={{ background: 'none', border: 'none', color: 'var(--forest-dark)', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}>All{groupFilter !== 'all' ? ' shown' : ''}</button>
                <button type="button" onClick={() => setPicked(new Set())} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}>None</button>
              </div>
            </div>

            {/* Group filter — reduces the list to one block of land at a time */}
            {groups && groups.length > 0 && (() => {
              const anyUngrouped = batchFields!.some((f) => !f.group_id);
              const chips = [
                { v: 'all', label: 'All' },
                ...groups.map((g) => ({ v: g.id, label: g.name })),
                ...(anyUngrouped ? [{ v: 'ungrouped', label: 'Ungrouped' }] : []),
              ];
              return (
                <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 4, marginBottom: 10, WebkitOverflowScrolling: 'touch' }}>
                  {chips.map((c) => {
                    const active = groupFilter === c.v;
                    return (
                      <button
                        key={c.v}
                        type="button"
                        onClick={() => setGroupFilter(c.v)}
                        style={{
                          flexShrink: 0,
                          background: active ? 'var(--forest)' : 'var(--card)',
                          color: active ? 'var(--paper)' : 'var(--ink-soft)',
                          border: active ? 'none' : '1px solid var(--line)',
                          borderRadius: 20,
                          padding: '6px 13px',
                          fontSize: 12,
                          fontWeight: 700,
                          fontFamily: 'inherit',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            {picked.size > 1 && (
              <button
                type="button"
                onClick={() => setShowPerField((v) => !v)}
                style={{ width: '100%', marginBottom: 8, background: showPerField ? 'var(--forest-soft)' : 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px', fontSize: 12, fontWeight: 700, color: showPerField ? 'var(--forest-dark)' : 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {showPerField ? 'Same rate for all' : 'Set a different rate per field'}
              </button>
            )}

            <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
              {batchFields!
                .filter((f) => groupFilter === 'all' || (groupFilter === 'ungrouped' ? !f.group_id : f.group_id === groupFilter))
                .map((f, i) => {
                const on = picked.has(f.id);
                const a = displayFieldArea(f, settings.unitSystem);
                return (
                  <div key={f.id} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line-soft)', background: on ? 'var(--forest-soft)' : 'var(--card)' }}>
                    <button
                      type="button"
                      onClick={() => toggleField(f.id)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                    >
                      <span style={{ width: 20, height: 20, borderRadius: 5, border: on ? 'none' : '1.5px solid var(--stone)', background: on ? 'var(--forest)' : 'transparent', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13 }}>
                        {on ? '✓' : ''}
                      </span>
                      <span style={{ flex: 1 }}>
                        <span style={{ display: 'block', fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>{f.name}</span>
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{fmt(a.value, 1)} {a.unit}</span>
                      </span>
                    </button>
                    {on && showPerField && type !== 'lime' && (
                      <div style={{ padding: '0 13px 11px 44px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min="0"
                          className="input"
                          style={{ width: 110 }}
                          placeholder={`${numericRate || ''}`}
                          value={overrides[f.id] ?? ''}
                          onChange={(e) => setOverrides((prev) => ({ ...prev, [f.id]: e.target.value }))}
                        />
                        <span style={{ fontSize: 12, color: overrides[f.id] ? 'var(--muted)' : 'var(--amber, #7A5B12)' }}>
                          {displayUnit}{overrides[f.id] ? '' : (numericRate ? ` (default ${numericRate})` : ' — needs a rate')}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {type === 'lime' ? (
          <div style={{ marginBottom: 14 }}>
            <div className="label">Rate (t/ac)</div>
            <select className="select" value={limeRate} onChange={(e) => setLimeRate(parseFloat(e.target.value))}>
              {LIME_RATES.map((r) => <option key={r} value={r}>{r} t/ac</option>)}
            </select>
            {!isBatch && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
              {(() => {
                const a = displayFieldArea(field, settings.unitSystem);
                return `= ${fmt(totalQty.value, 1)} t total over ${fmt(a.value, 1)} ${a.unit}`;
              })()}
            </div>
            )}
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <div className="label">
              {!isBatch ? `Rate (${displayUnit})`
                : showPerField ? `Default rate (${displayUnit}) — optional`
                : `Rate for all fields (${displayUnit})`}
            </div>
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
            {!isBatch && numericRate > 0 && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                {(() => {
                  const a = displayFieldArea(field, settings.unitSystem);
                  return `= ${fmt(totalQty.value)} ${totalQty.unit} total over ${fmt(a.value, 1)} ${a.unit}`;
                })()}
              </div>
            )}
            {isBatch && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                {showPerField
                  ? 'Optional fallback for any field below you leave blank. Set each field\u2019s rate above.'
                  : 'Applied to each ticked field. You can adjust individual fields below.'}
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
          <Link href={isBatch ? '/' : `/fields/${field.id}`} className="btn-ghost" style={{ flex: 1, textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Cancel</Link>
          <button type="submit" className="btn-primary" style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} disabled={!canSave}>
            <Save size={18} /> {submitting ? 'Saving…' : isBatch ? `Log on ${picked.size || ''} field${picked.size === 1 ? '' : 's'}` : isEdit ? 'Save changes' : 'Save entry'}
          </button>
        </div>
      </div>
    </form>
  );
}
