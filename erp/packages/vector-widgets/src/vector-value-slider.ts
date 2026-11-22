import { html, nothing, type TemplateResult } from 'lit';
import { query } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { styleVariables } from './style-variables';
import { valueSliderStyles } from './styles/value-slider.styles.generated';
import { colorForItem, compactUnitLabel } from './vector-formatting';
import {
  clamp,
  emitVectorEvent,
  labelize,
  round,
  roundToStep,
  transactionId,
} from './vector-math';
import { vectorThemeStyles } from './vector-theme';
import type { UnitOption, VectorEventType } from './vector-types';

import {
  initializeScalarControl,
  ScalarControlController,
  scalarControlProperties,
  type ScalarControlHost,
} from './scalar-control-element';
import { VectorElement } from './vector-component-support';
import type { VectorConstraintRailState, VectorRole } from './vector-types';
import { renderThresholdSegments } from './scalar-threshold-template';

export class VectorValueSlider extends VectorElement {
  static override properties = scalarControlProperties;
  override accessor role: VectorRole = 'composition';
  private readonly scalar = new ScalarControlController(this);
  @query('[data-slider]') private accessor sliderElement!: HTMLInputElement;
  static override styles = [vectorThemeStyles, valueSliderStyles];

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
    const valueText = view.valueText;
    const unit = view.unit;
    const unitOption = this.scalar.unitOption();
    const description =
      this.item.description || this.item.summary || this.item.purpose || '';
    const active =
      this.activeEmphasis && Math.abs(Number(this.value || 0)) > 1e-9;
    const transaction = () =>
      this.sliderElement?.dataset['transaction'] ||
      transactionId('value-slider');

    return html`
      <section
        class=${classMap({
          'value-slider': true,
          active,
          disabled: this.disabled,
        })}
        data-threshold=${view.thresholdKey || ''}
      >
        <div class="slider-head">
          <span
            class="swatch"
            ${styleVariables({
              '--item-color': colorForItem(this.item, 0, this.palette),
            })}
          ></span>
          <div class="slider-copy">
            <label for="slider"
              >${this.item.label || labelize(this.item.key)}</label
            >
            ${description ? html`<small>${description}</small>` : nothing}
          </div>
          <span class="slider-value">
            <output>${valueText}</output>
            ${this._renderUnit(unitOption, unit)}
          </span>
        </div>
        <div class="slider-track">
          <div class="full-track"></div>
          <div class="threshold-track" aria-hidden="true">
            ${renderThresholdSegments({
              thresholds: this.thresholds,
              value: this.value,
              percent: (value) => this.scalar.pct(value),
              activeThreshold: (value) => this.scalar.thresholdFor(value),
            })}
          </div>
          <span
            class="current-marker"
            ${styleVariables({ '--marker-position': `${view.valuePct}%` })}
          ></span>
          <input
            id="slider"
            data-slider
            type="range"
            min=${view.domainMinText}
            max=${view.domainMaxText}
            step=${view.displayStep}
            .value=${valueText}
            ?disabled=${this.disabled}
            @input=${(event: Event) => {
              const input = event.currentTarget as HTMLInputElement;
              input.dataset['transaction'] ||= transactionId('value-slider');
              this._emitSliderValue(
                Number(input.value),
                'vector-preview',
                input.dataset['transaction'] ?? transaction(),
              );
            }}
            @change=${(event: Event) => {
              const input = event.currentTarget as HTMLInputElement;
              const id = input.dataset['transaction'] ?? transaction();
              delete input.dataset['transaction'];
              this._emitSliderValue(Number(input.value), 'vector-change', id);
            }}
            @keydown=${(event: KeyboardEvent) => this._sliderKeydown(event)}
          />
        </div>
      </section>
    `;
  }

  private _renderUnit(
    unitOption: UnitOption | null,
    unit: string,
  ): TemplateResult {
    const options = this._unitPickerOptions();
    const label = compactUnitLabel(unitOption, unit);
    if (this.unitDisplay === 'text') {
      return html`<span
        class="unit-text"
        data-unit
        data-unit-key=${unitOption?.key || ''}
        title=${unitOption?.label || label}
        >${label}</span
      >`;
    }
    if (options.length <= 1) {
      return html`<span
        class="unit-pill static"
        data-unit
        data-unit-key=${unitOption?.key || ''}
        title=${unitOption?.label || label}
        >${label}</span
      >`;
    }
    return html`
      <details class="unit-picker">
        <summary
          data-unit
          data-unit-pill
          data-unit-key=${unitOption?.key || ''}
          aria-label=${`Change unit, currently ${unitOption?.label || label}`}
          title=${`Change unit, currently ${unitOption?.label || label}`}
        >
          ${label}
        </summary>
        <div class="unit-menu" role="listbox" aria-label="Units">
          ${options.map(
            (option) => html`
              <button
                type="button"
                class=${classMap({ selected: option.key === unitOption?.key })}
                data-unit-option=${option.key}
                role="option"
                aria-selected=${String(option.key === unitOption?.key)}
                @click=${(event: MouseEvent) => {
                  event.preventDefault();
                  this.scalar.changeUnit(option.key);
                  this._closeUnitPicker(event.currentTarget as Element);
                }}
              >
                ${option.label || compactUnitLabel(option, option.symbol)}
              </button>
            `,
          )}
        </div>
      </details>
    `;
  }

  private _unitPickerOptions(): UnitOption[] {
    return this.unitOptions;
  }

  private _closeUnitPicker(node: Element): void {
    const details = node.closest('details');
    if (details) {
      details.open = false;
    }
  }

  _emitSliderValue(
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
    const threshold = this.scalar.thresholdFor(clamped);
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
      thresholdKey: threshold?.key,
      measurementSystem: this.measurementSystem || unitOption?.system,
      hits: [],
    });
  }

  private _sliderKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return;
    }
    const input = event.currentTarget as HTMLInputElement;
    const transaction =
      input.dataset['transaction'] ?? transactionId('value-slider-cancel');
    delete input.dataset['transaction'];
    emitVectorEvent(this, 'vector-cancel', {
      source: 'inspector',
      role: this.role,
      transactionId: transaction,
      key: this.item?.key,
    });
  }
}

export interface VectorValueSlider extends ScalarControlHost {}
