import { expect, test } from '@playwright/test';

test('loads and navigates core ERP workflows', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Red Mountain Soap Suite' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/production$/);
  await expect(page.locator('production-workbench')).toBeVisible();
  await expect(page.locator('.metrics')).toHaveCount(0);
  await expect(page.locator('#sync-state')).toContainText(
    /Batch calculated|Local workspace ready/,
  );

  await page.getByRole('link', { name: 'Recipes', exact: true }).click();
  const recipeRow = page.locator('tbody tr').first();
  const recipeId = (await recipeRow.locator('td').nth(1).innerText()).trim();
  await recipeRow.getByRole('button', { name: 'Plan batch' }).click();
  await expect(page).toHaveURL(/\/production\?recipe=/);
  await expect(
    page.getByRole('combobox', { name: 'Recipe', exact: true }),
  ).toHaveValue(recipeId);
  await page.getByRole('link', { name: 'Recipes', exact: true }).click();
  await page.getByRole('link', { name: 'Batch calculator' }).click();
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByText('Total oils')).toBeVisible();

  await page.getByRole('button', { name: '+ Plan' }).click();
  await expect(page.locator('#sync-state')).toContainText(
    'Planned batch saved.',
  );

  await page.getByRole('link', { name: 'Inventory', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
  await page.getByRole('link', { name: 'Finances', exact: true }).click();
  await page.getByRole('button', { name: '+ Receipt' }).click();
  await expect(page.locator('#sync-state')).toContainText(
    'Receipt applied to inventory.',
  );

  await page.getByRole('link', { name: 'Production', exact: true }).click();
  await expect(page.locator('production-workbench')).toBeVisible();

  await page.getByRole('link', { name: 'Settings & Data' }).click();
  await expect(page.getByRole('heading', { name: 'Backup' })).toBeVisible();
  await page.getByText('Backup preview', { exact: true }).click();
  await expect(page.locator('.backup-preview')).toContainText('workspace');

  await page.getByRole('link', { name: 'Recipes', exact: true }).click();
  await page.getByRole('link', { name: 'Recipe designer' }).click();
  const workbench = page.locator('recipe-vector-workbench');
  await expect(workbench).toBeVisible();

  const chartGeometry = await workbench.evaluate((element) => {
    const pie = element.shadowRoot?.querySelector(
      'vector-pie-chart',
    ) as HTMLElement & {
      value?: Record<string, number>;
    };
    const radar = element.shadowRoot?.querySelector(
      'vector-radar-chart',
    ) as HTMLElement & {
      axes?: unknown[];
    };
    const wedges = [
      ...(pie?.shadowRoot?.querySelectorAll('path.slice') || []),
    ] as SVGGraphicsElement[];
    const axes = [
      ...(radar?.shadowRoot?.querySelectorAll('line.axis') || []),
    ] as SVGGraphicsElement[];
    const nodes = [
      ...(radar?.shadowRoot?.querySelectorAll('circle.marble') || []),
    ] as SVGGraphicsElement[];
    const visibleBox = (item: SVGGraphicsElement) => {
      const box = item.getBBox();
      return box.width > 0 || box.height > 0;
    };

    return {
      expectedWedges: Object.values(pie?.value || {}).filter(
        (value) => value > 0,
      ).length,
      wedges: wedges.length,
      wedgesVisible: wedges.every(visibleBox),
      expectedAxes: radar?.axes?.length || 0,
      axes: axes.length,
      nodes: nodes.length,
      axesVisible: axes.every(visibleBox),
      nodesVisible: nodes.every(visibleBox),
    };
  });

  expect(chartGeometry.wedges).toBe(chartGeometry.expectedWedges);
  expect(chartGeometry.wedges).toBeGreaterThan(0);
  expect(chartGeometry.wedgesVisible).toBe(true);
  expect(chartGeometry.axes).toBe(chartGeometry.expectedAxes);
  expect(chartGeometry.nodes).toBe(chartGeometry.expectedAxes);
  expect(chartGeometry.axes).toBeGreaterThan(0);
  expect(chartGeometry.axesVisible).toBe(true);
  expect(chartGeometry.nodesVisible).toBe(true);
});
