import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { estimatedTrim } from '@rmsc/domain-core';
import {
  barWeightRow,
  groupTitle,
  readBarWeights,
  sizeLabel,
  weightFormStyles,
  workspaceDay,
} from './batch-weight-fields';
import type {
  DecoratedWorkspace,
  BaseRecipe,
  Inventory,
  InventoryAdjustment,
  ReplacementPreview,
  RecoverySummary,
  WorkerCommandMap,
  WorkerCommandName,
  Workspace,
} from '@rmsc/worker-protocol';

export type ExecuteWorkspace = <K extends WorkerCommandName>(
  command: K,
  payload: WorkerCommandMap[K]['payload'],
) => Promise<WorkerCommandMap[K]['result']>;

@customElement('workspace-data-review')
export class WorkspaceDataReview extends LitElement {
  protected override updated(changes: PropertyValues) {
    if (changes.has('workspace')) {
      this.querySelector('form')?.reset();
      if (this.preview && this.preview.revision !== this.workspace?.revision) {
        this.preview = null;
        this.message = 'Workspace changed. Review a new preview.';
      }
    }
  }
  @property({ attribute: false }) workspace: Workspace | null = null;
  @property({ attribute: false }) execute: ExecuteWorkspace | null = null;
  @state() private preview: ReplacementPreview | null = null;
  @state() private recoveries: ReadonlyArray<RecoverySummary> = [];
  @state() private message = '';
  @state() private busy = false;
  @state() private recipeRaw = '';
  @state() private recipePreview: BaseRecipe | null = null;
  @state() private openingDate = '';
  @state() private sourceRaw: string | undefined;
  @state() private sourceWorkspace: Workspace | null = null;
  @state() private adjustments: InventoryAdjustment[] = [];
  override createRenderRoot() {
    return this;
  }

  override render() {
    const source = this.sourceWorkspace || this.workspace;
    const stocks = Object.entries(source?.inventory || {}).flatMap(
      ([section, items]) =>
        Object.entries(items || {}).map(([material, record]) => ({
          section,
          material,
          record,
        })),
    );
    return html` <section
      class="panel full-width"
      aria-labelledby="review-heading"
    >
      <div class="panel-heading">
        <h2 id="review-heading">Data Review</h2>
        <span role="status">${this.message}</span>
      </div>
      <div class="backup-grid">
        <label class="file-button"
          >Review backup<input
            type="file"
            accept=".json,application/json"
            ?disabled=${this.busy}
            @change=${this.importFile}
        /></label>
        <button
          type="button"
          ?disabled=${this.busy}
          @click=${() =>
            this.run(async () => {
              this.recoveries = await this.execute!('listRecovery', {});
            })}
        >
          Recovery snapshots
        </button>
      </div>
      <h3>Recipe Library</h3>
      <label class="file-button"
        >Review recipe<input
          type="file"
          accept=".json,application/json"
          ?disabled=${this.busy}
          @change=${(event: Event) =>
            this.run(async () => {
              const input = event.target as HTMLInputElement;
              const file = input.files?.[0];
              if (!file) return;
              this.recipeRaw = '';
              this.recipePreview = null;
              const raw = await file.text();
              const { parseBaseRecipe } = await import('@rmsc/domain-core');
              const recipe = parseBaseRecipe(raw);
              this.recipeRaw = raw;
              this.recipePreview = recipe;
              input.value = '';
            })}
      /></label>
      ${this.recipePreview
        ? html`<section aria-label="Recipe preview">
            <h4>${this.recipePreview.id}: ${this.recipePreview.name}</h4>
            <p>
              ${this.recipePreview['status'] === 'draft' ? 'Draft' : 'Recipe'}
            </p>
            ${Array.isArray(this.recipePreview['review_required'])
              ? this.recipePreview['review_required'].map(
                  (issue) => html`<p>${issue}</p>`,
                )
              : nothing}
            <button
              type="button"
              ?disabled=${this.busy}
              @click=${() =>
                this.run(async () => {
                  const result = await this.execute!('addBaseRecipe', {
                    raw: this.recipeRaw,
                  });
                  this.workspace = result.workspace;
                  this.dispatchEvent(
                    new CustomEvent('workspace-updated', {
                      detail: result,
                      bubbles: true,
                      composed: true,
                    }),
                  );
                  this.recipePreview = null;
                  this.recipeRaw = '';
                  this.message =
                    'Recipe added. Existing batches and inventory are unchanged.';
                })}
            >
              Add recipe to library
            </button>
            <button
              type="button"
              ?disabled=${this.busy}
              @click=${() => {
                this.recipePreview = null;
                this.recipeRaw = '';
              }}
            >
              Cancel recipe import
            </button>
          </section>`
        : nothing}
      ${this.recoveries.map(
        (recovery) =>
          html`<p>
            ${recovery.at} · ${recovery.reason}
            <button
              type="button"
              ?disabled=${this.busy}
              @click=${() =>
                this.run(async () => {
                  this.preview = await this.execute!('previewRecovery', {
                    recoveryId: recovery.id,
                  });
                })}
            >
              Review restore
            </button>
          </p>`,
      )}
      <h3>Historical Reconstruction</h3>
      <label class="file-button"
        >History source<input
          type="file"
          accept=".json,application/json"
          ?disabled=${this.busy}
          @change=${this.historyFile}
      /></label>
      ${this.sourceWorkspace
        ? html`<p>
            ${this.sourceWorkspace.receipts?.length || 0} receipts ·
            ${this.sourceWorkspace.batches?.length || 0} batches
          </p>`
        : nothing}
      <form class="stacked-form" @submit=${this.reconstruct}>
        <label
          >Opening date<input
            name="openingDate"
            type="date"
            required
            .value=${this.openingDate}
            @input=${(e: Event) =>
              (this.openingDate = (e.target as HTMLInputElement).value)}
        /></label>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Material</th>
                <th>Unit</th>
                <th>Opening quantity</th>
                <th>Opening unit cost</th>
              </tr>
            </thead>
            <tbody>
              ${stocks.map(
                ({ material, record }, index) =>
                  html`<tr>
                    <td>${material}</td>
                    <td>${record.unit}</td>
                    <td>
                      <input
                        aria-label=${`Opening quantity ${material}`}
                        name=${`quantity-${index}`}
                        type="number"
                        min="0"
                        step="any"
                        value="0"
                        required
                      />
                    </td>
                    <td>
                      <input
                        aria-label=${`Opening unit cost ${material}`}
                        name=${`cost-${index}`}
                        type="number"
                        min="0"
                        step="any"
                        value="0"
                        required
                      />
                    </td>
                  </tr>`,
              )}
            </tbody>
          </table>
        </div>
        <h3>Adjustments</h3>
        <button
          type="button"
          @click=${() => {
            this.adjustments = [
              ...this.adjustments,
              {
                id: crypto.randomUUID(),
                date: '',
                material: '',
                quantity: 0,
                unit: 'g',
                amount_usd: 0,
                reason: '',
              },
            ];
          }}
        >
          Add adjustment
        </button>
        ${this.adjustments.map(
          (row, i) =>
            html`<fieldset class="form-grid">
              <legend>Adjustment ${i + 1}</legend>
              <label
                >Date<input name=${`adj-date-${i}`} type="date" required
              /></label>
              <label
                >Material<input name=${`adj-material-${i}`} required
              /></label>
              <label
                >Quantity change<input
                  name=${`adj-quantity-${i}`}
                  type="number"
                  step="any"
                  required
                  value="0"
              /></label>
              <label
                >Unit<input name=${`adj-unit-${i}`} required value="g"
              /></label>
              <label
                >Value change<input
                  name=${`adj-value-${i}`}
                  type="number"
                  step="0.01"
                  required
                  value="0"
              /></label>
              <label>Reason<input name=${`adj-reason-${i}`} required /></label>
              <button
                type="button"
                @click=${() =>
                  (this.adjustments = this.adjustments.filter(
                    (a) => a.id !== row.id,
                  ))}
              >
                Remove adjustment
              </button>
            </fieldset>`,
        )}
        <label class="confirmation"
          ><input name="confirmed" type="checkbox" required />Opening balances
          confirmed</label
        >
        <button type="submit" class="primary" ?disabled=${this.busy}>
          Preview reconstruction
        </button>
      </form>
      ${this.preview
        ? html`
            <h3>
              ${this.preview.kind === 'reconstruction'
                ? 'Reconstruction'
                : 'Replacement'}
              Preview
            </h3>
            <table>
              <thead>
                <tr>
                  <th>Records</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                ${Object.entries(this.preview.summary.before).map(
                  ([key, count]) =>
                    html`<tr>
                      <td>${key}</td>
                      <td>${count}</td>
                      <td>${this.preview!.summary.after[key]}</td>
                    </tr>`,
                )}
              </tbody>
            </table>
            ${this.preview.issues.map(
              (issue) => html`<p class="warning">${issue}</p>`,
            )}
            ${this.preview.warnings.map((warning) => html`<p>${warning}</p>`)}
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Before</th>
                    <th>After</th>
                    <th>Value before</th>
                    <th>Value after</th>
                  </tr>
                </thead>
                <tbody>
                  ${this.preview.differences.map(
                    (d) =>
                      html`<tr>
                        <td>${d.material}</td>
                        <td>${d.before}</td>
                        <td>${d.after}</td>
                        <td>${money(d.beforeValue)}</td>
                        <td>${money(d.afterValue)}</td>
                      </tr>`,
                  )}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              class="primary"
              ?disabled=${this.busy || this.preview.issues.length > 0}
              @click=${this.commit}
            >
              Confirm
              ${this.preview.kind === 'reconstruction'
                ? 'reconstruction'
                : 'replacement'}
            </button>
            <button type="button" @click=${() => (this.preview = null)}>
              Cancel
            </button>
          `
        : nothing}
    </section>`;
  }

  private importFile = (event: Event) =>
    this.run(async () => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      this.preview = await this.execute!('previewImport', {
        raw: await file.text(),
      });
      input.value = '';
    });
  private historyFile = (event: Event) =>
    this.run(async () => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      const raw = await file.text();
      const { importWorkspace } = await import('@rmsc/domain-core');
      this.sourceWorkspace = importWorkspace(raw);
      this.querySelector('form')?.reset();
      this.sourceRaw = raw;
      this.preview = null;
      input.value = '';
    });
  private reconstruct = (event: SubmitEvent) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    void this.run(async () => {
      const source = this.sourceWorkspace || this.workspace;
      if (!source || form.get('confirmed') !== 'on')
        throw new Error('Confirm opening balances first.');
      const openingInventory: Record<
        string,
        Record<
          string,
          { unit: string; on_hand: number; avg_cost_per_unit: number }
        >
      > = {};
      let index = 0;
      for (const [section, items] of Object.entries(source.inventory))
        for (const [material, record] of Object.entries(items || {})) {
          openingInventory[section] ||= {};
          openingInventory[section][material] = {
            unit: record.unit!,
            on_hand: Number(form.get(`quantity-${index}`)),
            avg_cost_per_unit: Number(form.get(`cost-${index}`)),
          };
          index++;
        }
      const adjustments = this.adjustments.map((a, i) => ({
        ...a,
        date: String(form.get(`adj-date-${i}`)),
        material: String(form.get(`adj-material-${i}`)),
        quantity: Number(form.get(`adj-quantity-${i}`)),
        unit: String(form.get(`adj-unit-${i}`)),
        amount_usd: Number(form.get(`adj-value-${i}`)),
        reason: String(form.get(`adj-reason-${i}`)),
      }));
      this.preview = await this.execute!('previewReconstruction', {
        openingDate: String(form.get('openingDate')),
        openingInventory: openingInventory as Inventory,
        adjustments,
        sourceRaw: this.sourceRaw,
      });
    });
  };
  private commit = () =>
    this.run(async () => {
      if (!this.preview || this.preview.issues.length) return;
      const result = await this.execute!(
        this.preview.kind === 'reconstruction'
          ? 'commitReconstruction'
          : 'commitImport',
        { token: this.preview.token },
      );
      this.preview = null;
      this.message =
        'Reviewed workspace committed. Recovery snapshot retained.';
      this.dispatchEvent(
        new CustomEvent<DecoratedWorkspace>('workspace-updated', {
          detail: result,
          bubbles: true,
          composed: true,
        }),
      );
    });
  private async run(action: () => Promise<void>) {
    if (!this.execute || this.busy) return;
    this.busy = true;
    this.message = '';
    try {
      await action();
    } catch (error) {
      this.message = error instanceof Error ? error.message : String(error);
      this.preview = null;
    } finally {
      this.busy = false;
    }
  }
}
function money(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n);
}

@customElement('production-yield-form')
export class ProductionYieldForm extends LitElement {
  static override styles = weightFormStyles;
  @property({ attribute: false }) workspace: Workspace | null = null;
  @property({ type: Boolean }) busy = false;
  @property() batchId = '';
  @state() private counts: Record<string, number> = {};
  protected override willUpdate(changes: PropertyValues) {
    if (changes.has('batchId')) {
      this.counts = { ...this.batch?.yield_actual?.size_counts };
      this.renderRoot.querySelector('form')?.reset();
    }
  }
  private get batch() {
    return this.workspace?.batches?.find((batch) => batch.id === this.batchId);
  }
  override render() {
    const batch = this.batch;
    const observed = batch?.yield_actual;
    const molds = batch?.formulation?.molds;
    const active = Object.keys(this.workspace?.bar_sizes || {}).filter(
      (id) => this.workspace?.bar_sizes?.[id].active !== false,
    );
    const planned = batch?.formulation?.bar_size;
    const kept = new Set(
      Object.keys(observed?.size_counts || {}).filter(
        (id) => (observed?.size_counts?.[id] || 0) > 0,
      ),
    );
    if (planned) kept.add(planned);
    const sizes = molds?.length
      ? [...new Set(molds.map((mold) => mold.barSize))]
      : planned
        ? active.filter((id) => kept.has(id))
        : active;
    const otherSizes =
      !molds?.length && planned ? active.filter((id) => !kept.has(id)) : [];
    const rows = (ids: string[]) =>
      ids.map((size) =>
        barWeightRow(
          size,
          groupTitle(this.workspace, batch, size),
          sizeLabel(this.workspace, size),
          observed?.size_counts?.[size] ?? 0,
          observed?.weight_g_by_size?.[size],
        ),
      );
    let trim;
    let problem = '';
    try {
      if (batch?.formulation)
        trim = estimatedTrim(batch.formulation, this.counts);
    } catch (error) {
      problem = (error as Error).message;
    }
    const updateCounts = (event: Event) => {
      const field = event.target as HTMLInputElement;
      if (field.name?.startsWith('size-'))
        this.counts = {
          ...this.counts,
          [field.name.slice(5)]: Number(field.value),
        };
    };
    return html`<form @submit=${this.submit} @input=${updateCounts}>
      <h3>Cut yield</h3>
      <div class="groups">${rows(sizes)}</div>
      ${otherSizes.length
        ? html`<details>
            <summary>Other sizes</summary>
            <div class="groups">${rows(otherSizes)}</div>
          </details>`
        : nothing}
      <div class="pair">
        <label
          >Measured trim (g)<input
            name="scrapG"
            type="number"
            min="0"
            step="any"
            value=${observed?.scrap_g ?? ''}
        /></label>
        <label
          >Shredded (g)<input
            name="shreddedG"
            type="number"
            min="0"
            step="any"
            value=${observed?.shredded_g ?? ''}
        /></label>
      </div>
      ${problem
        ? html`<p class="error" role="status">${problem}</p>`
        : trim
          ? html`<p class="muted">
              Estimated unused mold volume:
              ${trim.estimated_trim_in3.toFixed(2)} in3
            </p>`
          : nothing}
      <div class="actions">
        <label
          >Cut date<input
            name="at"
            type="date"
            required
            value=${observed?.recorded_at || workspaceDay(this.workspace)}
        /></label>
        <button
          class="primary"
          type="submit"
          ?disabled=${this.busy ||
          !!problem ||
          !Object.values(this.counts).some((count) => count > 0)}
        >
          Confirm actual yield
        </button>
        <button
          type="button"
          ?disabled=${this.busy}
          @click=${() =>
            this.dispatchEvent(
              new CustomEvent('yield-cancelled', {
                bubbles: true,
                composed: true,
              }),
            )}
        >
          Cancel
        </button>
      </div>
    </form>`;
  }
  private submit = (event: SubmitEvent) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const { sizeCounts, weightGBySize } = readBarWeights(data);
    const scrap = data.get('scrapG');
    const shredded = data.get('shreddedG');
    this.dispatchEvent(
      new CustomEvent('yield-confirmed', {
        detail: {
          batchId: this.batchId,
          sizeCounts,
          ...(Object.keys(weightGBySize).length ? { weightGBySize } : {}),
          ...(scrap !== '' ? { scrapG: Number(scrap) } : {}),
          ...(shredded !== '' ? { shreddedG: Number(shredded) } : {}),
          at: String(data.get('at')),
        },
        bubbles: true,
        composed: true,
      }),
    );
  };
}
