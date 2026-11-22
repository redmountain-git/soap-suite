import { html, type TemplateResult } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { quantityInputStyles } from './styles/quantity-input.styles.generated';
import {
  clamp,
  emitVectorEvent,
  labelize,
  round,
  roundToStep,
  transactionId,
} from './vector-math';
import { vectorThemeStyles } from './vector-theme';
import type { VectorEventType } from './vector-types';

import {
  initializeScalarControl,
  ScalarControlController,
  scalarControlProperties,
  type ScalarControlHost,
} from './scalar-control-element';
import { VectorElement } from './vector-component-support';
import type { VectorConstraintRailState, VectorRole } from './vector-types';

export class VectorQuantityInput extends VectorElement {
  static override properties = scalarControlProperties;
  override accessor role: VectorRole = 'composition';
  private readonly scalar = new ScalarControlController(this);
  static override styles = [vectorThemeStyles, quantityInputStyles];

  constructor() {
    super();
    initializeScalarControl(this);
  }

  /** @deprecated Prefer the individual reactive properties. */
  set state(value: Partial<VectorConstraintRailState>) {
    this.scalar.setState(value);
  }
  get state(): VectorConstraintRailState {
    return this.scalar.state;
  }

  override render(): TemplateResult {
    if (!this.item) {
      return html` <div class="empty">Select an item.</div> `;
    }

    const view = this.scalar.viewState();
    const unitOption = this.scalar.unitOption();

    return html`
      <section
        class=${classMap({ 'quantity-input': true, disabled: this.disabled })}
      >
        <label>
          <span>${this.item.label || labelize(this.item.key)}</span>
          <span class="input-wrap">
            <input
              data-quantity
              type="number"
              min=${view.domainMinText}
              max=${view.domainMaxText}
              step=${view.displayStep}
              .value=${view.valueText}
              ?disabled=${this.disabled}
              @change=${(event: Event) =>
                this._emitQuantityValue(
                  Number((event.currentTarget as HTMLInputElement).value),
                  'vector-change',
                  transactionId('quantity-input'),
                )}
            />
            <span class="unit-suffix">${unitOption?.symbol || view.unit}</span>
          </span>
        </label>
      </section>
    `;
  }

  _emitQuantityValue(
    displayTarget: number,
    eventName: Extract<VectorEventType, 'vector-preview' | 'vector-change'>,
    id: string,
  ): void {
    if (!this.item?.key) {
      return;
    }
    const unitOption = this.scalar.unitOption();
    const rawTarget = this.scalar.toCanonical(displayTarget);
    const target = roundToStep(rawTarget, this.scalar.step());
    const clamped = clamp(target, this.scalar.min(), this.scalar.max());
    emitVectorEvent(this, eventName, {
      source: 'inspector',
      role: this.role,
      transactionId: id,
      key: this.item.key,
      previousValue: { [this.item.key]: this.value },
      requestedValue: { [this.item.key]: target },
      proposedValue: { [this.item.key]: clamped },
      delta: round(clamped - this.value, 4),
      unitKey: unitOption?.key,
      basis: unitOption?.basis || this.basis || this.item?.basis,
      measurementScope: unitOption?.scope || this.measurementScope,
      measurementMeasure: unitOption?.measure || this.measurementMeasure,
      displayValue: this.scalar.toDisplay(clamped),
      canonicalValue: clamped,
      measurementSystem: this.measurementSystem || unitOption?.system,
      hits: [],
    });
  }
}

export interface VectorQuantityInput extends ScalarControlHost {}
