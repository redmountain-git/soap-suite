import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  productionAdditives,
  wholeGramTargets,
  weighingGroup,
} from '@rmsc/domain-core';
import type {
  Batch,
  BatchCalculation,
  BatchCalculationInput,
  CapacityAudit,
  DecoratedWorkspace,
  MoldInput,
  ProductionStep,
  WorkerCommandMap,
  Workspace,
} from '@rmsc/worker-protocol';
import type { ExecuteWorkspace } from './data-recovery.element';
import './data-recovery.element';
import './cure-weights.element';
import { workspaceDay } from './batch-weight-fields';

const names: Record<string, string> = {
  lye_ready: 'Lye solution ready',
  oils_ready: 'Oil mix ready',
  mixed: 'Oils + lye combined',
  trace: 'Trace',
  pour_started: 'Pour started',
  pour_finished: 'Pour finished',
};
const label = (s: string) => s.replaceAll('_', ' ');
const grams = (n: number) =>
  n > 0 && n < 1 ? '<1 g' : `${Math.round(n).toLocaleString()} g`;
const money = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
function elapsed(ms: number) {
  const n = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(n / 60)
    .toString()
    .padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`;
}
function pourElapsed(ms: number, estimated?: boolean) {
  if (!estimated) return elapsed(ms);
  return ms < 30000 ? 'Under 1 min' : `About ${Math.round(ms / 60000)} min`;
}
function displayTime(at: string, estimated?: boolean) {
  const date = new Date(at);
  return estimated
    ? `${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} (estimated)`
    : date.toLocaleTimeString();
}
function localTimestamp(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 19);
}

@customElement('production-workbench')
export class ProductionWorkbench extends LitElement {
  @property({ attribute: false }) initialRecipeId = '';
  @property({ attribute: false }) workspace: Workspace | null = null;
  @property({ attribute: false }) execute: ExecuteWorkspace | null = null;
  @state() private selectedId = '';
  @state() private planning = false;
  @state() private busy = false;
  @state() private message = '';
  @state() private error = false;
  @state() private now = Date.now();
  @state() private draftWeights: Record<string, string> = {};
  @state() private yieldOpen = false;
  @state() private pourEndDraft: {
    batchId: string;
    expectedAt?: string;
    at: string;
    estimated: boolean;
  } | null = null;
  @state() private omissionMaterial = '';
  @state() private omissionCorrection: Omit<
    WorkerCommandMap['correctAdditiveOmission']['payload'],
    'reason'
  > | null = null;
  @state() private timeCorrection: {
    batchId: string;
    material: string;
    expectedAt: string;
    at: string;
  } | null = null;
  @state() private preview: BatchCalculation | null = null;
  @state() private replacePlans = false;
  private previewRevision = -1;
  @state() private recipe = '';
  @state() private fragrance = 0;
  @state() private clayReplacement = '';
  @state() private audit: CapacityAudit | null = null;
  @state() private auditError = '';
  @state() private checking = true;
  @state() private moldRows: Array<MoldInput & { depth?: number }> = [];
  private clock?: ReturnType<typeof setInterval>;
  private auditGeneration = 0;

  static override styles = css`
    :host {
      display: block;
      color: #21352e;
      font: inherit;
    }
    * {
      box-sizing: border-box;
      letter-spacing: 0;
    }
    h2 {
      font-size: 1.25rem;
      margin: 0;
    }
    h3 {
      font-size: 1rem;
      margin: 0 0 0.75rem;
    }
    header,
    .actions,
    .checkpoint {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      flex-wrap: wrap;
    }
    header {
      justify-content: space-between;
      margin: 1.5rem 0 1rem;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1.25rem;
    }
    section,
    .molds {
      border-top: 1px solid #c7d1cb;
      padding: 1rem 0;
    }
    .stream {
      border-left: 3px solid #2f6a59;
      padding-left: 1rem;
      min-width: 0;
    }
    .stream:nth-child(2) {
      border-color: #a2603e;
    }
    .mold {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0.75rem;
      margin: 0.75rem 0;
      align-items: end;
    }
    label {
      display: grid;
      gap: 0.35rem;
      font-size: 0.9rem;
      min-width: 0;
    }
    input,
    select,
    button {
      font: inherit;
      min-width: 0;
      max-width: 100%;
      border: 1px solid #a9bab0;
      border-radius: 4px;
      padding: 0.6rem 0.75rem;
      background: white;
      color: inherit;
    }
    input,
    select {
      width: 100%;
    }
    button {
      cursor: pointer;
      min-height: 44px;
    }
    button.primary {
      background: #245b4d;
      color: white;
      border-color: #245b4d;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      table-layout: fixed;
    }
    th,
    td {
      padding: 0.5rem 0.25rem;
      text-align: left;
      border-bottom: 1px solid #e1e7e3;
      overflow-wrap: anywhere;
      font-size: 0.9rem;
    }
    td:last-child {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .timer {
      font-size: 2rem;
      font-variant-numeric: tabular-nums;
      margin: 0.5rem 0;
    }
    .muted,
    small {
      color: #52665b;
    }
    .error {
      color: #983c29;
    }
    .ok {
      color: #245b4d;
    }
    .message:empty {
      display: none;
    }
    .message {
      padding: 0.75rem 0;
    }
    output {
      font-variant-numeric: tabular-nums;
    }
    .batch-id {
      overflow-wrap: anywhere;
      font-size: 0.8rem;
    }
    .summary {
      display: flex;
      gap: 1.5rem;
      flex-wrap: wrap;
      margin: 0.75rem 0;
    }
    .summary div {
      display: grid;
      gap: 0.25rem;
    }
    .summary strong {
      font-size: 1.1rem;
    }
    .checklist {
      display: grid;
      gap: 0.75rem;
    }
    .checklist label {
      display: flex;
      align-items: center;
    }
    .checklist input {
      width: 22px;
      height: 22px;
      flex: 0 0 22px;
    }
    .weigh-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 220px;
      gap: 0.75rem;
      align-items: center;
      padding: 0.6rem 0;
      border-bottom: 1px solid #e1e7e3;
    }
    .weigh-label {
      overflow-wrap: anywhere;
    }
    .amount-stepper {
      display: grid;
      grid-template-columns: 44px minmax(50px, 1fr) 44px 1rem;
      align-items: center;
      gap: 4px;
      width: 220px;
      max-width: 100%;
    }
    .amount-stepper input {
      width: 100%;
      text-align: right;
      min-height: 44px;
      padding: 0.5rem;
      appearance: textfield;
    }
    .checklist label.weigh-label {
      display: grid;
    }
    .amount-stepper input::-webkit-inner-spin-button,
    .amount-stepper input::-webkit-outer-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .amount-stepper button {
      padding: 0;
      font-size: 1.25rem;
    }
    @media (max-width: 750px) {
      .weigh-row {
        grid-template-columns: 1fr;
        gap: 0.3rem;
      }
    }
    details > summary {
      cursor: pointer;
      padding: 0.75rem 0;
    }
    @media (max-width: 650px) {
      .grid {
        grid-template-columns: 1fr;
      }
      .mold {
        grid-template-columns: 1fr;
        padding-bottom: 1rem;
        border-bottom: 1px solid #e1e7e3;
      }
      .actions button {
        flex: 1 1 150px;
      }
    }
  `;

  override connectedCallback() {
    super.connectedCallback();
    this.clock = setInterval(() => {
      this.now = Date.now();
    }, 1000);
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this.clock);
  }
  protected override willUpdate(changes: PropertyValues) {
    if (changes.has('initialRecipeId') && this.initialRecipeId) {
      this.recipe = this.initialRecipeId;
      this.planning = true;
      this.preview = null;
    }
    if (changes.has('workspace') || changes.has('selectedId'))
      void this.refreshAudit();
    if (this.workspace && !this.moldRows.length) {
      const sizes = Object.entries(this.workspace.bar_sizes || {}).filter(
        ([, s]) => s.active !== false,
      );
      const retail = sizes.find(([id]) => id === 'bar_5_2_oz') || sizes[0];
      const guest =
        sizes.find(([id]) => id === 'bar_1_0_oz') || sizes[1] || sizes[0];
      this.recipe =
        this.initialRecipeId || this.workspace.base_recipes?.[0]?.id || '';
      if (this.initialRecipeId) this.planning = true;
      if (retail && guest)
        this.moldRows = [retail, guest].map(([id, s], i) => {
          const depth =
            Number(s['cut_depth_in']) > 0 ? (i === 0 ? 16 : 8) : undefined;
          return {
            id: `mold-${i + 1}`,
            label: i === 0 ? 'Retail column' : 'Hospitality column',
            barSize: id,
            depth,
            volumeIn3: depth
              ? Math.round(
                  (Number(s.approx_volume_in3) / Number(s['cut_depth_in'])) *
                    depth *
                    100,
                ) / 100
              : Math.round(
                  Number(s.approx_volume_in3) * (i === 0 ? 10 : 12) * 100,
                ) / 100,
          };
        });
    }
  }
  private async refreshAudit() {
    const generation = ++this.auditGeneration;
    const batches = (this.workspace?.batches || []).filter((b) => b.production);
    const batch =
      batches.find((b) => b.id === this.selectedId) || batches.at(-1);
    this.audit = null;
    this.auditError = '';
    this.checking = true;
    if (!batch || batch.status !== 'planned' || !this.execute) {
      this.checking = false;
      return;
    }
    const revision = this.workspace?.revision;
    try {
      const audit = await this.execute('runCapacityAudit', {
        ...batch.formulation!.inputs!,
        ...(batch.weighing ? { weighingResolutionG: 1 as const } : {}),
      });
      if (
        generation === this.auditGeneration &&
        revision === this.workspace?.revision
      )
        this.audit = audit;
    } catch (error) {
      if (generation === this.auditGeneration)
        this.auditError =
          error instanceof Error ? error.message : String(error);
    } finally {
      if (generation === this.auditGeneration) this.checking = false;
    }
  }
  override render() {
    const batches = (this.workspace?.batches || []).filter((b) => b.production);
    const batch =
      batches.find((b) => b.id === this.selectedId) || batches.at(-1);
    return html`
      <header>
        <h2>Production Batch</h2>
        <button
          @click=${() => {
            this.planning = !this.planning;
            this.message = '';
          }}
          ?disabled=${this.busy}
        >
          ${this.planning ? 'Close planner' : 'Plan batch'}
        </button>
      </header>
      <div
        class=${`message ${this.error ? 'error' : 'ok'}`}
        role=${this.error ? 'alert' : 'status'}
      >
        ${this.message}
      </div>
      ${this.planning || !batch ? this.renderPlanner() : nothing}
      ${batch
        ? html`
            <label
              >Batch<select
                @change=${(e: Event) => {
                  this.selectedId = (e.target as HTMLSelectElement).value;
                  this.yieldOpen = false;
                  this.message = '';
                }}
              >
                ${batches.map(
                  (b) =>
                    html`<option value=${b.id} ?selected=${batch.id === b.id}>
                      ${b.date} /
                      ${b.formulation?.base_recipe_name || b.recipe_id} /
                      ${b.id.slice(-8)}
                    </option>`,
                )}
              </select></label
            >
            ${this.renderBatch(batch)}
          `
        : nothing}
    `;
  }
  private get input(): BatchCalculationInput {
    const molds = this.moldRows.map(({ id, label, barSize, volumeIn3 }) => ({
      id,
      label,
      barSize,
      volumeIn3,
    }));
    return {
      recipeId: this.recipe,
      volumeIn3: molds.reduce((n, m) => n + m.volumeIn3, 0),
      molds,
      fragrancePct: this.fragrance,
      weighingResolutionG: 1,
      ...(this.clayReplacement
        ? { additiveSubstitutions: { kaolin_clay: this.clayReplacement } }
        : {}),
    };
  }
  private changeMold(
    index: number,
    values: Partial<MoldInput & { depth?: number }>,
  ) {
    this.moldRows = this.moldRows.map((m, i) => {
      if (i !== index) return m;
      const next = { ...m, ...values };
      const size = this.workspace?.bar_sizes?.[next.barSize];
      if (values.barSize)
        next.depth =
          Number(size?.['cut_depth_in']) > 0 ? m.depth || 8 : undefined;
      if (next.depth !== undefined && Number(size?.['cut_depth_in']) > 0)
        next.volumeIn3 =
          Math.round(
            (Number(size?.approx_volume_in3) / Number(size?.['cut_depth_in'])) *
              next.depth *
              100,
          ) / 100;
      return next;
    });
    this.preview = null;
  }
  private renderPlanner() {
    const calc =
      this.previewRevision === Number(this.workspace?.revision || 0)
        ? this.preview
        : null;
    const oldPlans = (this.workspace?.batches || []).filter(
      (b) =>
        !b.production &&
        b.status === 'planned' &&
        !b.inventory_deducted &&
        !b.events?.length,
    );
    const suggestions = calc ? wholeGramTargets(calc) : {};
    const oilTotal = calc
      ? Object.keys(calc.oils_g || {}).reduce((n, m) => n + suggestions[m], 0)
      : 0;
    return html`<form
      @submit=${(e: SubmitEvent) => {
        e.preventDefault();
        void this.run(async () => {
          const key = JSON.stringify(this.input);
          const revision = Number(this.workspace?.revision || 0);
          const result = await this.execute!('calculateBatch', this.input);
          if (
            key === JSON.stringify(this.input) &&
            revision === Number(this.workspace?.revision || 0)
          ) {
            this.preview = result;
            this.previewRevision = revision;
          }
        }, 'Formulation calculated.');
      }}
    >
      <div class="grid">
        <label
          >Recipe<select
            .value=${this.recipe}
            @change=${(e: Event) => {
              this.recipe = (e.target as HTMLSelectElement).value;
              this.preview = null;
            }}
          >
            ${[
              ...(this.workspace?.base_recipes || []),
              ...(this.workspace?.product_recipes || []),
            ].map(
              (r) =>
                html`<option value=${r.id} ?selected=${r.id === this.recipe}>
                  ${r.name}
                </option>`,
            )}
          </select></label
        ><label
          >Fragrance (%)<input
            type="number"
            min="0"
            step="0.1"
            .value=${String(this.fragrance)}
            @input=${(e: Event) => {
              this.fragrance = Number((e.target as HTMLInputElement).value);
              this.preview = null;
            }}
            required
        /></label>
        ${this.hasKaolin &&
        html`<label
          >Kaolin replacement<select
            .value=${this.clayReplacement}
            @change=${(e: Event) => {
              this.clayReplacement = (e.target as HTMLSelectElement).value;
              this.preview = null;
            }}
          >
            <option value="">Recipe default (kaolin)</option>
            <option value="french_green_clay">
              French green clay / same weight
            </option>
          </select></label
        >`}
      </div>
      <div class="molds">
        <h3>Mold allocations</h3>
        ${this.moldRows.map(
          (m, i) =>
            html`<div class="mold">
              <label
                >Mold ${i + 1}<input
                  .value=${m.label}
                  @input=${(e: Event) =>
                    this.changeMold(i, {
                      label: (e.target as HTMLInputElement).value,
                    })}
                  required
              /></label>
              <label
                >Bar size ${i + 1}<select
                  .value=${m.barSize}
                  @change=${(e: Event) =>
                    this.changeMold(i, {
                      barSize: (e.target as HTMLSelectElement).value,
                    })}
                >
                  ${Object.entries(this.workspace?.bar_sizes || {})
                    .filter(([, s]) => s.active !== false)
                    .map(
                      ([id, s]) =>
                        html`<option value=${id} ?selected=${id === m.barSize}>
                          ${s.display_name || id}
                        </option>`,
                    )}
                </select></label
              >
              ${m.depth !== undefined
                ? html`<label
                    >${m.label} fill depth (in)<input
                      type="number"
                      min="0.01"
                      step="0.01"
                      .value=${String(m.depth)}
                      @input=${(e: Event) =>
                        this.changeMold(i, {
                          depth: Number((e.target as HTMLInputElement).value),
                        })}
                      required
                    /><small>${m.volumeIn3} in3</small></label
                  >`
                : html`<label
                    >${m.label} volume (in3)<input
                      type="number"
                      min="0.01"
                      step="0.01"
                      .value=${String(m.volumeIn3)}
                      @input=${(e: Event) =>
                        this.changeMold(i, {
                          volumeIn3: Number(
                            (e.target as HTMLInputElement).value,
                          ),
                        })}
                      required
                  /></label>`}
            </div>`,
        )}
      </div>
      <div class="actions">
        <button
          type="button"
          @click=${() => {
            this.moldRows = [
              ...this.moldRows,
              {
                id: crypto.randomUUID(),
                label: `Mold ${this.moldRows.length + 1}`,
                barSize: this.moldRows[0].barSize,
                volumeIn3: 10,
              },
            ];
            this.preview = null;
          }}
        >
          Add mold
        </button>
        ${this.moldRows.length > 1
          ? html`<button
              type="button"
              @click=${() => {
                this.moldRows = this.moldRows.slice(0, -1);
                this.preview = null;
              }}
            >
              Remove last mold
            </button>`
          : nothing}
        ${oldPlans.length
          ? html`<label
              ><input
                type="checkbox"
                style="width:22px;height:22px"
                .checked=${this.replacePlans}
                @change=${(e: Event) => {
                  this.replacePlans = (e.target as HTMLInputElement).checked;
                }}
              />Replace ${oldPlans.length} unstarted single-mold plans (recovery
              copy retained)</label
            >`
          : nothing}
        <button type="submit" ?disabled=${this.busy}>
          Calculate formulation
        </button>
        <button
          type="button"
          class="primary"
          ?disabled=${this.busy || !calc}
          @click=${() =>
            this.run(async () => {
              const result = await this.execute!('savePlannedBatch', {
                input: this.input,
                ...(this.replacePlans
                  ? {
                      replaceBatchIds: oldPlans.map((b) => b.id),
                      expectedRevision: this.previewRevision,
                    }
                  : {}),
              });
              this.accept(result);
              this.selectedId = result.workspace.batches!.at(-1)!.id;
              this.planning = false;
              this.preview = null;
            })}
        >
          Save one batch
        </button>
      </div>
      ${calc
        ? html`<div class="summary">
              <div>
                <span>Total oils</span><strong>${grams(oilTotal)}</strong>
              </div>
              <div>
                <span>Total batter</span
                ><strong
                  >${grams(
                    Object.values(suggestions).reduce((n, g) => n + g, 0),
                  )}</strong
                >
              </div>
              <div>
                <span>Combined mold volume</span
                ><strong>${calc.volume_in3} in3</strong>
              </div>
            </div>
            ${this.materialTable(
              Object.entries(suggestions),
              calc.materials_required_g,
            )}
            ${calc.warnings?.map((w) => html`<p class="muted">${w}</p>`)}
            ${calc.molds?.map(
              (m) =>
                html`<p>
                  ${m.label}: ${m.bars_expected} expected
                  ${this.workspace?.bar_sizes?.[m.barSize]?.display_name ||
                  m.barSize}
                  bars
                </p>`,
            )}`
        : nothing}
    </form>`;
  }
  private get hasKaolin() {
    const baseId =
      this.workspace?.product_recipes?.find((r) => r.id === this.recipe)
        ?.base_recipe_id || this.recipe;
    const additives = this.workspace?.base_recipes?.find(
      (r) => r.id === baseId,
    )?.['additives_pct'];
    return (
      typeof additives === 'object' &&
      additives !== null &&
      Number((additives as Record<string, unknown>)['kaolin_clay']) > 0
    );
  }
  private renderBatch(batch: Batch) {
    const calc = batch.formulation!;
    const log = batch.production!;
    const oils = Object.keys(calc.oils_g || {});
    const lye = [
      (calc.lye_type || 'naoh').toLowerCase(),
      calc.liquid_type || 'distilled_water',
    ];
    const additives = productionAdditives(calc);
    const pendingAdditives = additives.filter((m) => !log.additives[m]);
    const targets = batch.weighing?.suggested_g || wholeGramTargets(calc);
    const amounts = { ...targets, ...batch.weighing?.actual_g };
    const prep = batch.status === 'prepped' && !log.pour_finished;
    let shortage = this.auditError;
    if (batch.status === 'planned' && this.audit) {
      shortage = Object.entries(this.audit.shortages)
        .map(([m, q]) => `${label(m)}: ${grams(q.short_g)} short`)
        .join('; ');
    }
    const missingCosts = calc.costing.missing_material_costs.filter(
      (m) =>
        !Object.values(this.workspace?.inventory || {}).some(
          (section) =>
            section?.[m] &&
            (section[m].avg_cost_per_unit != null ||
              section[m].cost_per_unit != null),
        ),
    );
    const cost = batch.total_cost;
    const end = log.pour_finished ? Date.parse(log.pour_finished) : this.now;
    const events = [
      ...Object.entries(log)
        .filter(
          ([key, at]) => Object.hasOwn(names, key) && typeof at === 'string',
        )
        .map(([key, at]) => ({
          name: names[key],
          at: at as string,
          estimated: key === 'pour_finished' && log.pour_finished_estimated,
        })),
      ...Object.entries(log.additives).map(([m, at]) => ({
        name: `${label(m)} ${batch.weighing?.actual_g[m] === 0 ? 'omitted' : 'added'}`,
        at,
        estimated: false,
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    return html`<section>
      <header>
        <div>
          <h3>${calc.product_recipe_name || calc.base_recipe_name}</h3>
          <span class="batch-id">${batch.id}</span>
        </div>
        <strong>${batch.status}</strong>
      </header>
      ${calc.warnings?.map((w) => html`<p class="muted">${w}</p>`)}
      <div class="summary">
        <div>
          <span>Oil total</span
          ><strong>${grams(oils.reduce((n, m) => n + amounts[m], 0))}</strong>
        </div>
        <div>
          <span
            >${batch.weighing && batch.inventory_deducted
              ? 'Batter weight'
              : 'Batter estimate'}</span
          ><strong
            >${grams(Object.values(amounts).reduce((n, g) => n + g, 0))}</strong
          >
        </div>
        <div>
          <span>Material cost</span
          ><strong
            >${(batch.weighing && !batch.inventory_deducted) ||
            batch.missing_material_costs?.length ||
            missingCosts.length
              ? 'Incomplete'
              : cost == null
                ? 'Not costed'
                : money(cost)}</strong
          >
        </div>
      </div>
      <table aria-label="Mold allocations">
        <thead>
          <tr>
            <th>Mold</th>
            <th>Size</th>
            <th>Fill (in3)</th>
            <th>Expected bars</th>
          </tr>
        </thead>
        <tbody>
          ${calc.molds?.map(
            (m) =>
              html`<tr>
                <td>${m.label}</td>
                <td>
                  ${this.workspace?.bar_sizes?.[m.barSize]?.display_name ||
                  m.barSize}
                </td>
                <td>${m.volumeIn3}</td>
                <td>${m.bars_expected}</td>
              </tr>`,
          )}
        </tbody>
      </table>
      ${batch.status === 'planned'
        ? html`<section>
            <h3>Ingredient check</h3>
            ${shortage
              ? html`<p class="error">${shortage}</p>`
              : html`<p class="ok">
                  ${this.checking
                    ? 'Checking recorded stock...'
                    : 'Recorded quantities cover this batch.'}
                </p>`}
            ${missingCosts.length
              ? html`<p class="error">
                  Missing costs: ${missingCosts.map(label).join(', ')}
                </p>`
              : nothing}
            ${!batch.weighing
              ? html`<button
                  class="primary"
                  ?disabled=${this.busy}
                  @click=${() =>
                    this.run(async () =>
                      this.accept(
                        await this.execute!('enableBatchWeighing', {
                          batchId: batch.id,
                        }),
                      ),
                    )}
                >
                  Use whole-gram actual weights
                </button>`
              : nothing}
            <button
              class="primary"
              ?disabled=${this.busy ||
              this.checking ||
              !this.audit?.can_make ||
              !!shortage ||
              !!missingCosts.length}
              @click=${() => this.event(batch, 'prepped')}
            >
              ${batch.weighing
                ? 'Begin preparation'
                : 'Begin prep & consume ingredients'}
            </button>
          </section>`
        : nothing}
      <section>
        <div class="grid">
          <div class="stream">
            <h3>Oil mix</h3>
            ${this.renderWeights(batch, oils)}${this.stepButton(
              batch,
              'oils_ready',
              'Oil mix ready',
              !prep || this.invalidWeights(batch, oils),
            )}
          </div>
          <div class="stream">
            <h3>Lye solution</h3>
            ${this.renderWeights(batch, lye)}${this.stepButton(
              batch,
              'lye_ready',
              'Lye solution ready',
              !prep || this.invalidWeights(batch, lye),
            )}
          </div>
        </div>
      </section>
      <section>
        <h3>Combine & trace</h3>
        <div class="timer" role="timer" aria-label="Elapsed since combining">
          ${log.mixed
            ? pourElapsed(
                end - Date.parse(log.mixed),
                log.pour_finished_estimated,
              )
            : '00:00'}
        </div>
        <div class="actions">
          ${this.stepButton(
            batch,
            'mixed',
            'Combine oils + lye / start timer',
            !prep || !log.oils_ready || !log.lye_ready,
          )}${this.stepButton(
            batch,
            'trace',
            'Mark trace',
            !prep || !log.mixed || !!log.pour_started,
          )}
        </div>
        ${log.trace && log.mixed
          ? html`<p>
              Trace at
              <strong
                >+${elapsed(
                  Date.parse(log.trace) - Date.parse(log.mixed),
                )}</strong
              >
            </p>`
          : nothing}
      </section>
      <section>
        <h3>Additives</h3>
        <div class="checklist">
          ${additives.map(
            (m) =>
              html`<div>
                ${this.renderWeights(batch, [m])}<label
                  ><input
                    type="checkbox"
                    aria-label=${batch.weighing?.actual_g[m] === 0
                      ? `${label(m)} omitted`
                      : `Confirm ${label(m)} added`}
                    .checked=${!!log.additives[m]}
                    ?disabled=${this.busy ||
                    !prep ||
                    !!log.additives[m] ||
                    this.invalidWeights(batch, [m])}
                    @change=${() => this.productionStep(batch, 'additive', m)}
                  />${batch.weighing?.actual_g[m] === 0
                    ? `${label(m)} omitted (0 g)`
                    : `Confirm ${label(m)} added`}
                  ${log.additives[m]
                    ? html`<time datetime=${log.additives[m]}
                        >${new Date(
                          log.additives[m],
                        ).toLocaleTimeString()}</time
                      >`
                    : nothing}</label
                >
                ${prep && batch.weighing && !log.additives[m]
                  ? this.omissionMaterial === m
                    ? html`<div class="actions">
                        <button
                          type="button"
                          ?disabled=${this.busy}
                          @click=${() =>
                            this.run(
                              async () => {
                                this.accept(
                                  await this.execute!('recordProductionStep', {
                                    batchId: batch.id,
                                    step: 'additive',
                                    material: m,
                                    actualWeightsG: { [m]: 0 },
                                  }),
                                );
                                this.omissionMaterial = '';
                              },
                              `${label(m)} recorded as omitted. No stock consumed.`,
                            )}
                        >
                          Confirm omitted
                        </button>
                        <button
                          type="button"
                          ?disabled=${this.busy}
                          @click=${() => {
                            this.omissionMaterial = '';
                          }}
                        >
                          Cancel omission
                        </button>
                      </div>`
                    : html`<button
                        type="button"
                        ?disabled=${this.busy}
                        @click=${() => {
                          this.omissionMaterial = m;
                        }}
                      >
                        Omit ${label(m)}
                      </button>`
                  : nothing}
                ${log.additives[m] &&
                batch.status !== 'in_inventory' &&
                !batch.reconciliation_required
                  ? html`<button
                      type="button"
                      ?disabled=${this.busy}
                      aria-label=${`Correct ${label(m)} time`}
                      @click=${() => {
                        this.timeCorrection = {
                          batchId: batch.id,
                          material: m,
                          expectedAt: log.additives[m],
                          at: log.additives[m],
                        };
                      }}
                    >
                      Correct time
                    </button>`
                  : nothing}
                ${log.additives[m] &&
                (batch.weighing?.actual_g[m] || 0) > 0 &&
                batch.status !== 'in_inventory' &&
                !batch.reconciliation_required
                  ? html`<button
                      type="button"
                      ?disabled=${this.busy}
                      @click=${() => {
                        this.omissionCorrection = {
                          batchId: batch.id,
                          material: m,
                          expectedAt: log.additives[m],
                          expectedWeightG: batch.weighing!.actual_g[m],
                        };
                      }}
                    >
                      Correct ${label(m)} as omitted
                    </button>`
                  : nothing}
              </div>`,
          )}
        </div>
        ${!additives.length ? html`<span class="muted">None</span>` : nothing}
        ${this.timeCorrection?.batchId === batch.id
          ? this.renderTimeCorrection(batch)
          : nothing}
        ${this.omissionCorrection?.batchId === batch.id
          ? this.renderOmissionCorrection()
          : nothing}
      </section>
      <section>
        <h3>Pour</h3>
        ${prep && pendingAdditives.length
          ? html`<p id="pour-blocker" role="status">
              End pour requires recorded confirmation for:
              ${pendingAdditives.map(label).join(', ')} (added or omitted).
            </p>`
          : nothing}
        <div class="actions">
          ${this.stepButton(
            batch,
            'pour_started',
            'Start pour',
            !prep || !log.trace,
          )}${this.stepButton(
            batch,
            'pour_finished',
            'End pour',
            !prep || !log.pour_started || !!pendingAdditives.length,
          )}
        </div>
        ${log.pour_started &&
        batch.status !== 'in_inventory' &&
        !batch.reconciliation_required
          ? html`<button
              type="button"
              ?disabled=${this.busy}
              @click=${() => {
                this.pourEndDraft = {
                  batchId: batch.id,
                  ...(log.pour_finished
                    ? { expectedAt: log.pour_finished }
                    : {}),
                  at: log.pour_finished || new Date().toISOString(),
                  estimated: !!log.pour_finished_estimated,
                };
              }}
            >
              ${log.pour_finished
                ? 'Correct pour end time'
                : 'Enter actual end time'}
            </button>`
          : nothing}
        ${this.pourEndDraft?.batchId === batch.id
          ? this.renderPourEndTime(batch)
          : nothing}
        ${log.pour_started
          ? html`<p>
              Pour duration:
              <output
                >${pourElapsed(
                  end - Date.parse(log.pour_started),
                  log.pour_finished_estimated,
                )}</output
              >
            </p>`
          : nothing}
      </section>
      <section>
        <h3>Yield & cure</h3>
        <div class="actions">
          ${batch.status === 'poured'
            ? html`<form
                class="actions"
                @submit=${(event: SubmitEvent) => {
                  event.preventDefault();
                  const data = new FormData(
                    event.currentTarget as HTMLFormElement,
                  );
                  this.event(batch, 'unmolded', String(data.get('unmoldDate')));
                }}
              >
                <label
                  >Unmold date<input
                    name="unmoldDate"
                    type="date"
                    max=${workspaceDay(this.workspace)}
                    value=${workspaceDay(this.workspace)}
                    required
                /></label>
                <button type="submit" ?disabled=${this.busy}>
                  Mark unmolded
                </button>
              </form>`
            : nothing}
          ${['unmolded', 'cut'].includes(batch.status)
            ? html`<button
                ?disabled=${this.busy}
                @click=${() => {
                  this.yieldOpen = !this.yieldOpen;
                }}
              >
                Record cut yield
              </button>`
            : nothing}
          ${batch.status === 'cut'
            ? html`<form
                class="actions"
                @submit=${(event: SubmitEvent) => {
                  event.preventDefault();
                  const data = new FormData(
                    event.currentTarget as HTMLFormElement,
                  );
                  this.event(
                    batch,
                    'cure_started',
                    String(data.get('cureStartDate')),
                  );
                }}
              >
                <label
                  >Cure start date<input
                    name="cureStartDate"
                    type="date"
                    min=${batch.cut_at || batch.yield_actual?.recorded_at || ''}
                    max=${workspaceDay(this.workspace)}
                    value=${workspaceDay(this.workspace)}
                    required
                /></label>
                <button type="submit" ?disabled=${this.busy}>Start cure</button>
              </form>`
            : nothing}
          ${batch.status === 'curing'
            ? html`<button
                ?disabled=${this.busy}
                @click=${() => this.event(batch, 'cure_completed')}
              >
                Confirm cure complete
              </button>`
            : nothing}
          <button
            ?disabled=${this.busy}
            @click=${() =>
              this.run(async () =>
                this.accept(
                  await this.execute!('runCosting', { batchId: batch.id }),
                ),
              )}
          >
            Calculate costs
          </button>
          <button
            class="primary"
            ?disabled=${this.busy || batch.status !== 'cured' || !batch.costed}
            @click=${() =>
              this.run(async () =>
                this.accept(
                  await this.execute!('postFinishedGoods', {
                    batchId: batch.id,
                  }),
                ),
              )}
          >
            Post finished goods
          </button>
        </div>
        ${this.yieldOpen && ['unmolded', 'cut'].includes(batch.status)
          ? html`<production-yield-form
              .workspace=${this.workspace}
              .batchId=${batch.id}
              .busy=${this.busy}
              @yield-confirmed=${(
                event: CustomEvent<
                  WorkerCommandMap['recordCutYield']['payload']
                >,
              ) =>
                this.run(async () => {
                  this.accept(
                    await this.execute!('recordCutYield', event.detail),
                  );
                  this.yieldOpen = false;
                })}
              @yield-cancelled=${() => {
                this.yieldOpen = false;
              }}
            ></production-yield-form>`
          : nothing}
        ${batch.yield_actual
          ? html`<batch-cure-weights
              .workspace=${this.workspace}
              .batchId=${batch.id}
              .execute=${this.execute}
            ></batch-cure-weights>`
          : nothing}
        ${batch.cost_per_bar_by_size
          ? html`<table aria-label="Material cost by bar size">
              <tbody>
                ${Object.entries(batch.cost_per_bar_by_size).map(
                  ([s, n]) =>
                    html`<tr>
                      <td>
                        ${this.workspace?.bar_sizes?.[s]?.display_name || s}
                      </td>
                      <td>${money(n)} / bar</td>
                    </tr>`,
                )}
              </tbody>
            </table>`
          : nothing}
      </section>
      <details ?open=${!!log.mixed}>
        <summary>Batch timeline</summary>
        <table aria-label="Batch timeline">
          <thead>
            <tr>
              <th>Checkpoint</th>
              <th>Time</th>
              <th>From mix</th>
            </tr>
          </thead>
          <tbody>
            ${events.map(
              (e) =>
                html`<tr>
                  <td>${e.name}</td>
                  <td>
                    <time datetime=${e.at}
                      >${displayTime(e.at, e.estimated)}</time
                    >
                  </td>
                  <td>
                    ${log.mixed
                      ? e.estimated
                        ? pourElapsed(
                            Date.parse(e.at) - Date.parse(log.mixed),
                            true,
                          )
                        : `${e.at < log.mixed ? '-' : '+'}${elapsed(Math.abs(Date.parse(e.at) - Date.parse(log.mixed)))}`
                      : '-'}
                  </td>
                </tr>`,
            )}
          </tbody>
        </table>
      </details>
    </section>`;
  }
  private weightValue(batch: Batch, material: string): string {
    const confirmed = batch.weighing?.actual_g[material];
    return confirmed !== undefined
      ? String(confirmed)
      : (this.draftWeights[`${batch.id}:${material}`] ??
          String(batch.weighing?.suggested_g[material] ?? 0));
  }
  private invalidWeights(batch: Batch, materials: string[]) {
    if (!batch.weighing) return false;
    return materials.some((m) => {
      const value = this.weightValue(batch, m);
      const grams = Number(value);
      const additive = productionAdditives(batch.formulation!).includes(m);
      return (
        value.trim() === '' ||
        !Number.isSafeInteger(grams) ||
        grams < (additive ? 0 : 1) ||
        batch.formulation!.materials_required_g[m] < 1
      );
    });
  }
  private renderWeights(batch: Batch, materials: string[]) {
    if (!batch.weighing)
      return this.materialTable(
        materials.map((m) => [
          m,
          batch.material_usage_g?.[m] ??
            batch.formulation!.materials_required_g[m],
        ]),
      );
    return html`${materials.map((m) => {
      const confirmed = m in batch.weighing!.actual_g;
      const tooSmall = batch.formulation!.materials_required_g[m] < 1;
      const disabled =
        this.busy || batch.status !== 'prepped' || confirmed || tooSmall;
      const key = `${batch.id}:${m}`;
      const update = (value: string) => {
        this.draftWeights = { ...this.draftWeights, [key]: value };
      };
      const value = this.weightValue(batch, m);
      return html`<div class="weigh-row">
        <label class="weigh-label" for=${key}
          >${label(m)}<small
            >Suggested
            ${tooSmall ? '<1 g' : grams(batch.weighing!.suggested_g[m])}</small
          >${tooSmall
            ? html`<small class="error">Finer scale required</small>`
            : this.invalidWeights(batch, [m])
              ? html`<small class="error">Enter valid whole grams</small>`
              : nothing}</label
        >
        <div class="amount-stepper">
          <button
            type="button"
            title=${`Decrease ${label(m)} by 1 g`}
            aria-label=${`Decrease ${label(m)} by 1 g`}
            ?disabled=${disabled || Number(value) <= 0}
            @click=${() =>
              update(String(Math.max(0, (Number(value) || 0) - 1)))}
          >
            -
          </button>
          <input
            id=${key}
            type="number"
            inputmode="numeric"
            step="1"
            min="0"
            aria-label=${`Actual ${label(m)} (g)`}
            aria-invalid=${this.invalidWeights(batch, [m]) ? 'true' : 'false'}
            .value=${value}
            ?disabled=${disabled}
            @input=${(e: Event) => update((e.target as HTMLInputElement).value)}
          />
          <button
            type="button"
            title=${`Increase ${label(m)} by 1 g`}
            aria-label=${`Increase ${label(m)} by 1 g`}
            ?disabled=${disabled}
            @click=${() => update(String((Number(value) || 0) + 1))}
          >
            +</button
          ><span>g</span>
        </div>
      </div>`;
    })}`;
  }
  private materialTable(
    rows: Array<[string, number]>,
    precise?: Record<string, number> | Readonly<Record<string, number>>,
  ) {
    return html`<table>
      <tbody>
        ${rows.map(
          ([m, n]) =>
            html`<tr>
              <td>${label(m)}</td>
              <td>
                ${n === 0 && precise && precise[m] > 0 ? '<1 g' : grams(n)}
              </td>
            </tr>`,
        )}
      </tbody>
    </table>`;
  }
  private stepButton(
    batch: Batch,
    step: Exclude<ProductionStep, 'additive'>,
    text: string,
    disabled: boolean,
  ) {
    const at = batch.production?.[step];
    return html`<div class="checkpoint">
      <button
        class=${step === 'mixed' ? 'primary' : ''}
        ?disabled=${this.busy || disabled || !!at}
        aria-describedby=${step === 'pour_finished' &&
        !at &&
        productionAdditives(batch.formulation!).some(
          (m) => !batch.production!.additives[m],
        )
          ? 'pour-blocker'
          : nothing}
        @click=${() => this.productionStep(batch, step)}
      >
        ${text}</button
      >${at
        ? html`<time datetime=${at}
            >${displayTime(
              at,
              step === 'pour_finished' &&
                batch.production?.pour_finished_estimated,
            )}</time
          >`
        : nothing}
    </div>`;
  }
  private renderOmissionCorrection() {
    const correction = this.omissionCorrection!;
    return html`<form
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget as HTMLFormElement);
        void this.run(
          async () => {
            this.accept(
              await this.execute!('correctAdditiveOmission', {
                ...correction,
                reason: String(data.get('reason')),
              }),
            );
            this.omissionCorrection = null;
          },
          `${label(correction.material)} corrected to 0 g; ${correction.expectedWeightG} g returned to stock.`,
        );
      }}
    >
      <h3>Correct ${label(correction.material)} as omitted</h3>
      <p>${correction.expectedWeightG} g will be returned to stock.</p>
      <label
        >Correction reason<input
          type="text"
          name="reason"
          maxlength="500"
          required
      /></label>
      <div class="actions">
        <button type="submit" ?disabled=${this.busy}>
          Confirm omission correction
        </button>
        <button
          type="button"
          ?disabled=${this.busy}
          @click=${() => {
            this.omissionCorrection = null;
          }}
        >
          Cancel
        </button>
      </div>
    </form>`;
  }
  private renderTimeCorrection(batch: Batch) {
    const correction = this.timeCorrection!;
    const trace = batch.production?.trace;
    const offset =
      trace && correction.at
        ? Math.round((Date.parse(correction.at) - Date.parse(trace)) / 1000)
        : '';
    return html`<form
      aria-label="Correct additive time"
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget as HTMLFormElement);
        void this.run(async () => {
          this.accept(
            await this.execute!('correctAdditiveTimestamp', {
              batchId: correction.batchId,
              material: correction.material,
              expectedAt: correction.expectedAt,
              at: correction.at,
              reason: String(data.get('reason') || ''),
            }),
          );
          this.timeCorrection = null;
        }, 'Additive time corrected. Recorded weight and inventory are unchanged.');
      }}
    >
      <h3>Correct ${label(correction.material)} time</h3>
      <div class="grid">
        <label
          >Recorded time<input
            name="at"
            type="datetime-local"
            step="1"
            required
            .value=${correction.at ? localTimestamp(correction.at) : ''}
            @input=${(event: Event) => {
              const value = (event.target as HTMLInputElement).value;
              this.timeCorrection = {
                ...correction,
                at: value ? new Date(value).toISOString() : '',
              };
            }}
        /></label>
        ${trace
          ? html`<label
              >Seconds after trace<input
                name="traceOffset"
                type="number"
                step="1"
                .value=${String(offset)}
                @input=${(event: Event) => {
                  const value = (event.target as HTMLInputElement).value;
                  const ms = Date.parse(trace) + Number(value) * 1000;
                  if (
                    value !== '' &&
                    Number.isFinite(ms) &&
                    Math.abs(ms) <= 8.64e15
                  )
                    this.timeCorrection = {
                      ...correction,
                      at: new Date(ms).toISOString(),
                    };
                }}
            /></label>`
          : nothing}
        <label
          >Correction reason<input
            name="reason"
            type="text"
            required
            maxlength="500"
        /></label>
      </div>
      <div class="actions">
        <button type="submit" ?disabled=${this.busy || !correction.at}>
          Save corrected time
        </button>
        <button
          type="button"
          ?disabled=${this.busy}
          @click=${() => {
            this.timeCorrection = null;
          }}
        >
          Cancel correction
        </button>
      </div>
    </form>`;
  }
  private renderPourEndTime(batch: Batch) {
    const draft = this.pourEndDraft!;
    const correcting = !!draft.expectedAt;
    const pending = productionAdditives(batch.formulation!).some(
      (m) => !batch.production!.additives[m],
    );
    return html`<form
      aria-label="Pour end time"
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget as HTMLFormElement);
        void this.run(
          async () => {
            this.accept(
              correcting
                ? await this.execute!('correctPourEndTimestamp', {
                    batchId: batch.id,
                    expectedAt: draft.expectedAt!,
                    at: draft.at,
                    estimated: draft.estimated,
                    reason: String(data.get('reason') || ''),
                  })
                : await this.execute!('recordProductionStep', {
                    batchId: batch.id,
                    step: 'pour_finished',
                    at: draft.at,
                    estimated: draft.estimated,
                  }),
            );
            this.pourEndDraft = null;
          },
          draft.estimated
            ? 'Estimated pour end saved.'
            : 'Actual pour end time saved.',
        );
      }}
    >
      <h3>${correcting ? 'Correct pour end time' : 'Actual pour end time'}</h3>
      <div class="grid">
        <label
          >Pour finished at<input
            type="datetime-local"
            name="pourEndAt"
            required
            step="1"
            .value=${draft.at ? localTimestamp(draft.at) : ''}
            @input=${(event: Event) => {
              const value = (event.target as HTMLInputElement).value;
              if (!this.pourEndDraft) return;
              this.pourEndDraft = {
                ...this.pourEndDraft,
                at: value ? new Date(value).toISOString() : '',
              };
            }}
        /></label>
        ${correcting
          ? html`<label
              >Correction reason<input
                type="text"
                name="reason"
                required
                maxlength="500"
            /></label>`
          : nothing}
      </div>
      <label class="actions"
        ><input
          type="checkbox"
          name="estimated"
          .checked=${draft.estimated}
          @change=${(event: Event) => {
            if (!this.pourEndDraft) return;
            this.pourEndDraft = {
              ...this.pourEndDraft,
              estimated: (event.target as HTMLInputElement).checked,
            };
          }}
        />Estimated time</label
      >
      ${draft.at && batch.production?.pour_started
        ? html`<p>
            Pour duration:
            <output
              >${pourElapsed(
                Date.parse(draft.at) -
                  Date.parse(batch.production.pour_started),
                draft.estimated,
              )}</output
            >
          </p>`
        : nothing}
      <div class="actions">
        <button type="submit" ?disabled=${this.busy || !draft.at || pending}>
          ${correcting ? 'Save corrected pour end' : 'Confirm actual pour end'}
        </button>
        <button
          type="button"
          ?disabled=${this.busy}
          @click=${() => {
            this.pourEndDraft = null;
          }}
        >
          Cancel pour end entry
        </button>
      </div>
    </form>`;
  }
  private productionStep(
    batch: Batch,
    step: ProductionStep,
    material?: string,
  ) {
    void this.run(async () => {
      const group = weighingGroup(batch.formulation!, step, material);
      if (batch.weighing && this.invalidWeights(batch, group))
        throw new Error(
          'Enter valid whole-gram actual amounts before confirming.',
        );
      this.accept(
        await this.execute!('recordProductionStep', {
          batchId: batch.id,
          step,
          material,
          ...(batch.weighing && group.length
            ? {
                actualWeightsG: Object.fromEntries(
                  group.map((m) => [m, Number(this.weightValue(batch, m))]),
                ),
              }
            : {}),
        }),
      );
    });
  }
  private event(batch: Batch, eventType: string, at?: string) {
    void this.run(async () =>
      this.accept(
        await this.execute!('recordBatchEvent', {
          batchId: batch.id,
          eventType,
          ...(at ? { at } : {}),
        }),
      ),
    );
  }
  private accept(result: DecoratedWorkspace) {
    this.workspace = result.workspace;
    this.dispatchEvent(
      new CustomEvent('workspace-updated', {
        detail: result,
        bubbles: true,
        composed: true,
      }),
    );
  }
  private async run(
    action: () => Promise<void>,
    successMessage = 'Saved locally.',
  ) {
    if (this.busy || !this.execute) return;
    this.busy = true;
    this.message = '';
    this.error = false;
    try {
      await action();
      this.message = successMessage;
    } catch (error) {
      this.message = error instanceof Error ? error.message : String(error);
      this.error = true;
    } finally {
      this.busy = false;
    }
  }
}
