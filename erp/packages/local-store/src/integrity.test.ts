import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { createDemoWorkspace } from '../../domain-core/src/seed-data';
import {
  executeCommand,
  readWorkspace,
  writeWorkspace,
  openDatabase,
} from './index';

beforeEach(async () => {
  const db = await openDatabase();
  await db.clear('documents');
  await db.clear('recovery');
  await db.clear('mutations');
  await db.clear('previews');
});
it('adds a recipe atomically with recovery and leaves batch records and stock untouched', async () => {
  const source = createDemoWorkspace();
  await writeWorkspace(source);
  const recipe = {
    id: 'BSR-905',
    name: 'Powdered milk draft',
    status: 'draft',
    review_required: ['Choose powder'],
    oils_pct: { olive_oil: 100 },
  };
  const request = {
    id: 1,
    command: 'addBaseRecipe' as const,
    mutationId: 'add-recipe',
    payload: {
      raw: JSON.stringify({
        app: 'red-mountain-soap-recipe',
        version: 1,
        recipe,
      }),
    },
  };
  const result = await executeCommand(request);
  expect(result.workspace.inventory).toEqual(source.inventory);
  expect(result.workspace.batches).toEqual(source.batches);
  expect(result.workspace.base_recipes!.at(-1)).toEqual(recipe);
  expect(
    (await (await openDatabase()).getAll('recovery')).length,
  ).toBeGreaterThan(0);
  const saved = await readWorkspace();
  await executeCommand(request);
  expect(await readWorkspace()).toEqual(saved);
  await expect(
    executeCommand({
      ...request,
      mutationId: 'conflict',
      payload: {
        raw: request.payload.raw.replace(
          'Powdered milk draft',
          'Different recipe',
        ),
      },
    }),
  ).rejects.toThrow(/not overwritten/i);
  expect(await readWorkspace()).toEqual(saved);
});
it('commits actual weighed groups once and rolls back an insufficient group', async () => {
  const source = createDemoWorkspace();
  await writeWorkspace(source);
  const planned = await executeCommand({
    id: 1,
    command: 'savePlannedBatch',
    payload: {
      input: {
        recipeId: 'BSR-DEMO-001',
        volumeIn3: 120,
        fragrancePct: 0,
        weighingResolutionG: 1,
        molds: [
          { id: 'm', label: 'Retail', barSize: 'bar_5_2_oz', volumeIn3: 120 },
        ],
      },
    },
  });
  const batchId = planned.workspace.batches!.at(-1)!.id;
  await executeCommand({
    id: 2,
    command: 'recordBatchEvent',
    payload: { batchId, eventType: 'prepped' },
  });
  expect((await readWorkspace())!.inventory).toEqual(source.inventory);
  const weights = {
    olive_oil: 460,
    coconut_oil: 280,
    lard: 460,
    castor_oil: 90,
  };
  const request = {
    id: 3,
    command: 'recordProductionStep' as const,
    mutationId: 'actual-oils',
    payload: { batchId, step: 'oils_ready' as const, actualWeightsG: weights },
  };
  await executeCommand(request);
  const weighed = await readWorkspace();
  await executeCommand(request);
  expect(await readWorkspace()).toEqual(weighed);
  await expect(
    executeCommand({
      id: 4,
      command: 'recordProductionStep',
      payload: {
        batchId,
        step: 'lye_ready',
        actualWeightsG: { naoh: 99999, distilled_water: 400 },
      },
    }),
  ).rejects.toThrow(/inventory/i);
  expect(await readWorkspace()).toEqual(weighed);
  expect(weighed!.batches!.at(-1)!.weighing!.actual_g).toEqual(weights);
  const added = await executeCommand({
    id: 5,
    command: 'recordProductionStep',
    payload: {
      batchId,
      step: 'additive',
      material: 'kaolin_clay',
      actualWeightsG: { kaolin_clay: 0 },
    },
  });
  const previous =
    added.workspace.batches!.at(-1)!.production!.additives.kaolin_clay;
  const correction = {
    id: 6,
    command: 'correctAdditiveTimestamp' as const,
    mutationId: 'correct-clay-time',
    payload: {
      batchId,
      material: 'kaolin_clay',
      expectedAt: previous,
      at: new Date(Date.parse(previous) - 1).toISOString(),
      reason: 'Correct accidental timestamp',
    },
  };
  await executeCommand(correction);
  const corrected = await readWorkspace();
  expect(corrected!.inventory).toEqual(weighed!.inventory);
  expect(corrected!.batches!.at(-1)!.weighing!.actual_g.kaolin_clay).toBe(0);
  await executeCommand(correction);
  expect(await readWorkspace()).toEqual(corrected);
  await expect(
    executeCommand({ ...correction, mutationId: 'stale-correction' }),
  ).rejects.toThrow(/changed/i);
  expect(await readWorkspace()).toEqual(corrected);
});
it('persists parallel production steps, deduplicates retries, and aborts invalid transitions', async () => {
  await writeWorkspace(createDemoWorkspace());
  const result = await executeCommand({
    id: 1,
    command: 'savePlannedBatch',
    mutationId: 'plan-molds',
    payload: {
      input: {
        recipeId: 'BSR-DEMO-001',
        volumeIn3: 120,
        fragrancePct: 0,
        molds: [
          {
            id: 'retail',
            label: 'Retail',
            barSize: 'bar_5_2_oz',
            volumeIn3: 100,
          },
          { id: 'guest', label: 'Guest', barSize: 'bar_1_0_oz', volumeIn3: 20 },
        ],
      },
    },
  });
  const batchId = result.workspace.batches!.at(-1)!.id;
  await executeCommand({
    id: 2,
    command: 'recordBatchEvent',
    payload: { batchId, eventType: 'prepped' },
  });
  const before = await readWorkspace();
  await expect(
    executeCommand({
      id: 3,
      command: 'recordProductionStep',
      payload: { batchId, step: 'mixed' },
    }),
  ).rejects.toThrow(/ready/);
  expect(await readWorkspace()).toEqual(before);
  await Promise.all(
    (['lye_ready', 'oils_ready'] as const).map((step, id) =>
      executeCommand({
        id: id + 4,
        command: 'recordProductionStep',
        mutationId: step,
        payload: { batchId, step },
      }),
    ),
  );
  const request = {
    id: 6,
    command: 'recordProductionStep' as const,
    mutationId: 'mix-once',
    payload: { batchId, step: 'mixed' as const },
  };
  await executeCommand(request);
  const mixed = await readWorkspace();
  await executeCommand(request);
  expect(await readWorkspace()).toEqual(mixed);
  expect(mixed!.batches!.at(-1)!.production!.mixed).toBeTruthy();
  expect(mixed!.inventory).toEqual(before!.inventory);
  for (const step of [
    'trace',
    'additive',
    'pour_started',
    'pour_finished',
  ] as const)
    await executeCommand({
      id: 7,
      command: 'recordProductionStep',
      payload: {
        batchId,
        step,
        ...(step === 'additive' ? { material: 'kaolin_clay' } : {}),
      },
    });
  const finished = (await readWorkspace())!;
  const log = finished.batches!.at(-1)!.production!;
  const correction = {
    id: 8,
    command: 'correctPourEndTimestamp' as const,
    mutationId: 'pour-end-correction',
    payload: {
      batchId,
      expectedAt: log.pour_finished!,
      at: log.pour_started!,
      reason: 'Actual pour finish from notes',
    },
  };
  await executeCommand(correction);
  const corrected = await readWorkspace();
  expect(corrected!.inventory).toEqual(finished.inventory);
  await executeCommand(correction);
  expect(await readWorkspace()).toEqual(corrected);
  await expect(
    executeCommand({
      ...correction,
      mutationId: 'conflicting-pour-end',
      payload: { ...correction.payload, at: log.mixed! },
    }),
  ).rejects.toThrow(/changed/i);
  expect(await readWorkspace()).toEqual(corrected);
});
it('serializes concurrent read/modify/write commands', async () => {
  await writeWorkspace(createDemoWorkspace());
  await Promise.all(
    ['Cutter', 'Mold'].map((name, i) =>
      executeCommand({
        id: i,
        command: 'recordAsset',
        mutationId: `m${i}`,
        payload: {
          name,
          amountUsd: 120,
          usefulLifeMonths: 24,
          purchasedAt: '2026-11-12',
        },
      }),
    ),
  );
  expect((await readWorkspace())!.assets!.map((a) => a.name)).toContain(
    'Cutter',
  );
  expect((await readWorkspace())!.assets!.map((a) => a.name)).toContain('Mold');
});
it('does not repeat an acknowledged mutation', async () => {
  const request = {
    id: 1,
    command: 'recordAsset' as const,
    mutationId: 'same',
    payload: {
      name: 'Cutter',
      amountUsd: 120,
      usefulLifeMonths: 24,
      purchasedAt: '2026-11-12',
    },
  };
  await executeCommand(request);
  await executeCommand(request);
  expect(
    (await readWorkspace())!.assets!.filter((a) => a.name === 'Cutter'),
  ).toHaveLength(1);
});
it('rejects conflicting repeated mutations and unconfirmed reset', async () => {
  await writeWorkspace(createDemoWorkspace());
  const request = {
    id: 1,
    command: 'recordAsset' as const,
    mutationId: 'conflict',
    payload: { name: 'A', amountUsd: 1, usefulLifeMonths: 1 },
  };
  await executeCommand(request);
  await expect(
    executeCommand({
      ...request,
      payload: { ...request.payload, amountUsd: 2 },
    }),
  ).rejects.toThrow(/different/);
  await expect(
    executeCommand({
      id: 2,
      command: 'resetDemo',
      payload: { confirmed: false },
    }),
  ).rejects.toThrow(/confirmation/);
});
it('does not commit unresolved historical reconstruction', async () => {
  const source = createDemoWorkspace();
  await writeWorkspace({
    ...source,
    batches: [{ ...source.batches![0], status: 'in_inventory' }],
  });
  const preview = await executeCommand({
    id: 1,
    command: 'previewReconstruction',
    payload: {
      openingDate: '2026-01-01',
      openingInventory: {},
      adjustments: [],
    },
  });
  expect(preview.issues.length).toBeGreaterThan(0);
  const before = await readWorkspace();
  await expect(
    executeCommand({
      id: 2,
      command: 'commitReconstruction',
      payload: { token: preview.token },
    }),
  ).rejects.toThrow(/issues/);
  expect(await readWorkspace()).toEqual(before);
});
it('invalid import cannot change the database', async () => {
  await writeWorkspace(createDemoWorkspace());
  const before = await readWorkspace();
  await expect(
    executeCommand({
      id: 1,
      command: 'previewImport',
      payload: { raw: '{"version":999,"inventory":{},"assets":"bad"}' },
    }),
  ).rejects.toThrow();
  expect(await readWorkspace()).toEqual(before);
});
it('rejects a stale replacement preview', async () => {
  await writeWorkspace(createDemoWorkspace());
  const preview = await executeCommand({
    id: 1,
    command: 'previewImport',
    payload: { raw: JSON.stringify(createDemoWorkspace()) },
  });
  await executeCommand({
    id: 2,
    command: 'recordAsset',
    mutationId: 'new',
    payload: { name: 'New', amountUsd: 1, usefulLifeMonths: 1 },
  });
  await expect(
    executeCommand({
      id: 3,
      command: 'commitImport',
      mutationId: 'commit',
      payload: { token: preview.token },
    }),
  ).rejects.toThrow(/changed/i);
});
it('preserves the original before migrating version 1', async () => {
  const original = { ...createDemoWorkspace(), version: 1 };
  await writeWorkspace(original);
  await executeCommand({ id: 1, command: 'getWorkspace', payload: {} });
  expect((await readWorkspace())!.version).toBe(2);
  expect(
    (await (await openDatabase()).getAll('recovery'))[0].workspace,
  ).toEqual(original);
});
it('aborts every write when domain validation fails', async () => {
  await writeWorkspace(createDemoWorkspace());
  const before = await readWorkspace();
  await expect(
    executeCommand({
      id: 1,
      mutationId: 'bad',
      command: 'recordAsset',
      payload: { name: 'Bad', amountUsd: -100, usefulLifeMonths: 1 },
    }),
  ).rejects.toThrow();
  expect(await readWorkspace()).toEqual(before);
  expect(await (await openDatabase()).get('mutations', 'bad')).toBeUndefined();
});
it('makes replacement and its recovery snapshot one transaction', async () => {
  await writeWorkspace(createDemoWorkspace());
  const preview = await executeCommand({
    id: 1,
    command: 'previewImport',
    payload: { raw: JSON.stringify(createDemoWorkspace()) },
  });
  await executeCommand({
    id: 2,
    mutationId: 'replace',
    command: 'commitImport',
    payload: { token: preview.token },
  });
  expect(
    await executeCommand({ id: 3, command: 'listRecovery', payload: {} }),
  ).not.toHaveLength(0);
});
