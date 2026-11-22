import { expect, it } from 'vitest';
import { createDemoWorkspace } from './seed-data';
import { reconstructWorkspace } from './reconstruction';
import {
  calculateBatch,
  savePlannedBatch,
  recordNextBatchEvent,
  recordCutYield,
  runCosting,
} from './domain';

const now = '2026-11-12T00:00:00.000Z';
it('reconstructs consumed materials and finished goods to the same closing balances', () => {
  const opening = createDemoWorkspace();
  let history = savePlannedBatch(
    opening,
    calculateBatch(opening, { recipeId: 'PR-DEMO-001', volumeIn3: 57.62 }),
    '2026-11-12',
  );
  const id = history.batches!.at(-1)!.id;
  for (let i = 0; i < 3; i++)
    history = recordNextBatchEvent(history, id, '2026-11-12');
  history = recordCutYield(
    history,
    { batchId: id, sizeCounts: { bar_5_2_oz: 5 }, scrapG: 0, shreddedG: 0 },
    '2026-11-12',
  );
  history = recordNextBatchEvent(history, id, '2026-11-12');
  history = recordNextBatchEvent(history, id, '2026-11-12');
  history = runCosting(history, { batchId: id });
  history = recordNextBatchEvent(history, id, '2026-11-12');
  const proposal = reconstructWorkspace(
    history,
    {
      openingDate: '2026-11-01',
      openingInventory: opening.inventory,
      adjustments: [],
    },
    now,
  );
  expect(proposal.issues).toEqual([]);
  expect(proposal.workspace.inventory).toEqual(history.inventory);
  expect(proposal.workspace.integrity!.audit.at(-1)!.action).toContain(
    'reconstruction',
  );
});
it('preserves the current asset register when the stock history has no assets', () => {
  const current = createDemoWorkspace();
  const source = { ...current, assets: [] };
  const result = reconstructWorkspace(
    current,
    {
      openingDate: '2026-01-01',
      openingInventory: {},
      adjustments: [],
      sourceRaw: JSON.stringify(source),
    },
    now,
  );
  expect(result.workspace.assets).toEqual(current.assets);
});
it('replays receipts from explicit opening stock without changing the source', () => {
  const original = createDemoWorkspace();
  const result = reconstructWorkspace(
    original,
    { openingDate: '2026-01-01', openingInventory: {}, adjustments: [] },
    now,
  );
  expect(result.issues).toEqual([]);
  expect(result.workspace.inventory.raw_materials!.olive_oil.on_hand).toBe(
    2000,
  );
  expect(original.inventory.raw_materials!.olive_oil.on_hand).toBe(6);
  expect(
    result.workspace.integrity!.appliedReceipts['R-DEMO-001'],
  ).toBeTruthy();
});
it('blocks invented historical consumption and unsubstantiated finished stock', () => {
  const w = createDemoWorkspace();
  const result = reconstructWorkspace(
    { ...w, batches: [{ ...w.batches![0], status: 'in_inventory' }] },
    { openingDate: '2026-01-01', openingInventory: {}, adjustments: [] },
    now,
  );
  expect(result.issues.join(' ')).toMatch(/consumption date/);
  expect(result.issues.join(' ')).toMatch(/posting date/);
});
it('requires explicit valid reasons and prevents negative adjustments', () => {
  const result = reconstructWorkspace(
    createDemoWorkspace(),
    {
      openingDate: '2026-01-01',
      openingInventory: {},
      adjustments: [
        {
          id: 'ADJ',
          date: '2026-01-02',
          material: 'olive_oil',
          quantity: -1,
          unit: 'kg',
          amount_usd: -5,
          reason: 'Count correction',
        },
      ],
    },
    now,
  );
  expect(result.issues[0]).toMatch(/balance/);
});
