import { describe, expect, it } from 'vitest';
import { createDemoWorkspace } from './seed-data';
import { transition } from './transition';
import {
  recordBatchEvent,
  recordCutYield,
  runCosting,
  postFinishedGoods,
  importWorkspace,
} from './domain';
import type {
  ProductionStep,
  Workspace,
} from '../../worker-protocol/src/index';
import { calendarDate } from './production';

const today = '2026-11-15';
const context = {
  today,
  nowIso: `${today}T18:00:00.000Z`,
  nextId: () => 'B-MIXED',
};
const input = {
  recipeId: 'BSR-DEMO-001',
  volumeIn3: 120,
  fragrancePct: 0,
  molds: [
    {
      id: 'retail',
      label: 'Retail column',
      barSize: 'bar_5_2_oz',
      volumeIn3: 100,
    },
    {
      id: 'guest',
      label: 'Hospitality column',
      barSize: 'bar_1_0_oz',
      volumeIn3: 20,
    },
  ],
};
function plan() {
  return transition(
    createDemoWorkspace(),
    { name: 'savePlannedBatch', payload: { input } },
    context,
  );
}
function step(
  w: Workspace,
  step: ProductionStep,
  seconds: number,
  material?: string,
) {
  return transition(
    w,
    {
      name: 'recordProductionStep',
      payload: { batchId: 'B-MIXED', step, material },
    },
    {
      ...context,
      nowIso: new Date(
        Date.parse(context.nowIso) + seconds * 1000,
      ).toISOString(),
    },
  );
}
function prepare() {
  return recordBatchEvent(
    plan(),
    { batchId: 'B-MIXED', eventType: 'prepped' },
    today,
  );
}

describe('one formulation split between molds', () => {
  it('backdates a pour end past a later omission record and corrects it without changing stock or lifecycle status', () => {
    let w = transition(
      plan(),
      { name: 'enableBatchWeighing', payload: { batchId: 'B-MIXED' } },
      context,
    );
    w = {
      ...recordBatchEvent(
        w,
        { batchId: 'B-MIXED', eventType: 'prepped' },
        today,
      ),
      timeZone: 'America/Denver',
    };
    w = step(w, 'oils_ready', 0);
    w = step(w, 'lye_ready', 1);
    w = step(w, 'mixed', 10);
    w = step(w, 'trace', 20);
    w = step(w, 'pour_started', 60);
    const nextDay = {
      ...context,
      today: '2026-11-16',
      nowIso: '2026-11-16T18:02:00.000Z',
    };
    w = transition(
      w,
      {
        name: 'recordProductionStep',
        payload: {
          batchId: 'B-MIXED',
          step: 'additive',
          material: 'kaolin_clay',
          actualWeightsG: { kaolin_clay: 0 },
        },
      },
      nextDay,
    );
    const endedAt = `${today}T18:01:10.000Z`;
    w = transition(
      w,
      {
        name: 'recordProductionStep',
        payload: { batchId: 'B-MIXED', step: 'pour_finished', at: endedAt },
      },
      nextDay,
    );
    const stock = w.inventory;
    expect(w.batches!.at(-1)!.poured_at).toBe(today);
    const payload = {
      batchId: 'B-MIXED',
      expectedAt: endedAt,
      at: '2026-11-16T08:30:00.000Z',
      reason: 'Corrected actual pour finish',
    };
    const correct = (changes = {}) =>
      transition(
        w,
        {
          name: 'correctPourEndTimestamp',
          payload: { ...payload, ...changes },
        },
        nextDay,
      );
    expect(() => correct({ expectedAt: context.nowIso })).toThrow(/changed/i);
    expect(() => correct({ at: `${today}T18:00:59.000Z` })).toThrow(
      /pour start/i,
    );
    expect(() => correct({ at: '2026-11-16T19:00:00.000Z' })).toThrow(
      /future/i,
    );
    expect(() => correct({ reason: '' })).toThrow(/reason/i);
    const corrected = correct();
    const b = corrected.batches!.at(-1)!;
    expect(b.status).toBe('poured');
    expect(b.poured_at).toBe('2026-11-16');
    expect(b.events!.find((e) => e.type === 'poured')!.at).toBe(b.poured_at);
    expect(b.weighing).toEqual(w.batches!.at(-1)!.weighing);
    expect(b.consumption_costs).toEqual(w.batches!.at(-1)!.consumption_costs);
    expect(corrected.inventory).toEqual(stock);
    expect(corrected.integrity!.audit.at(-1)!.action).toContain(endedAt);
    expect(
      importWorkspace(JSON.stringify(corrected)).batches!.at(-1)!.production!
        .pour_finished,
    ).toBe(payload.at);
    const estimated = correct({
      estimated: true,
      at: endedAt,
      reason: 'A few minutes after start',
    });
    const restored = importWorkspace(JSON.stringify(estimated)).batches!.at(
      -1,
    )!;
    expect(restored.production).toMatchObject({
      pour_finished: endedAt,
      pour_finished_estimated: true,
    });
    expect(restored.poured_at).toBe(today);
    expect(estimated.inventory).toEqual(stock);
    expect(estimated.integrity!.audit.at(-1)!.action).toContain('(estimated)');
    w = recordBatchEvent(
      w,
      { batchId: 'B-MIXED', eventType: 'unmolded' },
      today,
    );
    expect(() => correct()).toThrow(/lifecycle dates/i);
    w = {
      ...w,
      batches: w.batches!.map((batch) =>
        batch.id === 'B-MIXED' ? { ...batch, status: 'in_inventory' } : batch,
      ),
    };
    expect(() => correct()).toThrow(/locked/i);
  });
  it('corrects an accidental additive time with an audit trail and no repeated consumption', () => {
    let w = transition(
      plan(),
      { name: 'enableBatchWeighing', payload: { batchId: 'B-MIXED' } },
      context,
    );
    w = recordBatchEvent(
      w,
      { batchId: 'B-MIXED', eventType: 'prepped' },
      today,
    );
    w = step(w, 'oils_ready', 0);
    w = step(w, 'lye_ready', 1);
    w = step(w, 'additive', 2, 'kaolin_clay');
    w = step(w, 'mixed', 10);
    w = step(w, 'trace', 20);
    w = step(w, 'pour_started', 60);
    w = step(w, 'pour_finished', 70);
    const before = w;
    const payload = {
      batchId: 'B-MIXED',
      material: 'kaolin_clay',
      expectedAt: `${today}T18:00:02.000Z`,
      at: `${today}T18:00:50.000Z`,
      reason: 'Accidental early click; added 30 seconds after trace',
    };
    const correctionContext = { ...context, nowIso: `${today}T18:02:00.000Z` };
    const correct = (changes = {}) =>
      transition(
        w,
        {
          name: 'correctAdditiveTimestamp',
          payload: { ...payload, ...changes },
        },
        correctionContext,
      );
    expect(() => correct({ expectedAt: context.nowIso })).toThrow(/changed/i);
    expect(() => correct({ at: `${today}T18:03:00.000Z` })).toThrow(/future/i);
    expect(() => correct({ at: `${today}T18:01:11.000Z` })).toThrow(
      /completed pour/i,
    );
    expect(() => correct({ material: 'unknown' })).toThrow(/additive/i);
    expect(() => correct({ reason: ' ' })).toThrow(/reason/i);
    const corrected = correct();
    const oldBatch = before.batches!.at(-1)!;
    const batch = corrected.batches!.at(-1)!;
    expect(batch.production!.additives.kaolin_clay).toBe(payload.at);
    expect(batch.status).toBe('poured');
    expect(batch.weighing).toEqual(oldBatch.weighing);
    expect(batch.consumption_costs).toEqual(oldBatch.consumption_costs);
    expect(batch.consumption_fingerprint).toEqual(
      oldBatch.consumption_fingerprint,
    );
    expect(corrected.inventory).toEqual(before.inventory);
    expect(corrected.integrity!.audit.at(-1)!.action).toContain(
      payload.expectedAt,
    );
    expect(corrected.integrity!.audit.at(-1)!.action).toContain(payload.at);
    expect(
      importWorkspace(JSON.stringify(corrected)).batches!.at(-1)!.production,
    ).toEqual(batch.production);
    w = corrected;
    expect(() => correct()).toThrow(/changed/i);
  });
  it('uses the workspace local day across the UTC date boundary', () => {
    expect(calendarDate('2026-11-16T00:30:00.000Z', 'America/Denver')).toBe(
      '2026-11-15',
    );
    let w: Workspace = { ...prepare(), timeZone: 'America/Denver' };
    w = step(w, 'lye_ready', 0);
    w = step(w, 'oils_ready', 1);
    w = step(w, 'mixed', 2);
    w = step(w, 'trace', 3);
    w = step(w, 'additive', 4, 'kaolin_clay');
    w = step(w, 'pour_started', 5);
    w = transition(
      w,
      {
        name: 'recordProductionStep',
        payload: { batchId: 'B-MIXED', step: 'pour_finished' },
      },
      { ...context, nowIso: '2026-11-16T00:30:00.000Z' },
    );
    expect(w.batches!.at(-1)!['poured_at']).toBe('2026-11-15');
  });
  it('keeps a same-weight clay substitution explicit without inventing its density', () => {
    const source = createDemoWorkspace();
    const original = transition(
      source,
      { name: 'calculateBatch', payload: input },
      context,
    );
    const calc = transition(
      source,
      {
        name: 'calculateBatch',
        payload: {
          ...input,
          additiveSubstitutions: { kaolin_clay: 'french_green_clay' },
        },
      },
      context,
    );
    expect(calc.total_oils_g).toBe(original.total_oils_g);
    expect(calc.materials_required_g['french_green_clay']).toBe(
      original.materials_required_g['kaolin_clay'],
    );
    expect(calc.materials_required_g['kaolin_clay']).toBeUndefined();
    expect(calc.warnings!.join()).toMatch(/density is unverified/i);
    expect(source.base_recipes![0]['additives_pct']).toHaveProperty(
      'kaolin_clay',
    );
    expect(calc.recipe_snapshot!['additives_pct']).toHaveProperty(
      'french_green_clay',
    );
  });
  it('replaces only reviewed unstarted plans and preserves inventory', () => {
    const source = createDemoWorkspace();
    const payload = {
      input,
      replaceBatchIds: [source.batches![0].id],
      expectedRevision: 0,
    };
    const w = transition(
      source,
      { name: 'savePlannedBatch', payload },
      context,
    );
    expect(w.batches).toHaveLength(1);
    expect(w.inventory).toEqual(source.inventory);
    expect(w.integrity!.audit.at(-1)!.action).toContain(source.batches![0].id);
    expect(() =>
      transition(
        { ...source, revision: 1 },
        { name: 'savePlannedBatch', payload },
        context,
      ),
    ).toThrow(/changed/i);
    const prepped = recordBatchEvent(
      source,
      { batchId: source.batches![0].id, eventType: 'prepped' },
      today,
    );
    expect(() =>
      transition(prepped, { name: 'savePlannedBatch', payload }, context),
    ).toThrow(/unstarted/i);
  });
  it('sizes the complete formulation from mold volumes and freezes size geometry', () => {
    const w = plan();
    const b = w.batches!.at(-1)!;
    expect(b.volume_in3).toBe(120);
    expect(b.formulation!.molds!.map((m) => m.bars_expected)).toEqual([9, 9]);
    expect(b.formulation!.molds![0].bar_volume_in3).toBe(10.52);
    expect(w.batches!.filter((b) => b.id === 'B-MIXED')).toHaveLength(1);
    expect(() =>
      transition(
        w,
        {
          name: 'calculateBatch',
          payload: { ...input, molds: [input.molds[0], input.molds[0]] },
        },
        context,
      ),
    ).toThrow(/unique/i);
    expect(() =>
      transition(
        w,
        { name: 'calculateBatch', payload: { ...input, volumeIn3: 1 } },
        context,
      ),
    ).toThrow(/volume/i);
  });
  it('deducts once, prepares in either order, persists timestamps and rejects skipped or late steps', () => {
    let w = prepare();
    const stock = structuredClone(w.inventory);
    expect(() => step(w, 'mixed', 20)).toThrow(/ready/i);
    w = step(w, 'lye_ready', 1);
    w = step(w, 'oils_ready', 5);
    w = step(w, 'mixed', 10);
    w = step(w, 'trace', 130);
    expect(w.batches!.at(-1)!.production!.trace).toBe(`${today}T18:02:10.000Z`);
    expect(step(w, 'trace', 150)).toEqual(w);
    expect(() => step(w, 'pour_started', 9)).toThrow(/precede/i);
    expect(() => step(w, 'additive', 135, 'unknown')).toThrow(/additive/i);
    w = step(w, 'pour_started', 140);
    expect(() => step(w, 'pour_finished', 150)).toThrow(/additive/i);
    w = step(w, 'additive', 145, 'kaolin_clay');
    w = step(w, 'pour_finished', 160);
    expect(w.batches!.at(-1)!.status).toBe('poured');
    expect(w.inventory).toEqual(stock);
    expect(
      importWorkspace(JSON.stringify(w)).batches!.at(-1)!.production,
    ).toEqual(w.batches!.at(-1)!.production);
    expect(() => step(w, 'additive', 170, 'kaolin_clay')).not.toThrow();
  });
  it('prevents the old next button from bypassing production timestamps', () => {
    expect(() =>
      recordBatchEvent(
        prepare(),
        { batchId: 'B-MIXED', eventType: 'poured' },
        today,
      ),
    ).toThrow(/pour/i);
  });
  it('derives estimated trim, rejects excess yield and posts volume-weighted costs by size', () => {
    let w = prepare();
    w = step(w, 'oils_ready', 0);
    w = step(w, 'lye_ready', 1);
    w = step(w, 'mixed', 2);
    w = step(w, 'trace', 3);
    w = step(w, 'additive', 4, 'kaolin_clay');
    w = step(w, 'pour_started', 5);
    w = step(w, 'pour_finished', 6);
    w = recordBatchEvent(
      w,
      { batchId: 'B-MIXED', eventType: 'unmolded' },
      today,
    );
    const payload = {
      batchId: 'B-MIXED',
      sizeCounts: { bar_5_2_oz: 9, bar_1_0_oz: 9 },
      scrapG: 0,
      shreddedG: 0,
    };
    expect(() =>
      recordCutYield(w, { ...payload, sizeCounts: { bar_5_2_oz: 12 } }, today),
    ).toThrow(/exceed/i);
    w = recordCutYield(w, payload, today);
    expect(w.batches!.at(-1)!.yield_actual!.estimated_trim_in3).toBeCloseTo(
      6.87,
      4,
    );
    w = recordBatchEvent(
      w,
      { batchId: 'B-MIXED', eventType: 'cure_started' },
      today,
    );
    w = recordBatchEvent(
      w,
      { batchId: 'B-MIXED', eventType: 'cure_completed' },
      today,
    );
    w = runCosting(w, { batchId: 'B-MIXED' });
    const costs = w.batches!.at(-1)!.cost_per_bar_by_size!;
    expect(costs['bar_5_2_oz'] / costs['bar_1_0_oz']).toBeCloseTo(
      10.52 / 2.05,
      3,
    );
    w = postFinishedGoods(w, { batchId: 'B-MIXED' }, today);
    expect(
      w.inventory.finished_goods!['BSR-DEMO-001.bar_5_2_oz'].avg_cost_per_unit,
    ).toBeCloseTo(costs['bar_5_2_oz'], 3);
  });
  it('rejects malformed or out-of-order production logs on restore', () => {
    const w = prepare();
    const b = w.batches!.at(-1)!;
    expect(() =>
      importWorkspace(
        JSON.stringify({
          ...w,
          batches: [
            { ...b, production: { additives: {}, mixed: 'yesterday' } },
          ],
        }),
      ),
    ).toThrow(/timestamp/i);
    expect(() =>
      importWorkspace(
        JSON.stringify({
          ...w,
          batches: [
            { ...b, production: { additives: {}, trace: context.nowIso } },
          ],
        }),
      ),
    ).toThrow(/mixed/i);
  });
});
