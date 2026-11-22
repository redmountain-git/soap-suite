import { html, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { controlStyles } from './styles/control.styles.generated';
import { VectorElement } from './vector-component-support';
import { emitVectorEvent, labelize, round, transactionId } from './vector-math';
import { vectorThemeStyles } from './vector-theme';
import type { VectorConstraint, VectorItem, VectorRole } from './vector-types';

export class VectorConstraintControl extends VectorElement {
  static override styles = [vectorThemeStyles, controlStyles];

  @property({ attribute: false }) accessor item: VectorItem | null;
  @property({ attribute: false }) accessor value: number;
  @property({ attribute: false }) accessor constraint: VectorConstraint;
  @property({ attribute: false }) accessor mode: VectorRole;

  constructor() {
    super();
    this.item = null;
    this.value = 0;
    this.constraint = {};
    this.mode = 'composition';
    this.theme = {};
  }

  override render(): TemplateResult {
    const item = this.item || { key: '', label: 'Constraint' };
    return html`
      <form class="constraint-row" @change=${this._emit}>
        <strong>${item.label || labelize(item.key)}</strong>
        <span
          >${round(this.value, 1)}${this.mode === 'composition'
            ? '%'
            : ''}</span
        >
        <label
          >Min<input
            name="min"
            data-field="min"
            type="number"
            step=${this.constraint.step || 0.1}
            .value=${String(this.constraint.min ?? 0)}
        /></label>
        <label
          >Max<input
            name="max"
            data-field="max"
            type="number"
            step=${this.constraint.step || 0.1}
            .value=${String(this.constraint.max ?? 100)}
        /></label>
        <label
          >Lock<input
            name="locked"
            data-field="locked"
            type="checkbox"
            .checked=${Boolean(this.constraint.locked)}
        /></label>
      </form>
    `;
  }

  private _emit = (event: Event): void => {
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const patch = {
      min: Number(data.get('min')),
      max: Number(data.get('max')),
      locked: data.get('locked') === 'on',
    };
    emitVectorEvent(this, 'vector-change', {
      source: 'constraint',
      role: 'constraint',
      transactionId: transactionId('constraint'),
      key: this.item?.key,
      constraintRole: this.mode,
      constraint: patch,
    });
  };
}
