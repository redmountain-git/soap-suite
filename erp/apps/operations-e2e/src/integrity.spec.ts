import { test, expect, type Page } from '@playwright/test';
import type {
  Workspace,
  Asset,
  Batch,
  InventoryRecord,
} from '@rmsc/worker-protocol';
type TestWorkspace = Workspace & {
  assets: Asset[];
  batches: Batch[];
  inventory: {
    raw_materials: Record<string, InventoryRecord>;
    finished_goods: Record<string, InventoryRecord>;
  };
};

async function section(page: Page, name: string) {
  if (await page.locator('rms-root').count()) {
    name =
      (
        {
          Stock: 'Finances',
          Flow: 'Production',
          Files: 'Settings & Data',
        } as Record<string, string>
      )[name] || name;
  }
  await page
    .getByRole('link', { name, exact: true })
    .or(page.getByRole('button', { name, exact: true }))
    .click();
}
async function backup(page: Page) {
  const angular = (await page.locator('rms-root').count()) > 0;
  const previous = page.url();
  if (angular && !previous.endsWith('/settings')) await section(page, 'Files');
  const pending = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export', exact: true })
    .first()
    .click();
  const download = await pending;
  const stream = await download.createReadStream();
  let raw = '';
  for await (const chunk of stream!) raw += String(chunk);
  if (angular && page.url() !== previous) await page.goBack();
  return (JSON.parse(raw) as { workspace: TestWorkspace }).workspace;
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  if (await page.locator('rms-root').count()) {
    await page.getByRole('link', { name: 'Recipes', exact: true }).click();
    await page.getByRole('link', { name: /Batch calculator/i }).click();
  }
  await expect(page.locator('#sync-state')).toContainText('Batch calculated.');
});

test('navigation preserves the workspace and legacy links still open', async ({
  page,
}) => {
  const before = await backup(page);
  if (await page.locator('rms-root').count()) {
    for (const name of [
      'Production',
      'Recipes',
      'Inventory',
      'Finances',
      'Settings & Data',
    ]) {
      await section(page, name);
    }
    for (const [oldPath, newPath] of [
      ['plan', 'recipes/calculator'],
      ['design', 'recipes/design'],
      ['stock', 'inventory'],
      ['flow', 'production'],
      ['files', 'settings'],
    ]) {
      await page.evaluate((path) => {
        history.pushState({}, '', `/${path}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, oldPath);
      await expect(page).toHaveURL(new RegExp(`/${newPath}$`));
    }
  } else {
    for (const name of ['Stock', 'Flow', 'Files', 'Design'])
      await section(page, name);
  }
  expect(await backup(page)).toEqual(before);
});

test('migrates a physical version-1 database without changing balances', async ({
  page,
  browser,
  baseURL,
}) => {
  const source = await backup(page);
  const context = await browser.newContext();
  try {
    const legacy = await context.newPage();
    await legacy.goto(`${baseURL}/icons/icon.svg`);
    await legacy.evaluate(
      (workspace) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('red-mountain-soap-suite', 1);
          request.onupgradeneeded = () =>
            request.result.createObjectStore('documents');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('documents', 'readwrite');
            tx.objectStore('documents').put(
              { ...workspace, version: 1 },
              'workspace',
            );
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
      source,
    );
    await legacy.goto(baseURL!);
    await expect(legacy.locator('#sync-state')).toContainText(
      /Batch calculated\.|Local workspace ready\./,
    );
    const migrated = await backup(legacy);
    expect(migrated.version).toBe(2);
    expect(migrated.inventory).toEqual(source.inventory);
    expect(migrated.integrity!.reviewIssues.length).toBeGreaterThan(0);
    await section(legacy, 'Files');
    await legacy.getByRole('button', { name: 'Recovery snapshots' }).click();
    await expect(
      legacy.getByRole('button', { name: 'Review restore' }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test('reset requires confirmation and retains a recoverable previous workspace', async ({
  page,
}) => {
  await page.getByRole('button', { name: '+ Plan', exact: true }).click();
  await expect(page.locator('#sync-state')).toContainText(
    'Planned batch saved.',
  );
  const before = await backup(page);
  const angular = (await page.locator('rms-root').count()) > 0;
  if (angular) await section(page, 'Files');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page
    .getByRole('button', {
      name: angular ? 'Reset demo' : 'Reset',
      exact: true,
    })
    .click();
  expect((await backup(page)).batches.length).toBe(before.batches.length);
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', {
      name: angular ? 'Reset demo' : 'Reset',
      exact: true,
    })
    .click();
  await expect(page.locator('#sync-state')).toContainText(
    /Batch calculated\.|Local workspace ready\.|reset/i,
  );
  expect((await backup(page)).batches.length).toBe(1);
  if (!angular) await section(page, 'Files');
  await page.getByRole('button', { name: 'Recovery snapshots' }).click();
  await page.getByRole('button', { name: 'Review restore' }).first().click();
  await page.getByRole('button', { name: 'Confirm replacement' }).click();
  await expect(
    page.locator('workspace-data-review').getByRole('status'),
  ).toContainText('committed');
  expect((await backup(page)).batches.length).toBe(before.batches.length);
});

test('fresh inputs, observed yield, consumption, and single finished-goods posting', async ({
  page,
}, testInfo) => {
  const before = await backup(page);
  await page.getByLabel('Mold volume', { exact: true }).fill('100');
  await page.getByRole('button', { name: '+ Plan', exact: true }).click();
  await expect(page.locator('#sync-state')).toContainText(
    'Planned batch saved.',
  );
  const saved = (await backup(page)).batches.at(-1)!;
  expect(saved.volume_in3).toBe(100);
  await section(page, 'Flow');
  const row = page.locator('.production-row').filter({ hasText: saved.id });
  for (const next of ['prepped', 'poured', 'unmolded']) {
    await row.getByRole('button', { name: next, exact: true }).click();
    await expect(row.locator('.badge')).toHaveText(next);
  }
  const prepared = await backup(page);
  expect(prepared.inventory.raw_materials['olive_oil'].on_hand).toBeLessThan(
    before.inventory.raw_materials['olive_oil'].on_hand!,
  );
  await row.getByRole('button', { name: 'Cut', exact: true }).click();
  const form = page.locator('production-yield-form');
  await form.getByLabel('5.2 oz', { exact: true }).fill('7');
  await form.getByLabel('Total weight for 5.2 oz').fill('1000');
  await form.getByLabel('Measured trim (g)').fill('42');
  await form.getByRole('button', { name: 'Confirm actual yield' }).click();
  await expect(row.locator('.badge')).toHaveText('cut');
  await row.getByRole('button', { name: 'cure started', exact: true }).click();
  await expect(row.locator('.badge')).toHaveText('curing');
  const weights = row.locator('batch-cure-weights');
  await page.setViewportSize({ width: 390, height: 844 });
  await weights.getByRole('button', { name: 'Weigh bars' }).click();
  await expect(weights.getByLabel('5.2 oz', { exact: true })).toHaveValue('7');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await weights.getByLabel('Total weight for 5.2 oz').fill('960');
  await weights.screenshot({
    path: testInfo.outputPath('mobile-cure-weigh-in.png'),
  });
  await weights.getByRole('button', { name: 'Save weigh-in' }).click();
  await expect(weights.getByText('Weigh-in saved.')).toBeVisible();
  await expect(weights.locator('.reading').first()).toContainText('-4% vs cut');
  await weights.getByText('Weigh-in history (1)', { exact: true }).click();
  await expect(weights.locator('.history')).toContainText('960 g');
  await row
    .getByRole('button', { name: 'cure completed', exact: true })
    .click();
  await expect(row.locator('.badge')).toHaveText('cured');
  await row.getByRole('button', { name: 'Cost', exact: true }).click();
  await expect(
    row.getByRole('button', { name: 'Post', exact: true }),
  ).toBeEnabled();
  await row
    .getByRole('button', { name: 'posted to inventory', exact: true })
    .click();
  await expect(row.locator('.badge')).toHaveText('in_inventory');
  const posted = await backup(page);
  const weighed = posted.batches.find((batch) => batch.id === saved.id)!;
  expect(weighed.yield_actual?.weight_g_by_size).toEqual({ bar_5_2_oz: 1000 });
  expect(weighed.cure_weigh_ins?.[0].weight_g_by_size).toEqual({
    bar_5_2_oz: 960,
  });
  expect(
    posted.inventory.finished_goods['PR-DEMO-001.bar_5_2_oz'].on_hand,
  ).toBe(7);
  await expect(
    row.getByRole('button', { name: 'Post', exact: true }),
  ).toBeDisabled();
});

test('concurrent tabs preserve both asset additions and refresh each other', async ({
  page,
  context,
  baseURL,
}) => {
  const second = await context.newPage();
  await second.goto(baseURL!);
  await expect(second.locator('#sync-state')).toContainText(
    /Batch calculated\.|Local workspace ready\./,
  );
  await section(page, 'Stock');
  await section(second, 'Stock');
  await page.getByLabel('Asset', { exact: true }).fill('Concurrent A');
  await second.getByLabel('Asset', { exact: true }).fill('Concurrent B');
  await Promise.all([
    page.getByRole('button', { name: '+ Asset', exact: true }).click(),
    second.getByRole('button', { name: '+ Asset', exact: true }).click(),
  ]);
  await expect(
    page.getByRole('cell', { name: 'Concurrent A', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Concurrent B', exact: true }),
  ).toBeVisible();
  await expect(
    second.getByRole('cell', { name: 'Concurrent A', exact: true }),
  ).toBeVisible();
  await second.close();
});

test('backup preview, invalid import, confirmed restore, and reconstruction blockers', async ({
  page,
}) => {
  const original = await backup(page);
  await section(page, 'Stock');
  await page.getByLabel('Asset', { exact: true }).fill('Temporary tool');
  await page.getByRole('button', { name: '+ Asset', exact: true }).click();
  await expect(page.locator('#sync-state')).toContainText('Asset recorded.');
  await section(page, 'Files');
  const review = page.locator('workspace-data-review');
  await review.getByLabel('Review backup').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version":999,"inventory":{}}'),
  });
  await expect(review.getByRole('status')).toContainText('Unsupported');
  expect(
    (await backup(page)).assets.some(
      (a: { name: string }) => a.name === 'Temporary tool',
    ),
  ).toBe(true);
  await review.getByLabel('Review backup').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ workspace: original })),
  });
  await expect(
    review.getByRole('button', { name: 'Confirm replacement' }),
  ).toBeEnabled();
  expect(
    (await backup(page)).assets.some(
      (a: { name: string }) => a.name === 'Temporary tool',
    ),
  ).toBe(true);
  await review.getByRole('button', { name: 'Confirm replacement' }).click();
  await expect(review.getByRole('status')).toContainText('committed');
  expect(
    (await backup(page)).assets.some(
      (a: { name: string }) => a.name === 'Temporary tool',
    ),
  ).toBe(false);
  await review.getByRole('button', { name: 'Recovery snapshots' }).click();
  await expect(
    review.getByRole('button', { name: 'Review restore' }).first(),
  ).toBeVisible();
  await review.getByRole('button', { name: 'Review restore' }).first().click();
  await review.getByRole('button', { name: 'Confirm replacement' }).click();
  await expect(review.getByRole('status')).toContainText('committed');
  expect(
    (await backup(page)).assets.some(
      (a: { name: string }) => a.name === 'Temporary tool',
    ),
  ).toBe(true);
  const broken = {
    ...original,
    batches: [{ ...original.batches[0], status: 'in_inventory' }],
  };
  await review.getByLabel('History source').setInputFiles({
    name: 'history.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(broken)),
  });
  await review.getByLabel('Opening date', { exact: true }).fill('2026-01-01');
  await review.getByLabel('Opening balances confirmed').check();
  await review.getByRole('button', { name: 'Preview reconstruction' }).click();
  await expect(review.getByText(/missing consumption date/)).toBeVisible();
  await expect(
    review.getByRole('button', { name: 'Confirm reconstruction' }),
  ).toBeDisabled();
});

test('production build reloads offline and fits mobile', async ({
  page,
  context,
}, testInfo) => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.locator('#sync-state')).toContainText('Batch calculated.');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#sync-state')).toContainText('Batch calculated.');
  await page.screenshot({
    path: testInfo.outputPath('desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath('mobile.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
