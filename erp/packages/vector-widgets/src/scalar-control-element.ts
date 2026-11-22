import type { PropertyDeclarations, ReactiveController } from 'lit';
import {
  convertFromCanonical,
  convertToCanonical,
  resolveUnitOption,
  unitMatchesPreferences,
} from './scalar-control-model';
import { DEFAULT_VECTOR_PALETTE } from './vector-constants';
import {
  colorForItem,
  formatNumber,
  normalizePalette,
  placesForStep,
} from './vector-formatting';
import { clamp, emitVectorEvent, transactionId } from './vector-math';
import type {
  ConstraintHit,
  MeasurementBasis,
  MeasurementMeasure,
  MeasurementScope,
  MeasurementSystem,
  ScalarVectorItem,
  ThresholdBand,
  UnitOption,
  VectorConstraint,
  VectorConstraintRailState,
  VectorRole,
} from './vector-types';
import type { VectorElement } from './vector-component-support';

export type ScalarHandle = 'min' | 'value' | 'max';
export interface ScalarDomain {
  min: number;
  max: number;
}
export interface ScalarRailViewState {
  domain: ScalarDomain;
  min: number;
  max: number;
  value: number;
  displayMin: number;
  displayMax: number;
  displayValue: number;
  locked: boolean;
  places: number;
  unit: string;
  itemColor: string;
  minPct: number;
  maxPct: number;
  valuePct: number;
  minText: string;
  maxText: string;
  valueText: string;
  domainMinText: string;
  domainMaxText: string;
  displayStep: number;
  thresholdKey: string;
}

export interface ScalarControlHost extends VectorElement {
  item: ScalarVectorItem | null;
  value: number;
  constraint: VectorConstraint;
  role: VectorRole;
  hits: ConstraintHit[];
  rangeMin: number;
  rangeMax: number;
  precision: number | null;
  defaultValue: number | null;
  thresholds: ThresholdBand[];
  unitOptions: UnitOption[];
  unitKey: string;
  measurementSystem: MeasurementSystem | '';
  basis: MeasurementBasis | '';
  measurementScope: MeasurementScope | '';
  measurementMeasure: MeasurementMeasure | '';
  context: unknown;
  disabled: boolean;
  palette: readonly string[];
  variant: string;
  unitDisplay: string;
  activeEmphasis: boolean;
}

export const scalarControlProperties: PropertyDeclarations = {
  item: { attribute: false },
  value: { attribute: false },
  constraint: { attribute: false },
  role: { attribute: false },
  hits: { attribute: false },
  rangeMin: { attribute: false },
  rangeMax: { attribute: false },
  precision: { attribute: false },
  defaultValue: { attribute: false },
  thresholds: { attribute: false },
  unitOptions: { attribute: false },
  unitKey: { attribute: false },
  measurementSystem: { attribute: false },
  basis: { attribute: false },
  measurementScope: { attribute: false },
  measurementMeasure: { attribute: false },
  context: { attribute: false },
  disabled: { attribute: false },
  palette: { attribute: false },
  variant: { attribute: false },
  unitDisplay: { attribute: false },
  activeEmphasis: { attribute: false },
};

export function initializeScalarControl(host: ScalarControlHost): void {
  host.item = null;
  host.value = 0;
  host.constraint = {};
  host.role = 'composition';
  host.hits = [];
  host.rangeMin = 0;
  host.rangeMax = 100;
  host.precision = null;
  host.defaultValue = null;
  host.thresholds = [];
  host.unitOptions = [];
  host.unitKey = '';
  host.measurementSystem = '';
  host.basis = '';
  host.measurementScope = '';
  host.measurementMeasure = '';
  host.context = null;
  host.disabled = false;
  host.theme = {};
  host.palette = DEFAULT_VECTOR_PALETTE;
  host.variant = 'default';
  host.unitDisplay = 'picker';
  host.activeEmphasis = true;
}

export class ScalarControlController implements ReactiveController {
  constructor(readonly host: ScalarControlHost) {
    host.addController(this);
  }
  hostConnected(): void {}

  get state(): VectorConstraintRailState {
    const h = this.host;
    return {
      item: h.item,
      value: h.value,
      constraint: h.constraint,
      role: h.role,
      hits: h.hits,
      rangeMin: h.rangeMin,
      rangeMax: h.rangeMax,
      precision: h.precision,
      defaultValue: h.defaultValue,
      thresholds: h.thresholds,
      unitOptions: h.unitOptions,
      unitKey: h.unitKey,
      measurementSystem: h.measurementSystem,
      basis: h.basis,
      measurementScope: h.measurementScope,
      measurementMeasure: h.measurementMeasure,
      context: h.context,
      disabled: h.disabled,
      theme: h.theme,
      palette: h.palette,
      variant: h.variant,
      unitDisplay: h.unitDisplay,
      activeEmphasis: h.activeEmphasis,
    };
  }
  setState(value: Partial<VectorConstraintRailState>): void {
    const h = this.host;
    Object.assign(h, {
      item: value.item ?? null,
      value: Number(value.value ?? 0),
      constraint: value.constraint ?? {},
      role: value.role ?? 'composition',
      hits: value.hits ?? [],
      rangeMin: Number(value.rangeMin ?? 0),
      rangeMax: Number(value.rangeMax ?? 100),
      precision: value.precision == null ? null : Number(value.precision),
      defaultValue:
        value.defaultValue == null ? null : Number(value.defaultValue),
      thresholds: value.thresholds ?? value.item?.thresholds ?? [],
      unitOptions: value.unitOptions ?? value.item?.unitOptions ?? [],
      unitKey: value.unitKey ?? '',
      measurementSystem: value.measurementSystem ?? '',
      basis: value.basis ?? '',
      measurementScope: value.measurementScope ?? '',
      measurementMeasure: value.measurementMeasure ?? '',
      context: value.context ?? null,
      disabled: Boolean(value.disabled),
      theme: value.theme ?? {},
      palette: normalizePalette(value.palette),
      variant: value.variant ?? 'default',
      unitDisplay: value.unitDisplay ?? 'picker',
      activeEmphasis: value.activeEmphasis !== false,
    });
  }
  patchState(value: Partial<VectorConstraintRailState>): void {
    Object.assign(this.host, value);
  }
  viewState(): ScalarRailViewState {
    const h = this.host;
    const domain = this.domain();
    const min = this.min();
    const max = this.max();
    const value = clamp(h.value, domain.min, domain.max);
    const places = this.places();
    const displayMin = this.toDisplay(min);
    const displayMax = this.toDisplay(max);
    const displayValue = this.toDisplay(value);
    return {
      domain,
      min,
      max,
      value,
      displayMin,
      displayMax,
      displayValue,
      locked: Boolean(h.constraint.locked),
      places,
      unit: this.unit(),
      itemColor: colorForItem(h.item, 0, h.palette),
      minPct: this.pct(min),
      maxPct: this.pct(max),
      valuePct: this.pct(value),
      minText: formatNumber(displayMin, places),
      maxText: formatNumber(displayMax, places),
      valueText: formatNumber(displayValue, places),
      domainMinText: formatNumber(this.toDisplay(domain.min), places),
      domainMaxText: formatNumber(this.toDisplay(domain.max), places),
      displayStep: this.displayStep(),
      thresholdKey: this.thresholdFor(value)?.key ?? '',
    };
  }
  changeUnit(unitKey: string): void {
    const option = this.host.unitOptions.find(
      (candidate) => candidate.key === unitKey,
    );
    if (!option) return;
    this.host.unitKey = unitKey;
    emitVectorEvent(this.host, 'vector-change', {
      source: 'inspector',
      role: 'measurement',
      transactionId: transactionId('rail-unit'),
      key: this.host.item?.key,
      unitKey,
      basis: option.basis,
      measurementScope: option.scope ?? this.host.measurementScope,
      measurementMeasure: option.measure ?? this.host.measurementMeasure,
      measurementSystem: option.system ?? this.host.measurementSystem,
    });
  }
  handleValue(handle: ScalarHandle): number {
    return handle === 'min'
      ? this.min()
      : handle === 'max'
        ? this.max()
        : this.host.value;
  }
  domain(): ScalarDomain {
    const itemMin = Number.isFinite(Number(this.host.item?.min))
      ? Number(this.host.item?.min)
      : this.host.rangeMin;
    const itemMax = Number.isFinite(Number(this.host.item?.max))
      ? Number(this.host.item?.max)
      : this.host.rangeMax;
    return {
      min: Number.isFinite(itemMin) ? itemMin : 0,
      max: Number.isFinite(itemMax) ? itemMax : 100,
    };
  }
  min(): number {
    return Number.isFinite(Number(this.host.constraint.min))
      ? Number(this.host.constraint.min)
      : this.domain().min;
  }
  max(): number {
    return Number.isFinite(Number(this.host.constraint.max))
      ? Number(this.host.constraint.max)
      : this.domain().max;
  }
  pct(value: number): number {
    const d = this.domain();
    return clamp(
      ((Number(value ?? 0) - d.min) / (d.max - d.min || 1)) * 100,
      0,
      100,
    );
  }
  step(): number {
    const option = this.unitOption();
    if (option?.step != null && Number.isFinite(Number(option.step))) {
      const zero = this.toCanonical(0);
      return (
        Math.abs(this.toCanonical(Number(option.step)) - zero) ||
        Number(option.step)
      );
    }
    return Number(this.host.constraint.step ?? this.host.item?.step ?? 1);
  }
  places(): number {
    if (Number.isFinite(this.host.precision))
      return Math.max(0, Number(this.host.precision));
    const option = this.unitOption();
    if (option?.precision != null && Number.isFinite(Number(option.precision)))
      return Math.max(0, Number(option.precision));
    return placesForStep(this.displayStep());
  }
  unit(): string {
    return (
      this.unitOption()?.symbol ??
      (this.host.role === 'composition' ? '%' : (this.host.item?.unit ?? ''))
    );
  }
  unitOption(): UnitOption | null {
    return resolveUnitOption(
      this.host.unitOptions,
      this.host.item,
      this.preferences(),
    );
  }
  unitMatchesOption(option: UnitOption | null | undefined): boolean {
    return option ? unitMatchesPreferences(option, this.preferences()) : false;
  }
  toDisplay(value: number): number {
    return convertFromCanonical(
      Number(value ?? 0),
      this.unitOption(),
      this.conversionContext(),
    );
  }
  toCanonical(value: number): number {
    return convertToCanonical(
      Number(value ?? 0),
      this.unitOption(),
      this.conversionContext(),
    );
  }
  displayStep(): number {
    const option = this.unitOption();
    if (option?.step != null && Number.isFinite(Number(option.step)))
      return Number(option.step);
    const zero = this.toDisplay(0);
    return Math.abs(this.toDisplay(this.step()) - zero) || this.step();
  }
  thresholdFor(value: number): ThresholdBand | null {
    return (
      this.host.thresholds.find(
        (t) => Number(value) >= Number(t.min) && Number(value) <= Number(t.max),
      ) ?? null
    );
  }
  handleHitClass(handle: ScalarHandle): string {
    const hits = this.host.hits.filter(
      (hit) => hit.key === this.host.item?.key,
    );
    if (handle === 'min' && hits.some((hit) => hit.type === 'min'))
      return 'hit';
    if (handle === 'max' && hits.some((hit) => hit.type === 'max'))
      return 'hit';
    return handle === 'value' &&
      hits.some((hit) =>
        ['locked', 'unreachable', 'solver', 'sum'].includes(hit.type),
      )
      ? 'hit'
      : '';
  }
  private preferences() {
    const h = this.host;
    return {
      unitKey: h.unitKey,
      measurementSystem: h.measurementSystem,
      basis: h.basis,
      measurementScope: h.measurementScope,
      measurementMeasure: h.measurementMeasure,
    };
  }
  private conversionContext(): Record<string, unknown> {
    const h = this.host;
    const context =
      h.context && typeof h.context === 'object'
        ? (h.context as Record<string, unknown>)
        : {};
    return {
      ...context,
      item: h.item,
      measurementSystem: h.measurementSystem,
      basis: h.basis,
      measurementScope: h.measurementScope,
      measurementMeasure: h.measurementMeasure,
    };
  }
}
