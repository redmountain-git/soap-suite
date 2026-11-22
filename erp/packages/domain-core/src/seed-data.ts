import type { Workspace } from '@rmsc/worker-protocol';
export function createDemoWorkspace(): Workspace {
  return structuredClone(DEMO_WORKSPACE);
}

export const DEMO_WORKSPACE = {
  version: 2,
  revision: 0,
  integrity: {
    appliedReceipts: {},
    finishedPosts: {},
    reviewIssues: [],
    audit: [],
  },
  name: 'Demo Soap Workspace',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-20',
  constants: {
    units: {
      g: { to_g: 1 },
      kg: { to_g: 1000 },
      lb: { to_g: 453.592 },
      oz: { to_g: 28.3495 },
      ml: { to_ml: 1 },
      L: { to_ml: 1000 },
      l: { to_ml: 1000 },
      in3: { to_ml: 16.387 },
      each: { to_each: 1 },
    },
    density: {
      olive_oil: 0.91,
      coconut_oil: 0.92,
      castor_oil: 0.96,
      lard: 0.92,
      naoh: 2.13,
      distilled_water: 1,
      fragrance_oil: 0.95,
      kaolin_clay: 0.6,
    },
    sap_values: {
      naoh: {
        olive_oil: 0.134,
        coconut_oil: 0.183,
        lard: 0.138,
        castor_oil: 0.128,
      },
    },
  },
  base_recipes: [
    {
      id: 'BSR-DEMO-001',
      name: 'Desert Demo Base',
      oils_pct: {
        olive_oil: 48,
        coconut_oil: 19,
        lard: 25,
        castor_oil: 8,
      },
      lye: {
        type: 'NaOH',
        purity_percent: 98,
        default_superfat_pct: 5,
      },
      liquid: {
        default_type: 'distilled_water',
        default_ratio: 0.31,
      },
      additives_pct: {
        kaolin_clay: 0.75,
      },
    },
  ],
  product_recipes: [
    {
      id: 'PR-DEMO-001',
      name: 'Trail Demo Bar',
      base_recipe_id: 'BSR-DEMO-001',
      line: 'signature',
      category: 'scented',
      fragrance: {
        type: 'fragrance_oil',
        default_percent: 4,
        max_percent: 5,
      },
      pricing_targets: {
        cost_per_bar_usd: 1.35,
        wholesale_usd: 4.5,
        retail_usd: 8,
      },
    },
  ],
  bar_sizes: {
    bar_1_0_oz: {
      display_name: '1.0 oz',
      active: true,
      role: 'Hospitality / guest bar',
      approx_volume_in3: 2.05,
    },
    bar_5_2_oz: {
      display_name: '5.2 oz',
      active: true,
      role: 'Retail bar',
      approx_volume_in3: 10.52,
    },
    bar_8_oz: {
      display_name: '8 oz',
      active: true,
      role: 'Specialty bar',
      approx_volume_in3: 16.22,
    },
  },
  inventory: {
    raw_materials: {
      olive_oil: { unit: 'kg', on_hand: 6, avg_cost_per_unit: 6.4 },
      coconut_oil: { unit: 'kg', on_hand: 4.5, avg_cost_per_unit: 5.8 },
      lard: { unit: 'kg', on_hand: 5, avg_cost_per_unit: 4.2 },
      castor_oil: { unit: 'g', on_hand: 900, avg_cost_per_unit: 0.032 },
      naoh: { unit: 'g', on_hand: 1400, avg_cost_per_unit: 0.02 },
      distilled_water: { unit: 'g', on_hand: 8000, avg_cost_per_unit: 0.001 },
    },
    additives: {
      fragrance_oil: { unit: 'g', on_hand: 800, avg_cost_per_unit: 0.045 },
      kaolin_clay: { unit: 'g', on_hand: 1000, avg_cost_per_unit: 0.012 },
    },
    finished_goods: {},
  },
  receipts: [
    {
      id: 'R-DEMO-001',
      date: '2026-01-15',
      vendor: 'Demo Supply',
      payment_method: 'debit_business',
      total: 27.55,
      tax_usd: 3.5,
      items: [
        {
          name: 'Olive Oil',
          category: 'raw_material',
          material: 'olive_oil',
          quantity: 2,
          unit: 'kg',
          total: 12.8,
          account: 'assets.inventory.raw_materials',
        },
        {
          name: 'Fragrance Oil',
          category: 'raw_material',
          material: 'fragrance_oil',
          quantity: 250,
          unit: 'g',
          total: 11.25,
          account: 'assets.inventory.additives',
        },
      ],
    },
  ],
  assets: [
    {
      id: 'A-DEMO-001',
      name: 'Column mold',
      purchased_at: '2026-01-10',
      amount_usd: 48,
      useful_life_months: 36,
    },
  ],
  batches: [
    {
      id: 'B-DEMO-001',
      date: '2026-01-20',
      recipe_id: 'PR-DEMO-001',
      base_recipe_id: 'BSR-DEMO-001',
      product_recipe_id: 'PR-DEMO-001',
      oil_weight_g: 1800,
      status: 'planned',
      bars_expected: 12,
      material_usage_g: {},
      extra_material_usage_g: {},
      events: [],
      yield_actual: null,
    },
  ],
} satisfies Workspace;
