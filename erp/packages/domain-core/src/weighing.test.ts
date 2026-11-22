import { describe, expect, it } from 'vitest';
import {
  calculateBatch,
  createDemoWorkspace,
  importWorkspace,
  recordBatchEvent,
  recordProductionStep,
  runCosting,
  savePlannedBatch,
  wholeGramTargets,
  enableBatchWeighing,
  correctAdditiveOmission,
  runCapacityAudit,
} from './index';
import type {
  NumericMap,
  ProductionStep,
} from '../../worker-protocol/src/index';

const today = '2026-11-15';
const at = `${today}T20:00:00.000Z`;
function prepare() {
  const w = createDemoWorkspace();
  const c = calculateBatch(w, {
    recipeId: 'BSR-DEMO-001',
    volumeIn3: 120,
    fragrancePct: 0,
    weighingResolutionG: 1,
    molds: [
      { id: 'retail', label: 'Retail', barSize: 'bar_5_2_oz', volumeIn3: 120 },
    ],
  });
  return recordBatchEvent(
    savePlannedBatch(w, c, today, 'W'),
    { batchId: 'W', eventType: 'prepped' },
    today,
  );
}
function record(
  w: ReturnType<typeof prepare>,
  step: ProductionStep,
  actualWeightsG?: NumericMap,
  material?: string,
) {
  return recordProductionStep(
    w,
    { batchId: 'W', step, actualWeightsG, material },
    at,
  );
}
describe('whole-gram production weighing', () => {
  it('reverses a confirmed additive after pour at its frozen cost without changing the timeline', () => {
    const material = 'kaolin_clay';
    let w = prepare();
    for (const step of [
      'oils_ready',
      'lye_ready',
      'mixed',
      'trace',
      'pour_started',
    ] as const)
      w = record(w, step);
    w = record(w, 'additive', { [material]: 14 }, material);
    w = record(w, 'pour_finished');
    const old = w.batches!.at(-1)!;
    const stock = w.inventory.additives![material];
    w = {
      ...w,
      inventory: {
        ...w.inventory,
        additives: {
          ...w.inventory.additives,
          [material]: { ...stock, avg_cost_per_unit: 0.25 },
        },
      },
    };
    const input = {
      batchId: 'W',
      material,
      expectedAt: at,
      expectedWeightG: 14,
      reason: 'Left it out',
    };
    const result = correctAdditiveOmission(w, input, at);
    const updated = result.batches!.at(-1)!;
    const returned = result.inventory.additives![material];
    expect(returned.on_hand).toBe(stock.on_hand! + 14);
    expect(returned.avg_cost_per_unit! * returned.on_hand!).toBeCloseTo(
      stock.on_hand! * 0.25 + old.consumption_costs![material],
      6,
    );
    expect(updated.weighing!.actual_g[material]).toBe(0);
    expect(updated.material_usage_g![material]).toBe(0);
    expect(updated.consumption_costs![material]).toBe(0);
    expect(updated.total_mass_g).toBe(old.total_mass_g! - 14);
    expect(updated.production).toEqual(old.production);
    expect(updated.events).toEqual(old.events);
    expect(result.inventory.raw_materials).toEqual(w.inventory.raw_materials);
    expect(result.integrity!.audit.at(-1)!.action).toContain('Left it out');
    expect(() => correctAdditiveOmission(result, input, at)).toThrow(
      /changed/i,
    );
    expect(() =>
      correctAdditiveOmission(w, { ...input, expectedWeightG: 13 }, at),
    ).toThrow(/changed/i);
  });
  it('enables weighing on an existing unstarted plan without replacing its identity or precise snapshot', () => {
    const source = createDemoWorkspace();
    const c = calculateBatch(source, {
      recipeId: 'BSR-DEMO-001',
      volumeIn3: 120,
      fragrancePct: 0,
      molds: [
        { id: 'm', label: 'Retail', barSize: 'bar_5_2_oz', volumeIn3: 120 },
      ],
    });
    const old = savePlannedBatch(source, c, today, 'W');
    const w = enableBatchWeighing(old, 'W');
    const b = w.batches!.at(-1)!;
    expect(b.id).toBe('W');
    expect(b.formulation).toEqual(c);
    expect(b.status).toBe('planned');
    expect(w.inventory).toEqual(old.inventory);
    expect(b.weighing!.actual_g).toEqual({});
    expect(enableBatchWeighing(w, 'W')).toEqual(w);
    const started = recordBatchEvent(
      old,
      { batchId: 'W', eventType: 'prepped' },
      today,
    );
    expect(() => enableBatchWeighing(started, 'W')).toThrow(/unstarted/i);
  });
  it('checks capacity against whole-gram targets instead of fractional suggestions', () => {
    const w = prepare();
    const calc = w.batches!.at(-1)!.formulation!;
    const target = wholeGramTargets(calc).castor_oil;
    const short = {
      ...w,
      inventory: {
        ...w.inventory,
        raw_materials: {
          ...w.inventory.raw_materials,
          castor_oil: {
            unit: 'g',
            on_hand: target - 0.1,
            avg_cost_per_unit: 1,
          },
        },
      },
    };
    expect(
      runCapacityAudit(short, calc.inputs).shortages.castor_oil.required_g,
    ).toBe(target);
  });
  it('balances suggested oil grams without altering precise formulation quantities', () => {
    const w = prepare();
    const batch = w.batches!.at(-1)!;
    const targets = wholeGramTargets(batch.formulation!);
    const oils = Object.keys(batch.formulation!.oils_g!);
    expect(oils.reduce((n, m) => n + targets[m], 0)).toBe(
      Math.round(batch.formulation!.total_oils_g),
    );
    expect(Object.values(targets).every(Number.isInteger)).toBe(true);
    expect(batch.formulation!.materials_required_g.olive_oil).not.toBe(
      targets.olive_oil,
    );
    expect(w.inventory).toEqual(createDemoWorkspace().inventory);
    expect(batch.inventory_deducted).toBe(false);
  });
  it('consumes actual weights once when a preparation stream is confirmed', () => {
    let w = prepare();
    const grams = {
      olive_oil: 460,
      coconut_oil: 280,
      lard: 460,
      castor_oil: 90,
    };
    w = record(w, 'oils_ready', grams);
    expect(w.inventory.raw_materials!.olive_oil.on_hand).toBeCloseTo(5.54);
    expect(w.batches!.at(-1)!.weighing!.actual_g).toEqual(grams);
    expect(w.batches!.at(-1)!.oil_weight_g).toBe(1290);
    expect(w.batches!.at(-1)!.inventory_deducted).toBe(false);
    expect(record(w, 'oils_ready', grams)).toEqual(w);
    expect(() => record(w, 'oils_ready', { ...grams, olive_oil: 461 })).toThrow(
      /conflict/i,
    );
    const frozen = w.batches!.at(-1)!.consumption_costs!.olive_oil;
    w = {
      ...w,
      inventory: {
        ...w.inventory,
        raw_materials: {
          ...w.inventory.raw_materials,
          olive_oil: { unit: 'kg', on_hand: 5.54, avg_cost_per_unit: 900 },
        },
      },
    };
    w = record(w, 'lye_ready');
    w = record(w, 'mixed');
    w = record(w, 'trace');
    w = record(w, 'additive', { kaolin_clay: 12 }, 'kaolin_clay');
    expect(w.batches!.at(-1)!.inventory_deducted).toBe(true);
    expect(w.batches!.at(-1)!.consumption_costs!.olive_oil).toBe(frozen);
    w = runCosting(w, { batchId: 'W' });
    expect(w.batches!.at(-1)!.costed).toBe(true);
    expect(
      importWorkspace(JSON.stringify(w)).batches!.at(-1)!.weighing,
    ).toEqual(w.batches!.at(-1)!.weighing);
  });
  it('rejects shortages, invalid grams, incomplete groups, and unplanned ingredients atomically', () => {
    const w = prepare();
    const grams = {
      olive_oil: 460,
      coconut_oil: 280,
      lard: 460,
      castor_oil: 90,
    };
    for (const n of [-1, 1.2, NaN, Infinity, 99999])
      expect(() =>
        record(w, 'oils_ready', { ...grams, olive_oil: n }),
      ).toThrow();
    expect(() => record(w, 'oils_ready', { olive_oil: 460 })).toThrow(
      /complete/i,
    );
    expect(() => record(w, 'oils_ready', { ...grams, honey: 1 })).toThrow(
      /complete/i,
    );
    expect(w.inventory).toEqual(createDemoWorkspace().inventory);
    expect(() => record(w, 'mixed', grams)).toThrow();
  });
  it('does not mark partial material costs complete or silently round sub-gram requirements to zero', () => {
    let w = record(prepare(), 'oils_ready');
    w = runCosting(w, { batchId: 'W' });
    expect(w.batches!.at(-1)!.costed).toBe(false);
    expect(w.batches!.at(-1)!.missing_material_costs).toContain(
      'Unconfirmed actual weights',
    );
    const b = w.batches!.at(-1)!;
    const tiny = {
      ...b,
      formulation: {
        ...b.formulation!,
        materials_required_g: {
          ...b.formulation!.materials_required_g,
          kaolin_clay: 0.4,
        },
      },
      weighing: {
        ...b.weighing!,
        suggested_g: { ...b.weighing!.suggested_g, kaolin_clay: 0 },
      },
    };
    expect(() =>
      record({ ...w, batches: [tiny] }, 'additive', undefined, 'kaolin_clay'),
    ).toThrow(/finer scale/i);
  });
  it('rejects corrupted actual weights on restore', () => {
    const w = record(prepare(), 'oils_ready');
    const b = w.batches!.at(-1)!;
    expect(() =>
      importWorkspace(
        JSON.stringify({
          ...w,
          batches: [
            {
              ...b,
              weighing: {
                ...b.weighing,
                actual_g: { ...b.weighing!.actual_g, olive_oil: 1.5 },
              },
            },
          ],
        }),
      ),
    ).toThrow(/whole/i);
  });
});
