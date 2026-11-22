import { html, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleVariables } from './style-variables';
import { summaryStyles } from './styles/summary.styles.generated';
import { VectorElement } from './vector-component-support';
import { formatNumber, thresholdForValue } from './vector-formatting';
import { clamp, emitVectorEvent, labelize, transactionId } from './vector-math';
import { vectorThemeStyles } from './vector-theme';
import type { SummaryMeterItem, ThresholdBand } from './vector-types';

export class VectorSummaryMeter extends VectorElement {
  static override styles = [vectorThemeStyles, summaryStyles];

  @property({ attribute: false }) accessor items: SummaryMeterItem[];

  constructor() {
    super();
    this.items = [];
    this.theme = {};
  }

  override render(): TemplateResult {
    return html`
      <div class="summary-meter">
        ${this.items.length
          ? repeat(
              this.items,
              (item) => item.key,
              (item) => {
                const threshold = thresholdForValue(
                  item.value,
                  item.thresholds ?? [],
                );
                const min = Number(item.min ?? 0);
                const max = Number(item.max ?? 100);
                const pct = clamp(
                  ((Number(item.value ?? 0) - min) / (max - min || 1)) * 100,
                  0,
                  100,
                );
                return html`
                  <button
                    type="button"
                    class=${classMap({
                      'summary-row': true,
                      [threshold?.severity || item.severity || 'ok']: true,
                    })}
                    data-key=${item.key}
                    @click=${() => this._select(item, threshold)}
                  >
                    <span>${item.label || labelize(item.key)}</span>
                    <span class="summary-track"
                      ><span
                        ${styleVariables({ '--meter-fill': `${pct}%` })}
                      ></span
                    ></span>
                    <strong
                      >${formatNumber(
                        item.value,
                        item.precision ?? 1,
                      )}${item.unit || ''}</strong
                    >
                  </button>
                `;
              },
            )
          : html`<div class="quiet">No summary values.</div>`}
      </div>
    `;
  }

  private _select(
    item: SummaryMeterItem,
    threshold: ThresholdBand | null,
  ): void {
    emitVectorEvent(this, 'vector-select', {
      source: 'table',
      role: 'summary',
      transactionId: transactionId('summary'),
      key: item.key,
      thresholdKey: threshold?.key,
    });
  }
}
