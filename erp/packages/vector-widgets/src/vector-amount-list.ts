import { html, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { amountListStyles } from './styles/amount-list.styles.generated';
import { VectorElement } from './vector-component-support';
import { DEFAULT_VECTOR_PALETTE } from './vector-constants';
import { vectorThemeStyles } from './vector-theme';
import type {
  MeasurementBasis,
  MeasurementMeasure,
  MeasurementScope,
  MeasurementSystem,
  NamedVector,
  ScalarVectorItem,
  ThresholdBand,
  VectorAmountContext,
  VectorAmountListState,
  VectorConstraint,
  VectorConstraintRailState,
  VectorRole,
} from './vector-types';

export class VectorAmountList extends VectorElement {
  static override styles = [vectorThemeStyles, amountListStyles];

  @property({ attribute: false }) accessor items: ScalarVectorItem[];
  @property({ attribute: false }) accessor values: NamedVector;
  @property({ attribute: false }) accessor constraints: Record<
    string,
    VectorConstraint
  >;
  @property({ attribute: false }) accessor thresholds: Record<
    string,
    ThresholdBand[]
  >;
  @property({ attribute: false }) accessor unitPreferences: Record<
    string,
    string
  >;
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
  @property({ attribute: false }) accessor context: VectorAmountContext | null;
  @property({ attribute: false }) override accessor role: VectorRole;
  @property({ attribute: false }) accessor control: string;
  @property({ attribute: false }) accessor unitDisplay: string;
  @property({ attribute: false }) accessor activeEmphasis: boolean;
  @property({ attribute: false }) accessor palette: readonly string[];

  constructor() {
    super();
    this.items = [];
    this.values = {};
    this.constraints = {};
    this.thresholds = {};
    this.unitPreferences = {};
    this.measurementSystem = '';
    this.basis = '';
    this.measurementScope = '';
    this.measurementMeasure = '';
    this.context = null;
    this.role = 'additive';
    this.control = 'slider';
    this.unitDisplay = 'picker';
    this.activeEmphasis = true;
    this.theme = {};
    this.palette = DEFAULT_VECTOR_PALETTE;
  }

  /** @deprecated Prefer individual reactive properties. */
  set state(value: Partial<VectorAmountListState>) {
    const state = value ?? {};
    this.items = state.items ?? [];
    this.values = state.values ?? {};
    this.constraints = state.constraints ?? {};
    this.thresholds = state.thresholds ?? {};
    this.unitPreferences = state.unitPreferences ?? {};
    this.measurementSystem = state.measurementSystem ?? '';
    this.basis = state.basis ?? '';
    this.measurementScope = state.measurementScope ?? '';
    this.measurementMeasure = state.measurementMeasure ?? '';
    this.context = state.context ?? null;
    this.role = state.role ?? 'additive';
    this.control = state.control ?? 'slider';
    this.unitDisplay = state.unitDisplay ?? 'picker';
    this.activeEmphasis = state.activeEmphasis !== false;
    this.theme = state.theme ?? {};
    this.palette = state.palette ?? DEFAULT_VECTOR_PALETTE;
  }

  override render(): TemplateResult {
    return html`
      <div class="amount-list">
        ${this.items.length
          ? repeat(
              this.items,
              (item) => item.key,
              (item) => {
                const state: VectorConstraintRailState = {
                  item,
                  value: this.values[item.key] ?? item.defaultValue ?? 0,
                  defaultValue: item.defaultValue,
                  constraint: this.constraints[item.key] ?? {},
                  hits: [],
                  thresholds:
                    this.thresholds[item.key] ?? item.thresholds ?? [],
                  unitOptions: item.unitOptions ?? [],
                  unitKey: this._unitKeyForItem(item),
                  measurementSystem: this.measurementSystem,
                  basis: this.basis,
                  measurementScope: this.measurementScope,
                  measurementMeasure: this.measurementMeasure,
                  context: {
                    ...(this.context ?? {}),
                    density:
                      this.context?.densities?.[item.material || item.key] ??
                      this.context?.density,
                  },
                  role: this.role,
                  rangeMin: item.min ?? 0,
                  rangeMax: item.max ?? 100,
                  precision: item.precision,
                  theme: this.theme,
                  palette: this.palette,
                  variant: 'embedded',
                  unitDisplay: this.unitDisplay,
                  activeEmphasis: this.activeEmphasis,
                };
                return this._renderControl(state);
              },
            )
          : html`<div class="quiet">No selected amounts.</div>`}
      </div>
    `;
  }

  private _renderControl(state: VectorConstraintRailState): TemplateResult {
    return this.control === 'constraint'
      ? html`<vector-scalar-rail
          .item=${state.item}
          .value=${state.value}
          .constraint=${state.constraint}
          .role=${state.role}
          .hits=${state.hits}
          .rangeMin=${state.rangeMin}
          .rangeMax=${state.rangeMax}
          .precision=${state.precision ?? null}
          .defaultValue=${state.defaultValue ?? null}
          .thresholds=${state.thresholds ?? []}
          .unitOptions=${state.unitOptions ?? []}
          .unitKey=${state.unitKey ?? ''}
          .measurementSystem=${state.measurementSystem ?? ''}
          .basis=${state.basis ?? ''}
          .measurementScope=${state.measurementScope ?? ''}
          .measurementMeasure=${state.measurementMeasure ?? ''}
          .context=${state.context ?? null}
          .disabled=${state.disabled}
          .palette=${state.palette}
          .variant=${state.variant}
          .unitDisplay=${state.unitDisplay}
          .activeEmphasis=${state.activeEmphasis}
        ></vector-scalar-rail>`
      : html`<vector-value-slider
          .item=${state.item}
          .value=${state.value}
          .constraint=${state.constraint}
          .role=${state.role}
          .hits=${state.hits}
          .rangeMin=${state.rangeMin}
          .rangeMax=${state.rangeMax}
          .precision=${state.precision ?? null}
          .defaultValue=${state.defaultValue ?? null}
          .thresholds=${state.thresholds ?? []}
          .unitOptions=${state.unitOptions ?? []}
          .unitKey=${state.unitKey ?? ''}
          .measurementSystem=${state.measurementSystem ?? ''}
          .basis=${state.basis ?? ''}
          .measurementScope=${state.measurementScope ?? ''}
          .measurementMeasure=${state.measurementMeasure ?? ''}
          .context=${state.context ?? null}
          .disabled=${state.disabled}
          .palette=${state.palette}
          .variant=${state.variant}
          .unitDisplay=${state.unitDisplay}
          .activeEmphasis=${state.activeEmphasis}
        ></vector-value-slider>`;
  }

  private _unitKeyForItem(item: ScalarVectorItem): string {
    const unitKey = this.unitPreferences[item.key] ?? '';
    if (!unitKey) {
      return '';
    }
    const option = (item.unitOptions ?? []).find(
      (candidate) => candidate.key === unitKey,
    );
    if (!option) {
      return '';
    }
    return unitKey;
  }
}
