import { expect, it } from 'vitest';
import {
  createDemoWorkspace,
  cutMassBalance,
  importWorkspace,
  recordBatchEvent,
  recordCutYield,
  recordCureWeighIn,
} from './index';
import type { Workspace } from '@rmsc/worker-protocol';

const today = '2026-11-21';
const cutDate = '2026-11-18';
const retail = 'bar_5_2_oz';
const guest = 'bar_1_0_oz';
const batchId = 'B-DEMO-001';
const sizeCounts = { [retail]: 6, [guest]: 4 };
const weightGBySize = { [retail]: 900, [guest]: 114 };
const cut = { batchId, at: cutDate, sizeCounts, weightGBySize, scrapG: 42 };

function unmolded(): Workspace {
  const source = createDemoWorkspace();
  return {
    ...source,
    batches: [{ ...source.batches![0], status: 'unmolded' }],
  };
}

it('retains grouped cut weights independently of count, trim, and inventory', () => {
  const source = unmolded();
  const result = recordCutYield(source, cut, today);
  const batch = result.batches![0];
  expect(batch.bars_actual).toBe(10);
  expect(batch.yield_actual).toMatchObject({
    weight_g_by_size: weightGBySize,
    scrap_g: 42,
  });
  expect(result.inventory).toEqual(source.inventory);
  expect(cutMassBalance(batch)).toBeUndefined();
  const weighing = {
    resolution_g: 1 as const,
    actual_g: { oil: 1100 },
    suggested_g: { oil: 1100 },
  };
  expect(cutMassBalance({ ...batch, weighing })).toEqual({
    inputG: 1100,
    barsG: 1014,
    accountedG: 1056,
    gapG: 44,
  });
  for (const bad of [
    { [retail]: 0 },
    { [guest]: Infinity },
    { missing: 123 },
  ]) {
    expect(() =>
      recordCutYield(source, { ...cut, weightGBySize: bad }, today),
    ).toThrow();
  }
});

it('keeps dated readings and the cut baseline separate across backup and restore', () => {
  const baseline = recordCutYield(unmolded(), cut, today);
  const curing = recordBatchEvent(
    baseline,
    { batchId, eventType: 'cure_started', at: cutDate },
    today,
  );
  const first = {
    batchId,
    at: '2026-11-19',
    sizeCounts: { [retail]: 6 },
    weightGBySize: { [retail]: 880 },
  };
  const later = {
    batchId,
    at: '2026-11-20',
    sizeCounts: { [retail]: 5 },
    weightGBySize: { [retail]: 718 },
  };
  let result = recordCureWeighIn(curing, later, today);
  result = recordCureWeighIn(result, first, today);
  expect(recordCureWeighIn(result, first, today)).toBe(result);
  expect(result.batches![0].yield_actual).toEqual(
    baseline.batches![0].yield_actual,
  );
  expect(result.batches![0].cure_weigh_ins?.map((entry) => entry.at)).toEqual([
    first.at,
    later.at,
  ]);
  expect(result.batches![0].bars_actual).toBe(10);
  expect(result.inventory).toEqual(curing.inventory);
  expect(importWorkspace(JSON.stringify(result)).batches).toEqual(
    result.batches,
  );

  expect(() =>
    recordCureWeighIn(
      result,
      { ...first, weightGBySize: { [retail]: 400 } },
      today,
    ),
  ).toThrow(/already recorded/i);
  const corrupt = structuredClone(result);
  const original = corrupt.batches![0];
  expect(() =>
    importWorkspace(
      JSON.stringify({
        ...corrupt,
        batches: [
          {
            ...original,
            cure_weigh_ins: [
              ...original.cure_weigh_ins!,
              original.cure_weigh_ins![0],
            ],
          },
        ],
      }),
    ),
  ).toThrow(/distinct dates/i);
});

it('accepts a release weigh-in without requiring old cut weights and rejects out-of-range entries', () => {
  const baseline = recordCutYield(
    unmolded(),
    { ...cut, weightGBySize: undefined },
    today,
  );
  expect(baseline.batches![0].yield_actual?.weight_g_by_size).toBeUndefined();
  const input = {
    batchId,
    at: today,
    sizeCounts: { [guest]: 4 },
    weightGBySize: { [guest]: 104 },
  };
  expect(() => recordCureWeighIn(baseline, input, today)).toThrow(
    /during cure/i,
  );
  const curing = recordBatchEvent(
    baseline,
    { batchId, eventType: 'cure_started', at: cutDate },
    today,
  );
  const cured = recordBatchEvent(
    curing,
    { batchId, eventType: 'cure_completed' },
    today,
  );
  expect(
    recordCureWeighIn(cured, input, today).batches![0].cure_weigh_ins,
  ).toHaveLength(1);
  for (const at of ['2026-11-17', '2026-11-22'])
    expect(() => recordCureWeighIn(curing, { ...input, at }, today)).toThrow(
      /date/i,
    );
  for (const count of [0, 4.5, 5])
    expect(() =>
      recordCureWeighIn(
        curing,
        { ...input, sizeCounts: { [guest]: count } },
        today,
      ),
    ).toThrow();
});
