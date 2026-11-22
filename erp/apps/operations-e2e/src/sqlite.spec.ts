import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { workspaceApp } from '../../workspace-api/src/server';
import { SqliteWorkspaceStore } from '../../workspace-api/src/sqlite-store';

const staticOrigin = 'http://127.0.0.1:4341';
const endpoint = 'https://commands.soap.test/api/v1/commands';

async function configure(page: Page, tag: string) {
  await page.route(staticOrigin + '/', async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      body: (await res.text()).replace('<head>', '<head>' + tag),
    });
  });
  await page.goto(staticOrigin + '/');
}

async function exported(page: Page) {
  await page.getByRole('link', { name: 'Settings & Data' }).click();
  const file = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const stream = await (await file).createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function importFile(page: Page, envelope: unknown) {
  const review = page.locator('workspace-data-review');
  await review.getByLabel('Review backup').setInputFiles({
    name: 'workspace.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(envelope)),
  });
  await review.getByRole('button', { name: 'Confirm replacement' }).click();
  await expect(review.getByRole('status')).toContainText('committed');
}

test('a malformed provider never starts a browser worker', async ({ page }) => {
  await configure(
    page,
    '<meta name="soap-suite-workspace" content="endpoint" data-endpoint="http://not-secure.test/api">',
  );
  await expect(page.locator('#sync-state')).toContainText(
    'No data store was opened',
  );
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
});

test('an unreachable configured endpoint does not open the local workspace', async ({
  page,
}) => {
  await page.route(endpoint, (route) => route.abort('connectionrefused'));
  await configure(
    page,
    '<meta name="soap-suite-workspace" content="endpoint" data-endpoint="' +
      endpoint +
      '">',
  );
  await expect(page.locator('#sync-state')).toContainText(
    'Hosted workspace is unavailable',
  );
  await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible();
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
});

test('portable browser -> SQLite -> hosted endpoint -> browser with a lost commit reply', async ({
  browser,
  page,
}) => {
  await page.goto(staticOrigin);
  const source = await exported(page);
  const dir = await mkdtemp(join(tmpdir(), 'soap-provider-test-'));
  const db = join(dir, 'imported.sqlite');
  const imported = await SqliteWorkspaceStore.fromBackup(
    db,
    JSON.stringify(source),
  );
  await imported.close();
  const sqlite = SqliteWorkspaceStore.open(db);
  const hosted = await SqliteWorkspaceStore.createDemo(
    join(dir, 'hosted.sqlite'),
  );
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const { result } = await sqlite.execute({
      id: 1,
      command: 'exportBackup',
      payload: {},
    });
    const fromSqlite = JSON.parse(String(result));
    expect(fromSqlite.workspace).toEqual(source.workspace);
    const remote = await ctx.newPage();
    const mutationIds: string[] = [];
    await remote.route(endpoint, async (route) => {
      const req = route.request();
      const headers = {
        'Access-Control-Allow-Origin': staticOrigin,
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      };
      if (req.method() === 'OPTIONS')
        return route.fulfill({ status: 204, headers });
      const command = req.postDataJSON();
      if (
        command.command === 'recordAsset' &&
        command.payload.name === 'Rejected tray'
      ) {
        return route.fulfill({
          headers,
          json: { id: command.id, ok: false, error: 'Workspace is read-only.' },
        });
      }
      let reply;
      try {
        reply = {
          id: command.id,
          ok: true,
          ...(await hosted.execute(command)),
        };
      } catch (error) {
        reply = { id: command.id, ok: false, error: String(error) };
      }
      if (command.command === 'recordAsset') {
        mutationIds.push(command.mutationId);
        if (mutationIds.length === 1) return route.abort('connectionreset');
      }
      await route.fulfill({ json: reply, headers });
    });
    await configure(
      remote,
      '<meta name="soap-suite-workspace" content="endpoint" data-endpoint="' +
        endpoint +
        '">',
    );
    await expect(
      remote.getByText('Hosted workspace', { exact: true }),
    ).toBeVisible();
    await remote.getByRole('link', { name: 'Settings & Data' }).click();
    await importFile(remote, fromSqlite);
    await remote.getByRole('link', { name: 'Finances' }).click();
    const name = remote.getByLabel('Asset', { exact: true });
    await name.fill('Round trip tray');
    await remote.getByRole('button', { name: '+ Asset', exact: true }).click();
    await expect(name).toHaveValue('Round trip tray');
    await remote
      .getByRole('button', { name: 'Retry unconfirmed save' })
      .click();
    await expect(remote.locator('#sync-state')).toContainText('Save confirmed');
    expect(mutationIds).toHaveLength(2);
    expect(mutationIds[1]).toEqual(mutationIds[0]);
    await name.fill('Rejected tray');
    await remote.getByRole('button', { name: '+ Asset', exact: true }).click();
    await expect(remote.locator('#sync-state')).toContainText(
      'Request rejected: Workspace is read-only',
    );
    await expect(name).toHaveValue('Rejected tray');
    await expect(
      remote.getByRole('button', { name: 'Retry unconfirmed save' }),
    ).toHaveCount(0);
    const resultFile = await exported(remote);
    expect(
      resultFile.workspace.assets.filter(
        (a: { name: string }) => a.name === 'Round trip tray',
      ),
    ).toHaveLength(1);
    expect(await remote.evaluate(() => indexedDB.databases())).toEqual([]);
    await importFile(page, resultFile);
    const back = await exported(page);
    expect(back.workspace).toEqual({
      ...resultFile.workspace,
      revision: back.workspace.revision,
      updatedAt: back.workspace.updatedAt,
    });
  } finally {
    await ctx.close();
    await hosted.close();
    await sqlite.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('Angular uses SQLite without falling back when a save cannot reach it', async ({
  page,
  context,
}) => {
  const dir = await mkdtemp(join(tmpdir(), 'soap-ui-sqlite-'));
  const store = await SqliteWorkspaceStore.createDemo(
    join(dir, 'browser.sqlite'),
  );
  const server = workspaceApp(
    store,
    resolve('dist/apps/operations/browser'),
  ).listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) =>
      server.once('listening', resolve).once('error', reject),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No loopback address.');
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await expect(page).toHaveURL(/\/production$/);
    await expect(
      page.getByText('SQLite workspace', { exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Finances' }).click();
    const name = page.getByLabel('Asset', { exact: true });
    const add = page.getByRole('button', { name: '+ Asset', exact: true });
    await name.fill('Demo SQLite tray');
    await add.click();
    await expect(
      page.getByRole('cell', { name: 'Demo SQLite tray', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('cell', { name: 'Demo SQLite tray', exact: true }),
    ).toBeVisible();

    await context.route('**/api/v1/commands', (route) =>
      route.abort('connectionrefused'),
    );
    await name.fill('Keep this unsaved name');
    await add.click();
    await expect(
      page.getByText(/SQLite workspace is unavailable/),
    ).toBeVisible();
    await expect(name).toHaveValue('Keep this unsaved name');
    expect(
      await page.evaluate(async () =>
        (await indexedDB.databases()).map((db) => db.name),
      ),
    ).not.toContain('red-mountain-soap-suite');
    await context.unroute('**/api/v1/commands');
    await page.reload();
    await expect(
      page.getByRole('cell', { name: 'Demo SQLite tray', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'Keep this unsaved name', exact: true }),
    ).toHaveCount(0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
