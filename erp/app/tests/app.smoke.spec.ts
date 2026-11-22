import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Red Mountain Soap Suite" })).toBeVisible();
  await expect(page.locator(".metric")).toHaveCount(4);
});

test("loads, calculates, saves, and advances through the main local workflow", async ({ page }) => {
  await page.getByRole("button", { name: "Calculate" }).click();
  await expect(page.getByText("Batch calculated.")).toBeVisible();
  await expect(page.getByText("Total oils")).toBeVisible();

  await page.getByRole("button", { name: "+ Plan" }).click();
  await expect(page.getByText("Planned batch saved.")).toBeVisible();

  await page.getByRole("button", { name: "Flow" }).click();
  await expect(page.locator(".production-list").getByText(/B-LOCAL-\d{3}/).first()).toBeVisible();
});

test("records receipt and keeps backup controls usable", async ({ page }) => {
  await page.getByRole("button", { name: "Stock" }).click();
  await page.getByRole("button", { name: "+ Receipt" }).click();
  await expect(page.getByText("Receipt applied to inventory.")).toBeVisible();

  await page.getByRole("button", { name: "Files" }).click();
  await expect(page.locator(".backup-preview")).toContainText('"workspace"');

  const download = page.waitForEvent("download");
  await page.locator(".backup-grid").getByRole("button", { name: "Export" }).click();
  await download;
  await expect(page.getByText("Backup exported.")).toBeVisible();

  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByText("Batch calculated.")).toBeVisible();
});

test("mounts the vector designer custom elements", async ({ page }) => {
  await page.getByRole("button", { name: "Design" }).click();
  const workbench = page.locator("recipe-vector-workbench");
  await expect(workbench).toBeVisible();
  await expect(workbench.getByText("Recipe Designer")).toBeVisible();
  await expect(page.locator("vector-pie-chart")).toBeVisible();
  await expect(page.locator("vector-radar-chart")).toBeVisible();
});
