import type { ProductType, RateUnit } from './types';

// ---------------------------------------------------------------------------
// Job-type registry — the SINGLE source of truth for what kinds of job sheets
// exist. The builder, the recipient view and the commit logic all read this,
// so adding a new type later is ONE entry here, with no other changes to the
// jobs section. (Application-based types are driven by the product catalogue;
// a new product type only needs a new entry below to appear as a job type.)
//
// commitsTo tells the approval step which record a completed field becomes:
//   'applications'  → a nutrient application (product + rate)
//   'spray_records' → a spray record (tank mix + water)
//   'none'          → no record (a plain task)
// ---------------------------------------------------------------------------

export type JobTypeId = 'slurry' | 'manure' | 'fertiliser' | 'lime' | 'spray' | 'generic';

export interface JobTypeDef {
  id: JobTypeId;
  label: string;
  /** lucide-react icon name; mapped to a component in the UI. */
  icon: string;
  /** Product types selectable for this job (application-based). null = no product. */
  productTypes: ProductType[] | null;
  /** Default rate unit + the noun shown next to the rate input. null = no rate. */
  defaultUnit: RateUnit | null;
  rateNoun: string | null;
  /** Where an approved, completed field on this job gets written. */
  commitsTo: 'applications' | 'spray_records' | 'none';
  /** One-line hint shown in the builder. */
  hint: string;
}

export const JOB_TYPES: JobTypeDef[] = [
  { id: 'slurry',     label: 'Slurry',      icon: 'Droplets',     productTypes: ['slurry'],        defaultUnit: 'm3/ha', rateNoun: 'm³/ha', commitsTo: 'applications',  hint: 'Apply a slurry at a set rate' },
  { id: 'manure',     label: 'Muck / FYM',  icon: 'Layers',       productTypes: ['solid_manure'],  defaultUnit: 't/ha',  rateNoun: 't/ha',  commitsTo: 'applications',  hint: 'Spread a solid manure' },
  { id: 'fertiliser', label: 'Fertiliser',  icon: 'Sprout',       productTypes: ['bag_fert'],      defaultUnit: 'kg/ha', rateNoun: 'kg/ha', commitsTo: 'applications',  hint: 'Spread a bagged fertiliser' },
  { id: 'lime',       label: 'Lime',        icon: 'Mountain',     productTypes: ['lime'],          defaultUnit: 't/ha',  rateNoun: 't/ha',  commitsTo: 'applications',  hint: 'Apply lime' },
  { id: 'spray',      label: 'Spray',       icon: 'SprayCan',     productTypes: null,              defaultUnit: 'l/ha',  rateNoun: 'L/ha',  commitsTo: 'spray_records', hint: 'Spray a product or tank mix' },
  { id: 'generic',    label: 'Other job',   icon: 'ClipboardList', productTypes: null,             defaultUnit: null,    rateNoun: null,    commitsTo: 'none',          hint: 'Any other task — describe it' },
];

export function jobTypeDef(id: string): JobTypeDef | undefined {
  return JOB_TYPES.find((t) => t.id === id);
}

/** Job types that apply a product, paired with the product types they accept. */
export function applicationJobTypes(): JobTypeDef[] {
  return JOB_TYPES.filter((t) => t.commitsTo === 'applications');
}
