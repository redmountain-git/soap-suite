import { html, nothing, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import { unitToggleStyles } from './styles/unit-toggle.styles.generated';
import { VectorElement } from './vector-component-support';
import { emitVectorEvent, transactionId } from './vector-math';
import { vectorThemeStyles } from './vector-theme';
import type {
  MeasurementBasis,
  MeasurementMeasure,
  MeasurementScope,
  MeasurementSystem,
  UnitOption,
  VectorUnitToggleState,
} from './vector-types';

export class VectorUnitToggle extends VectorElement {
  static override styles = [vectorThemeStyles, unitToggleStyles];

  @property({ attribute: false }) accessor options: UnitOption[];
  @property({ attribute: false }) accessor unitKey: string;
  @property({ attribute: false }) accessor label: string;
  @property({ attribute: false }) accessor groupKey: string;
  @property({ attribute: false }) accessor measurementSystem:
    | MeasurementSystem
    | '';
  @property({ attribute: false }) accessor basis: MeasurementBasis | '';
  @property({ attribute: false }) accessor measurementScope:
    | MeasurementScope
    | '';
  @property({ attribute: false }) accessor measurementMeasure:
    | MeasurementMeasure
    | '';
  @property({ attribute: false }) accessor disabled: boolean;

  constructor() {
    super();
    this.options = [];
    this.unitKey = '';
    this.label = '';
    this.groupKey = '';
    this.measurementSystem = '';
    this.basis = '';
    this.measurementScope = '';
    this.measurementMeasure = '';
    this.disabled = false;
    this.theme = {};
  }

  /** @deprecated Prefer individual reactive properties. */
  set state(
    value: Partial<VectorUnitToggleState> & {
      unitOptions?: UnitOption[];
      key?: string;
    },
  ) {
    const state = value ?? {};
    this.options = state.options ?? state.unitOptions ?? [];
    this.unitKey = state.unitKey ?? '';
    this.label = state.label ?? '';
    this.groupKey = state.groupKey ?? state.key ?? '';
    this.measurementSystem = state.measurementSystem ?? '';
    this.basis = state.basis ?? '';
    this.measurementScope = state.measurementScope ?? '';
    this.measurementMeasure = state.measurementMeasure ?? '';
    this.disabled = state.disabled ?? false;
    this.theme = state.theme ?? {};
  }
  get state() {
    return {
      options: this.options,
      unitKey: this.unitKey,
      label: this.label,
      groupKey: this.groupKey,
      measurementSystem: this.measurementSystem,
      basis: this.basis,
      measurementScope: this.measurementScope,
      measurementMeasure: this.measurementMeasure,
      disabled: this.disabled,
      theme: this.theme,
    };
  }

  override render(): TemplateResult {
    return html`
      <div
        class=${classMap({
          'unit-toggle': true,
          binary: this.options.length === 2,
        })}
        role="group"
        aria-label=${this.label || 'Measurement units'}
      >
        ${this.label
          ? html`<span class="toggle-label">${this.label}</span>`
          : nothing}
        <span class="toggle-options">
          ${repeat(
            this.options,
            (option) => option.key,
            (option) => {
              const selected = this.unitKey
                ? option.key === this.unitKey
                : option.system
                  ? option.system === this.measurementSystem
                  : option.basis === this.basis ||
                    option.scope === this.measurementScope ||
                    option.measure === this.measurementMeasure;
              return html`
                <button
                  type="button"
                  class=${classMap({ selected })}
                  ?disabled=${this.disabled}
                  aria-pressed=${String(Boolean(selected))}
                  @click=${() => this._select(option)}
                >
                  ${option.label}
                </button>
              `;
            },
          )}
        </span>
      </div>
    `;
  }

  private _select(option: UnitOption): void {
    emitVectorEvent(this, 'vector-change', {
      source: 'inspector',
      role: 'measurement',
      transactionId: transactionId('unit'),
      key: this.groupKey,
      unitKey: option.key,
      basis: option.basis,
      measurementScope: option.scope || this.measurementScope,
      measurementMeasure: option.measure || this.measurementMeasure,
      measurementSystem: option.system || this.measurementSystem,
    });
  }
}
