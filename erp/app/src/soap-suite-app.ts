import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { nextEventLabel, monthlyAssetCharge } from "./domain";
import "./recipe-vector-workbench";
import "../../apps/operations/src/app/features/data-recovery.element";
import "../../apps/operations/src/app/features/production-workbench.element";
import type {
  Asset,
  BarSize,
  Batch,
  BatchCalculation,
  BatchCalculationInput,
  CapacityAudit,
  DecoratedWorkspace,
  InventoryRecord,
  NumericMap,
  ReceiptInput,
  Reports,
  WorkerCommandMap,
  WorkerCommandName,
  WorkerRequest,
  WorkerResponse,
  Workspace
} from "./contracts";

type TabName = "plan" | "design" | "inventory" | "production" | "backup";

@customElement("soap-suite-app")
export class SoapSuiteApp extends LitElement {
  @state() private activeTab: TabName = "plan";
  @state() private workspaceState: DecoratedWorkspace | null = null;
  @state() private currentCalculation: BatchCalculation | null = null;
  @state() private statusMessage = "Starting local workspace...";
  @state() private statusIsError = false;
  @state() private backupPreview = "";
  @state() private selectedRecipeId = "";
  @state() private selectedBarSize = "";
  @state() private volumeIn3 = 57.62;
  @state() private fragrancePct = 4;
  @state() private receiptDate = today();
  @state() private assetDate = today();
  @state() private editingYield: string | null = null;

  private readonly worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  }>();
  private nextId = 1;
  private readonly clientId = crypto.randomUUID();
  private calculationGeneration = 0;
  private readonly channel = new BroadcastChannel('soap-suite-workspace');

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handleWorkerMessage(event);
    this.channel.onmessage = event => { if (event.data.clientId !== this.clientId && event.data.revision > Number(this.workspaceState?.workspace.revision || 0)) void this.refresh('getWorkspace'); };
    void this.refresh("seedWorkspace");
  }

  disconnectedCallback() {
    this.worker.terminate();
    this.channel.close();
    super.disconnectedCallback();
  }

  render() {
    const workspace = this.workspaceState?.workspace;
    const reports = this.workspaceState?.reports;

    return html`
      <div class="shell">
        <aside class="sidebar" aria-label="Workspace">
          <div class="brand">
            <img src="./icons/icon.svg" alt="" width="34" height="34">
            <div>
              <strong>Soap Suite</strong>
              <span>${workspace?.['name'] || 'Local workspace'}</span>
            </div>
          </div>
          <nav class="tabs" aria-label="Sections">
            ${this.renderTab("plan", "Plan", "Batch planning")}
            ${this.renderTab("design", "Design", "Recipe vector designer")}
            ${this.renderTab("inventory", "Stock", "Inventory and receipts")}
            ${this.renderTab("production", "Flow", "Production workflow")}
            ${this.renderTab("backup", "Files", "Backup and restore")}
          </nav>
        </aside>

        <main class="workspace">
          <header class="topbar">
            <div>
              <h1>Red Mountain Soap Suite</h1>
              <p id="sync-state" class=${this.statusIsError ? "warning" : ""}>${this.statusMessage}</p>
            </div>
            <div class="top-actions">
              <button class="icon-button" title="Export backup" @click=${this.exportBackup}>Export</button>
              <button class="icon-button secondary" title="Reset demo data" @click=${this.resetDemo}>Reset</button>
            </div>
          </header>

          <section class="metric-grid" aria-label="Workspace metrics">
            ${reports ? this.renderMetrics(reports) : nothing}
          </section>

          ${this.renderPlanView(workspace)}
          ${this.renderDesignView(workspace)}
          ${this.renderInventoryView(workspace, reports)}
          ${this.renderProductionView(workspace)}
          ${this.renderBackupView()}
        </main>
      </div>
    `;
  }

  private renderTab(name: TabName, label: string, title: string) {
    return html`
      <button
        class=${`tab ${this.activeTab === name ? "is-active" : ""}`}
        title=${title}
        @click=${() => this.activeTab = name}
      >
        ${label}
      </button>
    `;
  }

  private renderPlanView(workspace?: Workspace) {
    return html`
      <section class=${this.viewClass("plan")} aria-labelledby="plan-heading">
        <div class="split">
          <section class="panel tool-panel">
            <div class="panel-heading">
              <h2 id="plan-heading">Batch Calculator</h2>
              <button class="primary" title="Save planned batch" @click=${this.savePlan}>+ Plan</button>
            </div>
            <form class="form-grid" @submit=${this.handleCalculateSubmit}>
              <label>
                Recipe
                <select .value=${this.selectedRecipeId} @change=${this.handleRecipeChange}>
                  ${repeat(this.recipeOptions(workspace), (recipe) => recipe.id, (recipe) => html`
                    <option value=${recipe.id} .selected=${this.selectedRecipeId === recipe.id}>${recipe.name}</option>
                  `)}
                </select>
              </label>
              <label>
                Mold volume
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  .value=${String(this.volumeIn3)}
                  @input=${this.handleVolumeInput}
                >
              </label>
              <label>
                Bar size
                <select .value=${this.selectedBarSize} @change=${this.handleBarSizeChange}>
                  ${repeat(this.activeBarSizes(workspace), ([id]) => id, ([id, size]) => html`
                    <option value=${id} .selected=${this.selectedBarSize === id}>${size.display_name || id}</option>
                  `)}
                </select>
              </label>
              <label>
                Fragrance %
                <input
                  type="number"
                  min="0"
                  max="6"
                  step="0.1"
                  .value=${String(this.fragrancePct)}
                  @input=${this.handleFragranceInput}
                >
              </label>
              <button class="primary span-two" type="submit">Calculate</button>
            </form>
          </section>

          <section class="panel result-panel" aria-live="polite">
            <div class="panel-heading">
              <h2>Prep Sheet</h2>
              <span class="badge">${this.calculationBadge()}</span>
            </div>
            ${this.currentCalculation ? this.renderCalculation(this.currentCalculation) : html`
              <div class="result-empty">No batch calculated yet.</div>
            `}
          </section>
        </div>
      </section>
    `;
  }

  private renderDesignView(workspace?: Workspace) {
    return html`
      <section class=${this.viewClass("design")} aria-label="Recipe designer">
        <recipe-vector-workbench .workspace=${workspace || null}></recipe-vector-workbench>
      </section>
    `;
  }

  private renderInventoryView(workspace?: Workspace, reports?: Reports) {
    return html`
      <section class=${this.viewClass("inventory")} aria-labelledby="stock-heading">
        <div class="split">
          <section class="panel">
            <div class="panel-heading">
              <h2 id="stock-heading">Inventory</h2>
              <button class="secondary" title="Run capacity audit" @click=${this.runAudit}>Audit</button>
            </div>
            <div class="table-wrap">${workspace ? this.renderInventory(workspace) : nothing}</div>
          </section>

          <section class="panel">
            <div class="panel-heading">
              <h2>Receipt</h2>
              <span class="badge">Manual</span>
            </div>
            <form class="stacked-form" @submit=${this.handleReceiptSubmit}>
              <label>Vendor<input name="vendor" required value="Demo Supply"></label>
              <label>Date<input name="date" type="date" required .value=${this.receiptDate}></label>
              <label>Payment
                <select name="paymentMethod">
                  <option value="debit_business">Debit business</option>
                  <option value="debit_personal">Debit personal</option>
                  <option value="cash">Cash</option>
                  <option value="credit_business">Credit business</option>
                </select>
              </label>
              <div class="line-grid">
                <label>Item<input name="itemName" required value="Olive oil"></label>
                <label>Material<input name="material" required value="olive_oil"></label>
                <label>Qty<input name="quantity" type="number" min="0.001" step="0.001" value="1"></label>
                <label>Unit<input name="unit" value="kg"></label>
                <label>Cost<input name="total" type="number" min="0" step="0.01" value="6.40"></label>
              </div>
              <button class="primary" type="submit">+ Receipt</button>
            </form>
          </section>
        </div>

        <section class="panel full-width">
          <div class="panel-heading">
            <h2>Infrastructure</h2>
            <span class="badge">${reports ? `${money(reports.monthlyAmortization)} / month` : ""}</span>
          </div>
          <form class="asset-form" @submit=${this.handleAssetSubmit}>
            <label>Asset<input name="name" required value="Column mold"></label>
            <label>Purchase date<input name="purchasedAt" type="date" required .value=${this.assetDate}></label>
            <label>Amount<input name="amountUsd" type="number" min="0" step="0.01" value="48"></label>
            <label>Months<input name="usefulLifeMonths" type="number" min="1" step="1" value="36"></label>
            <button class="secondary" type="submit">+ Asset</button>
          </form>
          <div class="table-wrap">${workspace ? this.renderAssets(workspace.assets || []) : nothing}</div>
        </section>
      </section>
    `;
  }

  private renderProductionView(workspace?: Workspace) {
    return html`
      <section class=${this.viewClass("production")} aria-labelledby="flow-heading">
        <production-workbench .workspace=${workspace || null} .execute=${this.execute} @workspace-updated=${(e: CustomEvent<DecoratedWorkspace>) => this.applyState(e.detail, 'Workspace updated.')}></production-workbench>
        <section class="panel full-width">
          <div class="panel-heading">
            <h2 id="flow-heading">Single-Mold Batches</h2>
            <span class="badge">Lifecycle</span>
          </div>
          <div class="production-list">
            ${workspace ? this.renderProduction((workspace.batches || []).filter(b => !b.production)) : nothing}
          </div>
          ${this.editingYield ? html`<production-yield-form .workspace=${workspace} .batchId=${this.editingYield} @yield-confirmed=${this.recordYield} @yield-cancelled=${() => this.editingYield = null}></production-yield-form>` : nothing}
        </section>
      </section>
    `;
  }

  private renderBackupView() {
    return html`
      <section class=${this.viewClass("backup")} aria-labelledby="backup-heading">
        <section class="panel full-width">
          <div class="panel-heading">
            <h2 id="backup-heading">Backup</h2>
            <span class="badge">JSON</span>
          </div>
          <div class="backup-grid">
            <button class="primary" title="Export JSON backup" @click=${this.exportBackup}>Export</button>
            <button class="secondary" title="Reset demo workspace" @click=${this.resetDemo}>Reset demo</button>
          </div>
          <pre class="backup-preview">${this.backupPreview}</pre>
        </section>
        <workspace-data-review .workspace=${this.workspaceState?.workspace} .execute=${this.execute} @workspace-updated=${(e: CustomEvent<DecoratedWorkspace>) => this.applyState(e.detail, 'Workspace updated.')}></workspace-data-review>
      </section>
    `;
  }

  private renderMetrics(reports: Reports) {
    const metrics: Array<[string, string | number]> = [
      ["Inventory value", money(reports.inventoryValue)],
      ["Tooling spend", money(reports.assetSpend)],
      ["Monthly overhead", money(reports.monthlyAmortization)],
      ["Active batches", reports.activeBatches]
    ];

    return repeat(metrics, ([label]) => label, ([label, value]) => html`
      <div class="metric"><span>${label}</span><strong>${value}</strong></div>
    `);
  }

  private renderCalculation(calc: BatchCalculation) {
    return html`
      <div>
        <div class="prep-grid">
          <div class="prep-tile"><span>Total oils</span><strong>${formatGrams(calc.total_oils_g)}</strong></div>
          <div class="prep-tile"><span>Total mass</span><strong>${formatGrams(calc.total_mass_g)}</strong></div>
          <div class="prep-tile"><span>Expected bars</span><strong>${calc.bars_expected || 0}</strong></div>
          <div class="prep-tile"><span>Lye</span><strong>${formatGrams(calc.lye_g)}</strong></div>
          <div class="prep-tile"><span>Liquid</span><strong>${formatGrams(calc.liquid_g)}</strong></div>
          <div class="prep-tile"><span>Fragrance</span><strong>${formatGrams(calc.fragrance.amount_g)}</strong></div>
        </div>
        <ul class="material-list">
          ${repeat(Object.entries(calc.materials_required_g), ([material]) => material, ([material, grams]) => html`
            <li><span>${labelize(material)}</span><strong>${formatGrams(grams)}</strong></li>
          `)}
        </ul>
      </div>
    `;
  }

  private renderInventory(workspace: Workspace) {
    const sections: Array<[string, Record<string, InventoryRecord>]> = [
      ["Raw materials", workspace.inventory.raw_materials || {}],
      ["Additives", workspace.inventory.additives || {}],
      ["Finished goods", workspace.inventory.finished_goods || {}]
    ];

    return sections.map(([title, items]) => html`
      <h3>${title}</h3>
      <table>
        <thead><tr><th>Name</th><th>On hand</th><th>Avg cost</th></tr></thead>
        <tbody>
          ${Object.keys(items).length ? repeat(Object.entries(items), ([name]) => name, ([name, item]) => html`
            <tr>
              <td>${labelize(name)}</td>
              <td>${formatNumber(item.on_hand)} ${item.unit || ""}</td>
              <td>${money(item.avg_cost_per_unit ?? item.cost_per_unit ?? 0)}</td>
            </tr>
          `) : html`<tr><td colspan="3">None</td></tr>`}
        </tbody>
      </table>
    `);
  }

  private renderAssets(assets: ReadonlyArray<Asset>) {
    return html`
      <table>
        <thead><tr><th>Asset</th><th>Date</th><th>Amount</th><th>Months</th><th>Monthly</th></tr></thead>
        <tbody>
          ${assets.length ? repeat(assets, (asset) => asset.id, (asset) => html`
            <tr>
              <td>${asset.name}</td>
              <td>${asset.purchased_at}</td>
              <td>${money(asset.amount_usd)}</td>
              <td>${asset.useful_life_months}</td>
              <td>${money(monthlyAssetCharge(asset))}</td>
            </tr>
          `) : html`<tr><td colspan="5">None</td></tr>`}
        </tbody>
      </table>
    `;
  }

  private renderProduction(batches: ReadonlyArray<Batch>) {
    return repeat(batches, (batch) => batch.id, (batch) => {
      const nextLabel = nextEventLabel(batch.status);
      return html`
        <article class="production-row">
          <div>
            <strong>${batch.id}</strong>
            <span>${batch.product_recipe_id || batch.base_recipe_id || batch.recipe_id || ""}</span>
            ${batch.formulation?.bar_size ? html`<span>${this.workspaceState?.workspace.bar_sizes?.[batch.formulation.bar_size]?.display_name || batch.formulation.bar_size} / ${batch.volume_in3} in3 / ${batch.bars_expected} expected bars</span>` : nothing}
          </div>
          <span class="badge">${batch.status}</span>
          <button class="secondary" @click=${() => this.handleProductionAction("cost", batch.id)}>Cost</button>
          <button class="secondary" ?disabled=${!['unmolded','cut'].includes(batch.status) || Boolean(batch.reconciliation_required)} @click=${() => this.editingYield = batch.id}>Cut</button>
          <button class="secondary" ?disabled=${batch.status !== 'cured' || !batch.costed || Boolean(batch.reconciliation_required)} @click=${() => this.handleProductionAction("post", batch.id)}>Post</button>
          ${nextLabel ? html`
            <button class="primary" ?disabled=${Boolean(batch.reconciliation_required)} @click=${() => batch.status === 'unmolded' ? this.editingYield = batch.id : this.handleProductionAction("next", batch.id)}>${nextLabel}</button>
          ` : nothing}
          ${batch.yield_actual ? html`
            <batch-cure-weights .workspace=${this.workspaceState?.workspace || null} .batchId=${batch.id} .execute=${this.execute}
              @workspace-updated=${(e: CustomEvent<DecoratedWorkspace>) => this.applyState(e.detail, 'Weigh-in saved.')}></batch-cure-weights>
          ` : nothing}
        </article>
      `;
    });
  }

  private calculationBadge() {
    if (!this.currentCalculation) {
      return "Demo";
    }
    return this.currentCalculation.costing.missing_material_costs.length
      ? "Missing costs"
      : money(this.currentCalculation.costing.total_material_cost);
  }

  private viewClass(name: TabName) {
    return `view ${this.activeTab === name ? "is-active" : ""}`;
  }

  private recipeOptions(workspace?: Workspace) {
    if (!workspace) {
      return [];
    }
    return [
      ...(workspace.product_recipes || []).map((recipe) => ({
        id: recipe.id,
        name: recipe.name
      })),
      ...(workspace.base_recipes || []).map((recipe) => ({
        id: recipe.id,
        name: recipe.name
      }))
    ];
  }

  private activeBarSizes(workspace?: Workspace): Array<[string, BarSize]> {
    return Object.entries(workspace?.bar_sizes || {})
      .filter(([, size]) => size.active !== false);
  }

  private handleWorkerMessage(event: MessageEvent<WorkerResponse>) {
    const { id } = event.data || {};
    const callbacks = this.pending.get(id);
    if (!callbacks) {
      return;
    }
    this.pending.delete(id);
    if (event.data.ok === true) {
      callbacks.resolve(event.data.result);
    } else {
      callbacks.reject(new Error(event.data.error || "Worker command failed."));
    }
  }

  private async refresh(commandName: "seedWorkspace" | "getWorkspace") {
    try {
      const result = await this.command(commandName);
      this.applyState(result, "Local workspace ready.");
      await this.calculate();
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  }

  private handleCalculateSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    await this.calculate();
  };

  private savePlan = async () => {
    try {
      const result = await this.command("savePlannedBatch", { input: { recipeId: this.selectedRecipeId, volumeIn3: this.volumeIn3, barSize: this.selectedBarSize, fragrancePct: this.fragrancePct } });
      this.applyState(result, "Planned batch saved.");
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  };

  private async calculate() {
    const generation = ++this.calculationGeneration;
    const revision = this.workspaceState?.workspace.revision;
    this.currentCalculation = null;
    try {
      const payload: BatchCalculationInput = {
        recipeId: this.selectedRecipeId,
        volumeIn3: Number(this.volumeIn3),
        barSize: this.selectedBarSize,
        fragrancePct: Number(this.fragrancePct)
      };
      const result = await this.command("calculateBatch", payload);
      if (generation !== this.calculationGeneration || revision !== this.workspaceState?.workspace.revision || payload.recipeId !== this.selectedRecipeId || payload.volumeIn3 !== this.volumeIn3 || payload.barSize !== this.selectedBarSize || payload.fragrancePct !== this.fragrancePct) return;
      this.currentCalculation = result;
      this.setStatus("Batch calculated.");
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  }

  private runAudit = async () => {
    try {
      const audit = await this.command("runCapacityAudit", {
        recipeId: this.selectedRecipeId,
        volumeIn3: Number(this.volumeIn3),
        barSize: this.selectedBarSize,
        fragrancePct: Number(this.fragrancePct)
      });
      const shortageNames = Object.keys((audit as CapacityAudit).shortages);
      this.setStatus(
        shortageNames.length
          ? `Short on ${shortageNames.join(", ")}.`
          : "Inventory covers the selected batch.",
        shortageNames.length > 0
      );
      this.backupPreview = JSON.stringify(audit, null, 2);
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  };

  private async handleProductionAction(action: "cost" | "cut" | "post" | "next", batchId: string) {
    try {
      let result: DecoratedWorkspace | null = null;
      if (action === "next") {
        result = await this.command("recordNextBatchEvent", { batchId });
      } else if (action === "cost") {
        result = await this.command("runCosting", { batchId });
      } else if (action === "cut") {
        this.editingYield = batchId;
      } else if (action === "post") {
        result = await this.command("postFinishedGoods", { batchId });
      }
      if (result) {
        this.applyState(result, "Production updated.");
      }
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  }

  private exportBackup = async () => {
    try {
      const raw = await this.command("exportBackup");
      const blob = new Blob([raw], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `soap-suite-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      this.backupPreview = raw;
      this.setStatus("Backup exported.");
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  };

  private importBackup = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    try {
      const raw = await file.text();
      const preview = await this.command("previewImport", { raw });
      if (!window.confirm(`Replace ${preview.differences.length} inventory balances? A recovery snapshot will be retained.`)) return;
      const result = await this.command("commitImport", { token: preview.token });
      this.applyState(result, "Backup imported.");
      this.backupPreview = raw;
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    } finally {
      input.value = "";
    }
  };

  private resetDemo = async () => {
    if (!window.confirm('Replace workspace with demo data? A recovery snapshot will be retained.')) return;
    try {
      this.currentCalculation = null;
      const result = await this.command("resetDemo", { confirmed: true });
      this.applyState(result, "Demo workspace reset.");
      await this.calculate();
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  };

  private handleReceiptSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    try {
      const data = new FormData(form);
      const payload: ReceiptInput = {
        vendor: formString(data, "vendor"),
        date: formString(data, "date"),
        paymentMethod: formString(data, "paymentMethod"),
        itemName: formString(data, "itemName"),
        material: formString(data, "material"),
        quantity: formNumber(data, "quantity"),
        unit: formString(data, "unit"),
        total: formNumber(data, "total"),
        account: "assets.inventory.raw_materials"
      };
      const result = await this.command("recordReceipt", payload);
      this.applyState(result, "Receipt applied to inventory.");
      form.reset();
      this.receiptDate = today();
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  };

  private handleAssetSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    try {
      const data = new FormData(form);
      const result = await this.command("recordAsset", {
        name: formString(data, "name"),
        purchasedAt: formString(data, "purchasedAt"),
        amountUsd: formNumber(data, "amountUsd"),
        usefulLifeMonths: formNumber(data, "usefulLifeMonths")
      });
      this.applyState(result, "Asset recorded.");
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  };

  private handleRecipeChange = (event: Event) => {
    this.currentCalculation = null;
    this.selectedRecipeId = (event.currentTarget as HTMLSelectElement).value;
  };

  private handleBarSizeChange = (event: Event) => {
    this.currentCalculation = null;
    this.selectedBarSize = (event.currentTarget as HTMLSelectElement).value;
  };

  private handleVolumeInput = (event: Event) => {
    this.currentCalculation = null;
    this.volumeIn3 = Number((event.currentTarget as HTMLInputElement).value);
  };

  private handleFragranceInput = (event: Event) => {
    this.currentCalculation = null;
    this.fragrancePct = Number((event.currentTarget as HTMLInputElement).value);
  };

  private applyState(result: DecoratedWorkspace, message: string) {
    if (Number(result.workspace.revision || 0) < Number(this.workspaceState?.workspace.revision || 0)) return;
    this.currentCalculation = null;
    this.workspaceState = result;
    this.syncSelections(result.workspace);
    this.backupPreview = JSON.stringify(
      {
        workspace: result.workspace,
        reports: result.reports
      },
      null,
      2
    );
    this.setStatus(message);
  }

  private syncSelections(workspace: Workspace) {
    const recipes = this.recipeOptions(workspace);
    if (!recipes.some((recipe) => recipe.id === this.selectedRecipeId)) {
      this.selectedRecipeId = recipes[0]?.id || "";
    }

    const activeSizes = this.activeBarSizes(workspace);
    const sizeIds = new Set(activeSizes.map(([id]) => id));
    if (!sizeIds.has(this.selectedBarSize)) {
      this.selectedBarSize = sizeIds.has("bar_5_2_oz")
        ? "bar_5_2_oz"
        : activeSizes[0]?.[0] || "";
    }
  }

  private command<K extends WorkerCommandName>(
    command: K,
    payload = {} as WorkerCommandMap[K]["payload"]
  ): Promise<WorkerCommandMap[K]["result"]> {
    const id = this.nextId++;
    const request: WorkerRequest<K> = { id, command, payload, mutationId: crypto.randomUUID(), clientId: this.clientId };
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject
      });
      this.worker.postMessage(request);
    });
  }

  private setStatus(message: string, isError = false) {
    this.statusMessage = message;
    this.statusIsError = isError;
  }
  private readonly execute = <K extends WorkerCommandName>(name: K, payload: WorkerCommandMap[K]['payload']) => this.command(name, payload);
  private recordYield = async (event: CustomEvent<WorkerCommandMap['recordCutYield']['payload']>) => {
    try { this.applyState(await this.command('recordCutYield',event.detail), 'Cut yield recorded.'); this.editingYield = null; }
    catch (error) { this.setStatus(errorMessage(error),true); }
  };
}

function formString(data: FormData, key: string) {
  return String(data.get(key) || "");
}

function formNumber(data: FormData, key: string) {
  return Number(data.get(key) || 0);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function formatGrams(value: unknown) {
  return `${formatNumber(value)} g`;
}

function formatNumber(value: unknown) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function labelize(value: unknown) {
  return String(value || "").replaceAll("_", " ");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

declare global {
  interface HTMLElementTagNameMap {
    "soap-suite-app": SoapSuiteApp;
  }
}
