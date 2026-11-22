// @ts-nocheck
import { test } from "vitest";
import assert from "node:assert/strict";
import { createDemoWorkspace } from "./seed-data";
import {
  calculateBatch,
  recordAsset,
  recordReceipt,
  runCapacityAudit,
  savePlannedBatch
} from "./domain";

test("calculateBatch returns material requirements and cost preview", () => {
  const workspace = createDemoWorkspace();
  const result = calculateBatch(workspace, {
    recipeId: "PR-DEMO-001",
    volumeIn3: 57.62,
    barSize: "bar_5_2_oz",
    fragrancePct: 4
  });

  assert.equal(result.base_recipe_id, "BSR-DEMO-001");
  assert.equal(result.product_recipe_id, "PR-DEMO-001");
  assert.ok(result.total_oils_g > 0);
  assert.ok(result.materials_required_g.olive_oil > 0);
  assert.ok(result.materials_required_g.naoh > 0);
  assert.equal(result.costing.missing_material_costs.length, 0);
});

test("savePlannedBatch stores calculated cost and expected yield", () => {
  const workspace = createDemoWorkspace();
  const calculation = calculateBatch(workspace, {
    recipeId: "PR-DEMO-001",
    volumeIn3: 57.62,
    barSize: "bar_5_2_oz",
    fragrancePct: 4
  });
  const next = savePlannedBatch(workspace, calculation, '2026-11-12');
  const saved = next.batches.at(-1);

  assert.equal(saved.status, "planned");
  assert.equal(saved.material_usage_g.naoh, calculation.materials_required_g.naoh);
  assert.ok(saved.total_cost > 0);
});

test("recordReceipt applies weighted inventory update", () => {
  const workspace = createDemoWorkspace();
  const before = workspace.inventory.raw_materials.olive_oil.on_hand;
  const next = recordReceipt(workspace, {
    vendor: "Demo Supply",
    date: "2026-01-21",
    paymentMethod: "debit_business",
    itemName: "Olive oil",
    material: "olive_oil",
    quantity: 1,
    unit: "kg",
    total: 7.5
  }, '2026-01-21', 'R-TEST-001');

  assert.equal(next.receipts[0].vendor, "Demo Supply");
  assert.equal(next.inventory.raw_materials.olive_oil.on_hand, before + 1);
  assert.ok(next.inventory.raw_materials.olive_oil.avg_cost_per_unit > 0);
});

test("recordAsset contributes amortizable infrastructure", () => {
  const workspace = createDemoWorkspace();
  const next = recordAsset(workspace, {
    name: "Wire cutter",
    purchasedAt: "2026-01-22",
    amountUsd: 120,
    usefulLifeMonths: 24
  }, '2026-01-22', 'A-TEST-001');

  assert.equal(next.assets[0].name, "Wire cutter");
  assert.equal(next.assets[0].useful_life_months, 24);
});

test("runCapacityAudit reports demo inventory can cover default batch", () => {
  const workspace = createDemoWorkspace();
  const audit = runCapacityAudit(workspace, {
    recipeId: "PR-DEMO-001",
    volumeIn3: 57.62,
    barSize: "bar_5_2_oz"
  });

  assert.equal(audit.can_make, true);
  assert.deepEqual(audit.shortages, {});
});
