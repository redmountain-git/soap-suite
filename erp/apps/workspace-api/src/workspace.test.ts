import 'fake-indexeddb/auto';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import type {
  AnyWorkerRequest,
  DecoratedWorkspace,
  ReplacementPreview,
} from '@rmsc/worker-protocol';
import {
  executeCommand,
  openDatabase,
  writeWorkspace,
} from '../../../packages/local-store/src/index';
import { createDemoWorkspace } from '@rmsc/domain-core';
import { copyWorkspaceDatabase, SqliteWorkspaceStore } from './sqlite-store';
import { workspaceApp } from './server';

function request(
  input: Omit<AnyWorkerRequest, 'id' | 'mutationId'>,
  mutationId = crypto.randomUUID(),
) {
  return { ...input, id: 1, mutationId } as AnyWorkerRequest;
}
const asset = request({
  command: 'recordAsset',
  payload: { name: 'Demo rack', amountUsd: 80, usefulLifeMonths: 12 },
});
const getWorkspace = request({ command: 'getWorkspace', payload: {} });

test('initialization validates before creating anything and never replaces a workspace', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'soap-init-'));
  const path = join(dir, 'new.sqlite');
  const raw = JSON.stringify({
    app: 'red-mountain-soap-suite',
    workspace: {
      ...createDemoWorkspace(),
      version: 2,
      revision: 35,
      name: 'Fictional migration',
    },
  });
  try {
    for (const invalid of [
      '{}',
      '{',
      raw.replace('"version":2', '"version":999'),
    ]) {
      await expect(
        SqliteWorkspaceStore.fromBackup(path, invalid),
      ).rejects.toThrow();
      expect(await readdir(dir)).toEqual([]);
    }
    await (await SqliteWorkspaceStore.fromBackup(path, raw)).close();
    await expect(SqliteWorkspaceStore.fromBackup(path, raw)).rejects.toThrow(
      /exist/i,
    );
    const opened = SqliteWorkspaceStore.open(path);
    try {
      const { result } = await opened.execute({
        id: 1,
        command: 'exportBackup',
        payload: {},
      });
      expect(JSON.parse(String(result)).workspace).toEqual(
        JSON.parse(raw).workspace,
      );
    } finally {
      await opened.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test.each(['IndexedDB', 'SQLite'])(
  '%s preserves the shared workflow and transaction rules',
  async (kind) => {
    const dir = await mkdtemp(join(tmpdir(), 'soap-store-test-'));
    const sqlite =
      kind === 'SQLite'
        ? await SqliteWorkspaceStore.createDemo(join(dir, 'demo.sqlite'))
        : null;
    if (!sqlite) await writeWorkspace(createDemoWorkspace());
    const execute = <T>(command: AnyWorkerRequest) =>
      (sqlite
        ? sqlite.execute(command).then(({ result }) => result)
        : executeCommand(command)) as Promise<T>;
    const state = async () =>
      (await execute<DecoratedWorkspace>(getWorkspace)).workspace;
    try {
      const before = await state();
      const planned = await execute<DecoratedWorkspace>(
        request({
          command: 'savePlannedBatch',
          payload: {
            input: {
              recipeId: 'PR-DEMO-001',
              volumeIn3: 100,
              barSize: 'bar_5_2_oz',
            },
          },
        }),
      );
      const batchId = planned.workspace.batches!.at(-1)!.id;
      const prep = request({
        command: 'recordBatchEvent',
        payload: { batchId, eventType: 'prepped' },
      });
      const prepared = (await execute<DecoratedWorkspace>(prep)).workspace;
      expect(prepared.inventory).not.toEqual(before.inventory);
      expect((await execute<DecoratedWorkspace>(prep)).workspace).toEqual(
        prepared,
      );
      await expect(
        execute({
          ...prep,
          payload: { batchId, eventType: 'poured' },
        } as AnyWorkerRequest),
      ).rejects.toThrow(/reused/);

      const receipt = request({
        command: 'recordReceipt',
        payload: {
          vendor: 'Test Supply',
          date: '2026-01-31',
          paymentMethod: 'cash',
          itemName: 'Olive oil',
          material: 'olive_oil',
          quantity: 1,
          unit: 'kg',
          total: 5,
        },
      });
      const received = (await execute<DecoratedWorkspace>(receipt)).workspace;
      expect(received.receipts!.length).toBe(prepared.receipts!.length + 1);
      expect((await execute<DecoratedWorkspace>(receipt)).workspace).toEqual(
        received,
      );
      expect(
        received.inventory.raw_materials!['olive_oil'].on_hand,
      ).toBeCloseTo(
        prepared.inventory.raw_materials!['olive_oil'].on_hand! + 1,
      );

      for (const eventType of ['poured', 'unmolded'])
        await execute(
          request({
            command: 'recordBatchEvent',
            payload: { batchId, eventType },
          }),
        );
      const cut = await execute<DecoratedWorkspace>(
        request({
          command: 'recordCutYield',
          payload: {
            batchId,
            sizeCounts: { bar_5_2_oz: 6 },
            weightGBySize: { bar_5_2_oz: 900 },
          },
        }),
      );
      await execute(
        request({
          command: 'recordBatchEvent',
          payload: { batchId, eventType: 'cure_started' },
        }),
      );
      const weigh = request({
        command: 'recordCureWeighIn',
        payload: {
          batchId,
          at: cut.workspace.batches!.at(-1)!.cut_at!,
          sizeCounts: { bar_5_2_oz: 5 },
          weightGBySize: { bar_5_2_oz: 711 },
        },
      });
      const weighed = await execute<DecoratedWorkspace>(weigh);
      expect(
        weighed.workspace.batches!.at(-1)!.cure_weigh_ins?.[0].weight_g_by_size,
      ).toEqual({ bar_5_2_oz: 711 });
      expect(await execute<DecoratedWorkspace>(weigh)).toEqual(weighed);
      expect(weighed.workspace.inventory).toEqual(received.inventory);

      const preview = await execute<ReplacementPreview>(
        request({
          command: 'previewImport',
          payload: { raw: JSON.stringify({ workspace: before }) },
        }),
      );
      await Promise.all([
        execute(asset),
        execute(
          request({
            command: 'recordAsset',
            payload: { name: 'Demo tray', amountUsd: 20, usefulLifeMonths: 12 },
          }),
        ),
      ]);
      const committed = await state();
      expect(committed.assets!.map(({ name }) => name).sort()).toEqual(
        [
          ...before.assets!.map(({ name }) => name),
          'Demo rack',
          'Demo tray',
        ].sort(),
      );
      await expect(
        execute(
          request({
            command: 'commitImport',
            payload: { token: preview.token },
          }),
        ),
      ).rejects.toThrow(/changed after preview/);
      expect(await state()).toEqual(committed);
    } finally {
      await sqlite?.close();
      if (!sqlite) (await openDatabase()).close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test('SQLite aborts a failed write and restores workspace, recovery and retry records after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'soap-sqlite-restore-'));
  const path = join(dir, 'source.sqlite');
  const snapshot = join(dir, 'snapshot.sqlite');
  const restored = join(dir, 'restored.sqlite');
  let store = await SqliteWorkspaceStore.createDemo(path);
  try {
    const before = await store.execute(getWorkspace);
    const fault = new DatabaseSync(path);
    fault.exec(
      "CREATE TRIGGER test_abort BEFORE INSERT ON mutations BEGIN SELECT RAISE(ABORT, 'test write failure'); END",
    );
    await expect(store.execute(asset)).rejects.toThrow(/test write failure/);
    expect(await store.execute(getWorkspace)).toEqual(before);
    fault.exec('DROP TRIGGER test_abort');
    fault.close();
    await store.execute(
      request({ command: 'resetDemo', payload: { confirmed: true } }),
    );
    const recorded = await store.execute(asset);
    await store.close();
    store = SqliteWorkspaceStore.open(path);
    expect((await store.execute(getWorkspace)).result).toEqual(recorded.result);
    await copyWorkspaceDatabase(path, snapshot);
    await copyWorkspaceDatabase(snapshot, restored);
    await expect(copyWorkspaceDatabase(snapshot, restored)).rejects.toThrow();
    await store.close();
    store = SqliteWorkspaceStore.open(restored);
    expect((await store.execute(getWorkspace)).result).toEqual(recorded.result);
    expect((await store.execute(asset)).result).toEqual(recorded.result);
    expect(
      (await store.execute(request({ command: 'listRecovery', payload: {} })))
        .result,
    ).toEqual([expect.objectContaining({ reason: 'Before demo reset' })]);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('HTTP serves only same-origin JSON commands and marks the Angular shell', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'soap-sqlite-http-'));
  await writeFile(
    join(dir, 'index.html'),
    '<html><head></head><body></body></html>',
  );
  const store = await SqliteWorkspaceStore.createDemo(join(dir, 'demo.sqlite'));
  const server = workspaceApp(store, dir).listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) =>
      server.once('listening', resolve).once('error', reject),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No loopback address.');
    const url = `http://127.0.0.1:${address.port}`;
    const send = (body: unknown, origin = url) =>
      fetch(`${url}/api/v1/commands`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    for (const path of ['/', '/production', '/%69ndex.html']) {
      const html = await fetch(url + path);
      expect(await html.text()).toContain(
        'name="soap-suite-workspace" content="sqlite"',
      );
    }
    expect((await send(asset, 'http://other.test')).status).toBe(403);
    expect(
      (await send({ id: 1, command: 'constructor', payload: {} })).status,
    ).toBe(400);
    expect((await send({ ...asset, mutationId: undefined })).status).toBe(400);
    const success = await send(asset);
    expect(success.headers.get('cache-control')).toBe('no-store');
    expect(await success.json()).toMatchObject({ id: asset.id, ok: true });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
