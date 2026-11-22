import { describe, expect, it } from 'vitest';
import { createDemoWorkspace } from './seed-data';
import {
  calculateBatch,
  importWorkspace,
  recordBatchEvent,
  recordNextBatchEvent,
  recordCutYield,
  postFinishedGoods,
  applyReceiptToInventory,
  buildReports,
  runCosting,
  savePlannedBatch,
  normalizeReceiptRecord,
  recordReceipt,
} from './domain';

describe('business integrity regressions', () => {
  it('uses recipe water/oil defaults unless a lye ratio is explicitly requested', () => {
    const w = createDemoWorkspace();
    const base = {
      ...w.base_recipes![0],
      liquid: { default_type: 'distilled_water', default_ratio: 0.33 },
    };
    const data = { ...w, base_recipes: [base] };
    const input = { recipeId: base.id, volumeIn3: 100, fragrancePct: 0 };
    const actual = calculateBatch(data, input);
    expect(
      actual.materials_required_g['distilled_water'] / actual.total_oils_g,
    ).toBeCloseTo(0.33, 6);
    const override = calculateBatch(data, { ...input, lyeRatio: 2 });
    expect(
      override.materials_required_g['distilled_water'] /
        override.materials_required_g['naoh'],
    ).toBeCloseTo(2, 6);
  });
  it('rejects malformed nested data in otherwise supported backups', () => {
    const w = createDemoWorkspace();
    expect(() =>
      importWorkspace(JSON.stringify({ ...w, assets: 'bad' })),
    ).toThrow(/array/);
    expect(() =>
      importWorkspace(
        JSON.stringify({
          ...w,
          batches: [{ ...w.batches![0], formulation: 'bad' }],
        }),
      ),
    ).toThrow(/snapshot/);
    expect(() =>
      importWorkspace(
        JSON.stringify({
          ...w,
          batches: [{ ...w.batches![0], base_recipe_id: 'missing' }],
        }),
      ),
    ).toThrow(/recipe/);
  });
  it('normalizes receipt aliases, taxes and rejects conflicting totals', () => {
    const r = {
      id: 'R',
      date: '2026-11-12',
      vendor: 'Demo',
      payment_method: 'cash',
      total_usd: 11,
      tax_usd: 1,
      items: [
        {
          name: 'Oil',
          material: 'olive_oil',
          category: 'raw_material',
          quantity: 1,
          unit: 'kg',
          amount_usd: 10,
          account: 'inventory',
        },
      ],
    };
    expect(normalizeReceiptRecord(r).total).toBe(11);
    expect(normalizeReceiptRecord(r).items[0].total).toBe(10);
    expect(() => normalizeReceiptRecord({ ...r, total: 12 })).toThrow(
      /conflicting/i,
    );
    expect(() =>
      normalizeReceiptRecord({ ...r, items: [{ ...r.items[0], total: 9 }] }),
    ).toThrow(/conflicting/i);
  });
  it('costs volume inventory using density and rejects unrecognized units', () => {
    const w = createDemoWorkspace();
    const litres = {
      ...w,
      inventory: {
        ...w.inventory,
        raw_materials: {
          ...w.inventory.raw_materials,
          olive_oil: {
            unit: 'L',
            on_hand: 6 / 0.91,
            avg_cost_per_unit: 6.4 * 0.91,
          },
        },
      },
    };
    const input = { recipeId: 'PR-DEMO-001', volumeIn3: 57.62 };
    expect(
      calculateBatch(litres, input).costing.total_material_cost,
    ).toBeCloseTo(calculateBatch(w, input).costing.total_material_cost, 4);
    expect(() =>
      recordReceipt(
        w,
        {
          vendor: 'Demo',
          date: '2026-11-12',
          paymentMethod: 'cash',
          itemName: 'Oil',
          material: 'olive_oil',
          quantity: 1,
          unit: 'bag',
          total: 10,
        },
        '2026-11-12',
        'R-bad',
      ),
    ).toThrow(/unit/i);
  });
  it('does not reprice consumed materials after later purchases', () => {
    let w = createDemoWorkspace();
    w = savePlannedBatch(
      w,
      calculateBatch(w, { recipeId: 'PR-DEMO-001', volumeIn3: 57.62 }),
      '2026-11-12',
    );
    const id = w.batches!.at(-1)!.id;
    w = recordNextBatchEvent(w, id, '2026-11-12');
    const cost = runCosting(w, { batchId: id }).batches!.at(-1)!.total_cost;
    w = recordReceipt(
      w,
      {
        vendor: 'Demo',
        date: '2026-11-12',
        paymentMethod: 'cash',
        itemName: 'Oil',
        material: 'olive_oil',
        quantity: 10,
        unit: 'kg',
        total: 1000,
      },
      '2026-11-12',
      'R-new',
    );
    expect(runCosting(w, { batchId: id }).batches!.at(-1)!.total_cost).toBe(
      cost,
    );
  });
  it('allocates parent consumption to children without consuming base stock twice', () => {
    let w = createDemoWorkspace();
    w = savePlannedBatch(
      w,
      calculateBatch(w, { recipeId: 'PR-DEMO-001', volumeIn3: 57.62 }),
      '2026-11-12',
    );
    const parent = w.batches!.at(-1)!;
    w = {
      ...w,
      batches: [
        ...w.batches!,
        {
          ...parent,
          id: 'CHILD',
          parent_batch_id: parent.id,
          oil_weight_g: parent.oil_weight_g! / 2,
          extra_material_usage_g: { fragrance_oil: 1 },
        },
      ],
    };
    w = recordNextBatchEvent(w, parent.id, '2026-11-12');
    const stock = w.inventory.raw_materials;
    w = recordNextBatchEvent(w, 'CHILD', '2026-11-12');
    expect(w.inventory.raw_materials).toEqual(stock);
    const child = w.batches!.at(-1)!;
    expect(child.consumption_costs!.olive_oil).toBeCloseTo(
      w.batches!.find((b) => b.id === parent.id)!.consumption_costs!.olive_oil /
        2,
      5,
    );
    expect(() =>
      recordCutYield(
        w,
        {
          batchId: parent.id,
          sizeCounts: { bar_5_2_oz: 5 },
          scrapG: 0,
          shreddedG: 0,
        },
        '2026-11-12',
      ),
    ).toThrow(/leaf/i);
  });
  it('posts finished goods once through either entry point', () => {
    let w = createDemoWorkspace();
    w = savePlannedBatch(
      w,
      calculateBatch(w, { recipeId: 'PR-DEMO-001', volumeIn3: 57.62 }),
      '2026-11-12',
    );
    const id = w.batches!.at(-1)!.id;
    for (let i = 0; i < 3; i++) w = recordNextBatchEvent(w, id, '2026-11-12');
    w = recordCutYield(
      w,
      { batchId: id, sizeCounts: { bar_5_2_oz: 5 }, scrapG: 0, shreddedG: 0 },
      '2026-11-12',
    );
    w = recordNextBatchEvent(w, id, '2026-11-12');
    w = recordNextBatchEvent(w, id, '2026-11-12');
    w = runCosting(w, { batchId: id });
    w = recordNextBatchEvent(w, id, '2026-11-12');
    const once = w.inventory.finished_goods;
    expect(
      postFinishedGoods(w, { batchId: id }, '2026-11-12').inventory
        .finished_goods,
    ).toEqual(once);
    expect(Object.values(once!)[0].on_hand).toBe(5);
  });
  it('prep is idempotent and cannot overdraw stock', () => {
    const w = createDemoWorkspace();
    const calc = calculateBatch(w, {
      recipeId: 'PR-DEMO-001',
      volumeIn3: 57.62,
    });
    const planned = savePlannedBatch(w, calc, '2026-11-12');
    const id = planned.batches!.at(-1)!.id;
    const prep = recordNextBatchEvent(planned, id, '2026-11-12');
    expect(
      recordBatchEvent(
        prep,
        { batchId: id, eventType: 'prepped' },
        '2026-11-12',
      ),
    ).toEqual(prep);
    const empty = {
      ...planned,
      inventory: { ...planned.inventory, raw_materials: {} },
    };
    expect(() => recordNextBatchEvent(empty, id, '2026-11-12')).toThrow(
      /inventory/i,
    );
    expect(planned.inventory).toEqual(w.inventory);
  });
  it('rejects a corrupt or future backup before accepting it', () => {
    expect(() =>
      importWorkspace('{"version":999,"inventory":{},"assets":"bad"}'),
    ).toThrow();
  });
  it('consumes ingredients exactly once when preparing', () => {
    const w = createDemoWorkspace();
    const calc = calculateBatch(w, {
      recipeId: 'PR-DEMO-001',
      volumeIn3: 57.62,
    });
    const batch = {
      ...w.batches![0],
      material_usage_g: calc.materials_required_g,
      formulation: calc,
    };
    const next = recordNextBatchEvent(
      { ...w, batches: [batch] },
      batch.id,
      '2026-11-12',
    );
    expect(next.inventory.raw_materials!.olive_oil.on_hand).toBeLessThan(
      w.inventory.raw_materials!.olive_oil.on_hand!,
    );
  });
  it('does not advance cut without recorded actual yield', () => {
    const w = createDemoWorkspace();
    expect(() =>
      recordNextBatchEvent(
        { ...w, batches: [{ ...w.batches![0], status: 'unmolded' }] },
        'B-DEMO-001',
        '2026-11-12',
      ),
    ).toThrow();
  });
  it('does not post an uncured batch', () => {
    const w = createDemoWorkspace();
    expect(() =>
      postFinishedGoods(
        {
          ...w,
          batches: [
            {
              ...w.batches![0],
              status: 'cut',
              yield_actual: { size_counts: { bar_5_2_oz: 12 } },
            },
          ],
        },
        { batchId: 'B-DEMO-001' },
        '2026-11-12',
      ),
    ).toThrow();
  });
  it('requires an observed integer yield', () => {
    const w = createDemoWorkspace();
    expect(() =>
      recordCutYield(
        w,
        {
          batchId: 'B-DEMO-001',
          sizeCounts: { bar_5_2_oz: 1.5 },
          scrapG: 0,
          shreddedG: 0,
        },
        '2026-11-12',
      ),
    ).toThrow();
  });
  it('has consistent total mass and includes additives', () => {
    const c = calculateBatch(createDemoWorkspace(), {
      recipeId: 'PR-DEMO-001',
      volumeIn3: 57.62,
    });
    expect(c.materials_required_g.kaolin_clay).toBeGreaterThan(0);
    expect(
      Object.values(c.materials_required_g).reduce((a, b) => a + b, 0),
    ).toBeCloseTo(c.total_mass_g, 1);
  });
  it('applies a receipt only once', () => {
    const w = createDemoWorkspace();
    const receipt = { ...w.receipts![0], total: 27.55 };
    const once = applyReceiptToInventory(w, receipt);
    expect(applyReceiptToInventory(once, receipt).inventory).toEqual(
      once.inventory,
    );
  });
  it('does not amortize an asset before purchase or after useful life', () => {
    const w = {
      ...createDemoWorkspace(),
      assets: [
        {
          id: 'A',
          name: 'Mold',
          purchased_at: '2026-02-01',
          amount_usd: 120,
          useful_life_months: 2,
        },
      ],
    };
    expect(buildReports(w, '2026-01-31').monthlyAmortization).toBe(0);
    expect(buildReports(w, '2026-02-28').monthlyAmortization).toBe(60);
    expect(buildReports(w, '2026-04-01').monthlyAmortization).toBe(0);
  });
  it('costs a recorded oil weight rather than a default mold', () => {
    const w = createDemoWorkspace();
    const batch = runCosting(w, { batchId: 'B-DEMO-001' }).batches![0];
    const oils = ['olive_oil', 'coconut_oil', 'lard', 'castor_oil'].reduce(
      (a, k) => a + batch.material_usage_g![k],
      0,
    );
    expect(oils).toBeCloseTo(1800, 2);
  });
});
