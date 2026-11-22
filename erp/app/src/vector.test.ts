// @ts-nocheck
import { test } from "vitest";
import assert from "node:assert/strict";
import { createDemoWorkspace } from "./seed-data";
import { sumVector } from "./vector-math";
import { defaultOilConstraints, qualityVectorForOils } from "./soap-vector-solver";

test("standalone app vector shims import reusable packages", async () => {
  const widgets = await import("./vector-components");
  const soap = await import("./soap-vector-solver");

  assert.equal(typeof widgets.VectorPieChart, "function");
  assert.equal(typeof widgets.redistributeComposition, "function");
  assert.equal(typeof soap.solveMetricTarget, "function");
  assert.equal(sumVector({ a: 40, b: 60 }), 100);
  assert.equal(defaultOilConstraints(["coconut_oil"]).coconut_oil.step, 1);
  assert.equal(qualityVectorForOils({ coconut_oil: 50, olive_oil: 50 }).bubbly, 33.5);
});

test("standalone recipe workbench loads from packaged widgets and soap math", async () => {
  const { RecipeVectorWorkbench } = await import("./recipe-vector-workbench");
  const workbench = new RecipeVectorWorkbench();
  workbench.workspace = createDemoWorkspace();
  document.body.append(workbench);
  await workbench.updateComplete;

  assert.equal(Math.round(sumVector(workbench._oilVector)), 100);
  assert.equal(workbench.shadowRoot.querySelector("vector-pie-chart") !== null, true);
  assert.equal(workbench.shadowRoot.querySelector("vector-radar-chart") !== null, true);
  assert.equal(workbench.shadowRoot.querySelector("[data-quality-rail]"), null);
  assert.equal(workbench.shadowRoot.querySelector(".chart-card .quality-rail-list") !== null, true);
  assert.equal(workbench.shadowRoot.textContent?.includes("Quality Values"), false);
  assert.equal(workbench.shadowRoot.querySelector("vector-ingredient-list"), null);
  assert.equal(workbench.shadowRoot.querySelector(".formula-panel") !== null, true);
  assert.equal(workbench.shadowRoot.querySelector(".additive-panel") !== null, true);
  assert.equal(workbench.shadowRoot.querySelectorAll(".formula-panel vector-quantity-input").length, 2);
  const amountLists = workbench.shadowRoot.querySelectorAll("vector-amount-list");
  assert.equal(amountLists[0]?.unitDisplay, "text");
  assert.equal(amountLists[0]?.activeEmphasis, false);
  assert.equal(amountLists[1]?.items.length, workbench._additiveItems.length);
});
