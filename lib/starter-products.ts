import { ProductType, ProductCategory } from '@/lib/types';

/**
 * A small, editable set of common UK grassland/arable products so a new farm's
 * Plan can produce real numbers immediately instead of starting from an empty
 * product list. Bag-fert analyses are textbook; the two organics use RB209
 * (2023) typical values and are clearly flagged in the UI as starting points to
 * edit to the farm's own analysis. Seeding skips any name the user already has.
 */
export type StarterProduct = {
  name: string;
  type: ProductType;
  category: ProductCategory;
  dm_pct?: number;
  form?: 'granular';
  n_pct?: number; p2o5_pct?: number; k2o_pct?: number; s_pct?: number;
  n_kg_per_m3?: number; p2o5_kg_per_m3?: number; k2o_kg_per_m3?: number; so3_kg_per_m3?: number; mgo_kg_per_m3?: number;
  n_kg_per_t?: number; p2o5_kg_per_t?: number; k2o_kg_per_t?: number; so3_kg_per_t?: number; mgo_kg_per_t?: number;
};

export const STARTER_PRODUCTS: StarterProduct[] = [
  // Straight N
  { name: 'CAN (27-0-0)', type: 'bag_fert', category: 'bag_fert', form: 'granular', n_pct: 27, p2o5_pct: 0, k2o_pct: 0, s_pct: 0 },
  { name: 'Ammonium nitrate (34.5-0-0)', type: 'bag_fert', category: 'bag_fert', form: 'granular', n_pct: 34.5, p2o5_pct: 0, k2o_pct: 0, s_pct: 0 },
  { name: 'Urea (46-0-0)', type: 'bag_fert', category: 'bag_fert', form: 'granular', n_pct: 46, p2o5_pct: 0, k2o_pct: 0, s_pct: 0 },
  // Straight P / K
  { name: 'MOP (0-0-60)', type: 'bag_fert', category: 'bag_fert', form: 'granular', n_pct: 0, p2o5_pct: 0, k2o_pct: 60, s_pct: 0 },
  { name: 'TSP (0-46-0)', type: 'bag_fert', category: 'bag_fert', form: 'granular', n_pct: 0, p2o5_pct: 46, k2o_pct: 0, s_pct: 0 },
  { name: 'DAP (18-46-0)', type: 'bag_fert', category: 'bag_fert', form: 'granular', n_pct: 18, p2o5_pct: 46, k2o_pct: 0, s_pct: 0 },
  // Compounds
  { name: '0-20-30', type: 'bag_fert', category: 'bag_fert', form: 'granular', n_pct: 0, p2o5_pct: 20, k2o_pct: 30, s_pct: 0 },
  { name: '20-10-10', type: 'bag_fert', category: 'bag_fert', form: 'granular', n_pct: 20, p2o5_pct: 10, k2o_pct: 10, s_pct: 0 },
  { name: '25-5-5', type: 'bag_fert', category: 'bag_fert', form: 'granular', n_pct: 25, p2o5_pct: 5, k2o_pct: 5, s_pct: 0 },
  // Organics (RB209 2023 typical — edit to your analysis)
  { name: 'Cattle slurry (6% DM)', type: 'slurry', category: 'dairy_slurry', dm_pct: 6, n_kg_per_m3: 2.6, p2o5_kg_per_m3: 1.2, k2o_kg_per_m3: 3.2, so3_kg_per_m3: 0.7, mgo_kg_per_m3: 0.6 },
  { name: 'Cattle FYM', type: 'solid_manure', category: 'fym', dm_pct: 25, n_kg_per_t: 6.0, p2o5_kg_per_t: 3.2, k2o_kg_per_t: 9.4, so3_kg_per_t: 3.0, mgo_kg_per_t: 1.8 },
];
