import { expect, test } from '@playwright/test';

test('loads the isolated calculator and retains the public interaction contract', async ({
  page,
}) => {
  await page.goto('./');

  await expect(
    page.getByRole('heading', { name: 'Design and balance a soap recipe' }),
  ).toBeVisible();
  await expect(page.getByText('Safety and data note')).toBeVisible();

  const workbench = page.locator('recipe-vector-workbench');
  await expect(workbench).toBeVisible();
  await expect
    .poll(() =>
      workbench.evaluate(
        (element) =>
          (element as HTMLElement & { document?: { version?: number } })
            .document?.version,
      ),
    )
    .toBe(1);

  const contract = await workbench.evaluate((element) => {
    const root = element.shadowRoot;
    return {
      hasPie: Boolean(root?.querySelector('vector-pie-chart')),
      hasRadar: Boolean(root?.querySelector('vector-radar-chart')),
      undo: Boolean(root?.querySelector('[data-action="undo"]')),
      redo: Boolean(root?.querySelector('[data-action="redo"]')),
    };
  });

  expect(contract).toEqual({
    hasPie: true,
    hasRadar: true,
    undo: true,
    redo: true,
  });

  const concentration = page.getByRole('slider', { name: 'Lye concentration' });
  await expect(concentration).toHaveValue('33');
  await concentration.press('ArrowRight');
  await expect(
    page.getByRole('button', { name: 'Lye strength 33.1%' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('slider', { name: 'Lye concentration' }),
  ).toHaveValue('33.1');
});

test('installs its own worker and reloads offline under /calculator/', async ({
  page,
  context,
  baseURL,
}) => {
  await page.goto('./');
  await page.waitForFunction(
    () => Boolean(navigator.serviceWorker.controller),
    null,
    { timeout: 20_000 },
  );
  expect(
    await page.evaluate(
      async () => (await navigator.serviceWorker.ready).scope,
    ),
  ).toBe(baseURL);
  // Activation can precede the worker's first online navigation and precache.
  const warmed = await page.reload();
  expect(warmed?.fromServiceWorker()).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Design and balance a soap recipe' }),
  ).toBeVisible();
});
