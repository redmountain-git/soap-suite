import { html, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { styleVariables } from './style-variables';
import { inspectorStyles } from './styles/inspector.styles.generated';
import { VectorElement } from './vector-component-support';
import { DEFAULT_VECTOR_PALETTE } from './vector-constants';
import { colorForItem } from './vector-formatting';
import {
  clamp,
  emitVectorEvent,
  labelize,
  round,
  transactionId,
} from './vector-math';
import { vectorThemeStyles } from './vector-theme';
import type {
  VectorConstraint,
  VectorEventType,
  VectorItem,
  VectorRole,
} from './vector-types';

export class VectorInspector extends VectorElement {
  static override styles = [vectorThemeStyles, inspectorStyles];

  @property({ attribute: false }) accessor item: VectorItem | null;
  @property({ attribute: false }) accessor value: number;
  @property({ attribute: false }) accessor constraint: VectorConstraint;
  @property({ attribute: false }) override accessor role: VectorRole;
  @property({ attribute: false }) accessor palette: readonly string[];

  constructor() {
    super();
    this.item = null;
    this.value = 0;
    this.constraint = {};
    this.role = 'composition';
    this.theme = {};
    this.palette = DEFAULT_VECTOR_PALETTE;
  }

  override render(): TemplateResult {
    if (!this.item) {
      return html` <div class="empty">Select an oil or quality.</div> `;
    }
    const min = Number(this.constraint.min ?? this.item.min ?? 0);
    const max = Number(this.constraint.max ?? this.item.max ?? 100);
    const step = Number(
      this.constraint.step ??
        this.item.step ??
        (this.role === 'composition' ? 0.1 : 1),
    );
    return html`
      <section class="inspector">
        <header>
          <span
            class="swatch"
            ${styleVariables({
              '--item-color': colorForItem(this.item, 0, this.palette),
            })}
          ></span>
          <strong>${this.item.label || labelize(this.item.key)}</strong>
          <span
            >${round(this.value, 1)}${this.role === 'composition'
              ? '%'
              : ''}</span
          >
        </header>
        <input
          class="range"
          type="range"
          min=${min}
          max=${max}
          step=${step}
          .value=${String(this.value)}
          ?disabled=${Boolean(this.constraint.locked)}
          @input=${(event: Event) =>
            this._emit(
              Number((event.currentTarget as HTMLInputElement).value),
              'vector-preview',
            )}
          @change=${(event: Event) =>
            this._emit(
              Number((event.currentTarget as HTMLInputElement).value),
              'vector-change',
            )}
        />
        <div class="stepper">
          <button
            data-delta=${-step}
            ?disabled=${Boolean(this.constraint.locked)}
            @click=${() => this._emit(this.value - step, 'vector-change')}
          >
            -
          </button>
          <input
            class="exact"
            type="number"
            min=${min}
            max=${max}
            step=${step}
            .value=${String(round(this.value, 2))}
            ?disabled=${Boolean(this.constraint.locked)}
            @change=${(event: Event) =>
              this._emit(
                Number((event.currentTarget as HTMLInputElement).value),
                'vector-change',
              )}
          />
          <button
            data-delta=${step}
            ?disabled=${Boolean(this.constraint.locked)}
            @click=${() => this._emit(this.value + step, 'vector-change')}
          >
            +
          </button>
        </div>
      </section>
    `;
  }

  private _emit(
    target: number,
    name: Extract<VectorEventType, 'vector-preview' | 'vector-change'>,
  ): void {
    const item = this.item;
    if (!item) return;
    const next = clamp(
      target,
      this.constraint.min ?? item.min ?? 0,
      this.constraint.max ?? item.max ?? 100,
    );
    emitVectorEvent(this, name, {
      source: 'inspector',
      role: this.role,
      transactionId: transactionId('inspector'),
      key: item.key,
      requestedValue: { [item.key]: next },
      proposedValue: { [item.key]: next },
      delta: round(next - this.value, 4),
    });
  }
}
