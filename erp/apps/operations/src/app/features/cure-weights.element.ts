import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { cutMassBalance } from '@rmsc/domain-core';
import type { CureWeighIn, NumericMap, Workspace } from '@rmsc/worker-protocol';
import type { ExecuteWorkspace } from './data-recovery.element';
import {
  barWeightRow,
  grams,
  groupTitle,
  readBarWeights,
  sizeLabel,
  weightFormStyles,
  workspaceDay,
} from './batch-weight-fields';

@customElement('batch-cure-weights')
export class BatchCureWeights extends LitElement {
  static override styles = weightFormStyles;
  @property({ attribute: false }) workspace: Workspace | null = null;
  @property({ attribute: false }) execute: ExecuteWorkspace | null = null;
  @property() batchId = '';
  @state() private open = false;
  @state() private busy = false;
  @state() private message = '';
  @state() private failed = false;

  protected override willUpdate(changes: PropertyValues) {
    if (changes.has('batchId')) {
      this.open = false;
      this.message = '';
    }
  }

  private get batch() {
    return this.workspace?.batches?.find((batch) => batch.id === this.batchId);
  }

  override render() {
    const batch = this.batch;
    const cut = batch?.yield_actual;
    if (!batch || !cut) return nothing;
    const counts = cut.size_counts || {};
    const sizes = Object.keys(counts).filter((size) => counts[size] > 0);
    const readings = batch.cure_weigh_ins || [];
    const recentCounts = readings.reduce<NumericMap>(
      (countMap, entry) => ({ ...countMap, ...entry.size_counts }),
      counts,
    );
    const latest = readings.at(-1);
    const mass = cutMassBalance(batch);
    const cutDate = batch.cut_at || cut.recorded_at;
    const canWeigh =
      this.execute &&
      sizes.length &&
      cutDate &&
      !batch.reconciliation_required &&
      (batch.status === 'curing' || batch.status === 'cured');
    const today = workspaceDay(this.workspace);
    return html`
      <p class="muted">
        Cut yield:
        ${sizes.map((size, index) => {
          const weight = cut.weight_g_by_size?.[size];
          return html`${index ? ' / ' : ''}${counts[size]} x
          ${sizeLabel(this.workspace, size)}
          ${weight === undefined
            ? nothing
            : html`(${grams(weight)} g; ${grams(weight / counts[size])} g/bar)`}`;
        })}
      </p>
      ${cut.scrap_g !== undefined
        ? html`<p class="muted">Measured trim: ${grams(cut.scrap_g)} g</p>`
        : nothing}
      ${mass
        ? html`<p class="muted">
            ${grams(mass.accountedG)} g accounted for of ${grams(mass.inputG)} g
            recorded in; ${grams(Math.abs(mass.gapG))} g
            ${mass.gapG >= 0 ? 'unaccounted for' : 'over recorded input'}.
          </p>`
        : nothing}
      ${cut.estimated_trim_in3 !== undefined
        ? html`<p class="muted">
            Estimated unused mold volume: ${cut.estimated_trim_in3.toFixed(2)}
            in3 (${cut.estimated_trim_pct?.toFixed(1)}%)
          </p>`
        : nothing}
      ${latest
        ? html`<p>Latest weigh-in: ${latest.at}</p>
            ${this.renderReading(latest, counts, cut.weight_g_by_size)}`
        : nothing}
      ${canWeigh && !this.open
        ? html`<button
            type="button"
            @click=${() => {
              this.open = true;
              this.message = '';
            }}
          >
            Weigh bars
          </button>`
        : nothing}
      ${canWeigh && this.open
        ? html`<form @submit=${this.submit}>
            <h3>Cure weigh-in</h3>
            <div class="groups">
              ${sizes.map((size) =>
                barWeightRow(
                  size,
                  groupTitle(this.workspace, batch, size),
                  sizeLabel(this.workspace, size),
                  recentCounts[size],
                ),
              )}
            </div>
            <div class="actions">
              <label
                >Weigh-in date<input
                  name="at"
                  type="date"
                  value=${today}
                  min=${cutDate}
                  max=${today}
                  required
              /></label>
              <button class="primary" type="submit" ?disabled=${this.busy}>
                Save weigh-in
              </button>
              <button
                type="button"
                ?disabled=${this.busy}
                @click=${() => {
                  this.open = false;
                  this.message = '';
                }}
              >
                Cancel
              </button>
            </div>
          </form>`
        : nothing}
      ${this.message
        ? html`<p role="status" class=${this.failed ? 'error' : ''}>
            ${this.message}
          </p>`
        : nothing}
      ${readings.length
        ? html`<details>
            <summary>Weigh-in history (${readings.length})</summary>
            <ol class="history">
              ${[...readings].reverse().map(
                (entry) =>
                  html`<li>
                    <strong>${entry.at}</strong>
                    ${this.renderReading(entry, counts, cut.weight_g_by_size)}
                  </li>`,
              )}
            </ol>
          </details>`
        : nothing}
    `;
  }

  private renderReading(
    entry: CureWeighIn,
    cutCounts: NumericMap,
    cutWeights?: NumericMap,
  ) {
    return Object.entries(entry.weight_g_by_size).map(([size, weight]) => {
      const count = entry.size_counts[size];
      const cutWeight = cutWeights?.[size];
      const change =
        cutWeight === undefined
          ? undefined
          : ((weight - cutWeight) / cutWeight) * 100;
      return html`<span class="reading muted">
        ${sizeLabel(this.workspace, size)}: ${count} bars / ${grams(weight)} g /
        ${grams(weight / count)} g per bar
        ${change === undefined
          ? nothing
          : count === cutCounts[size]
            ? html`(${change > 0 ? '+' : ''}${grams(change)}% vs cut)`
            : html`(count changed; no loss estimate)`}
      </span>`;
    });
  }

  private async submit(event: SubmitEvent) {
    event.preventDefault();
    if (this.busy || !this.execute) return;
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const { sizeCounts, weightGBySize } = readBarWeights(data);
    this.busy = true;
    this.message = '';
    this.failed = false;
    try {
      const result = await this.execute('recordCureWeighIn', {
        batchId: this.batchId,
        at: String(data.get('at')),
        sizeCounts: Object.fromEntries(
          Object.keys(weightGBySize).map((size) => [size, sizeCounts[size]]),
        ),
        weightGBySize,
      });
      this.dispatchEvent(
        new CustomEvent('workspace-updated', {
          detail: result,
          bubbles: true,
          composed: true,
        }),
      );
      this.open = false;
      this.message = 'Weigh-in saved.';
    } catch (error) {
      this.failed = true;
      this.message =
        error instanceof Error ? error.message : 'Weigh-in not saved.';
    } finally {
      this.busy = false;
    }
  }
}
