export type NamedVector = Record<string, number>;
export type MeasurementSystem = 'metric' | 'imperial';
export type MeasurementBasis =
  | 'percent_oils'
  | 'percent_batch'
  | 'weight'
  | 'volume'
  | 'ratio'
  | 'count';
export type MeasurementScope = 'oils' | 'batch';
export type MeasurementMeasure = 'weight' | 'volume' | 'scalar';
export type ThresholdSeverity = 'ok' | 'warn' | 'danger';
export type VectorRole =
  | 'composition'
  | 'metric'
  | 'measurement'
  | 'selection'
  | 'summary'
  | string;
export type VectorTheme = Record<string, string>;
export type VectorEventSource =
  | 'pie'
  | 'radar'
  | 'rail'
  | 'inspector'
  | 'quantity-input'
  | 'value-slider'
  | 'unit-toggle'
  | 'item-list'
  | 'choice-control'
  | 'summary-meter'
  | 'constraint-control'
  | 'constraint-feedback'
  | string;

export type VectorItem = {
  key: string;
  label: string;
  color?: string;
  unit?: string;
  order?: number;
  tags?: string[];
  type?: string;
  category?: string;
  description?: string;
  summary?: string;
  purpose?: string;
  basis?: MeasurementBasis;
  min?: number;
  max?: number;
  step?: number;
};

export type VectorConstraint = {
  min?: number;
  max?: number;
  preferredMin?: number;
  preferredMax?: number;
  locked?: boolean;
  step?: number;
};

export type UnitOption = {
  key: string;
  label: string;
  system?: MeasurementSystem;
  basis: MeasurementBasis;
  scope?: MeasurementScope;
  measure?: MeasurementMeasure;
  symbol: string;
  precision?: number;
  step?: number;
  toCanonical?: (value: number, context?: unknown) => number;
  fromCanonical?: (value: number, context?: unknown) => number;
};

export type ThresholdBand = {
  key: string;
  min: number;
  max: number;
  severity: ThresholdSeverity;
  label?: string;
  color?: string;
};

export type ScalarVectorItem = VectorItem & {
  defaultValue?: number | null;
  unitOptions?: UnitOption[];
  defaultUnitKey?: string;
  thresholds?: ThresholdBand[];
  precision?: number | null;
  material?: string;
};

export interface VectorAmountContext extends Record<string, unknown> {
  density?: number;
  densities?: Record<string, number>;
}

export type ScalarVectorState = {
  item: ScalarVectorItem | null;
  value: number;
  defaultValue?: number | null;
  constraint: VectorConstraint;
  thresholds?: ThresholdBand[];
  unitKey?: string;
  measurementSystem?: MeasurementSystem | '';
  basis?: MeasurementBasis | '';
  measurementScope?: MeasurementScope | '';
  measurementMeasure?: MeasurementMeasure | '';
  context?: unknown;
  precision?: number | null;
  disabled?: boolean;
  theme?: Record<string, string>;
  palette?: readonly string[];
};

export type ConstraintHit = {
  key: string;
  type: string;
  severity: 'soft' | 'hard' | string;
  message: string;
};

export type VectorAxis = VectorItem & {
  min?: number;
  max?: number;
  step?: number;
  precision?: number | null;
  preferredMin?: number;
  preferredMax?: number;
  reachableMax?: number;
};

export type VectorRange = Record<string, { min: number; max: number }>;

export interface ChoiceOption {
  key?: string;
  value?: string | number | boolean;
  label?: string;
}

export interface ChoiceVectorItem extends VectorItem {
  options?: ChoiceOption[];
}

export interface VectorChoiceState {
  item: ChoiceVectorItem | null;
  options: ChoiceOption[];
  value: string | number | boolean;
  role: VectorRole;
  disabled: boolean;
  theme?: VectorTheme;
}

export interface VectorItemListState {
  items: VectorItem[];
  selectedKeys: string[];
  query: string;
  activeTags: string[];
  itemTypes: string[];
  listType: string;
  searchPlaceholder: string;
  theme?: VectorTheme;
  palette: readonly string[];
}

export interface VectorUnitToggleState {
  options: UnitOption[];
  unitKey: string;
  label: string;
  groupKey: string;
  measurementSystem: MeasurementSystem | '';
  basis: MeasurementBasis | '';
  measurementScope: MeasurementScope | '';
  measurementMeasure: MeasurementMeasure | '';
  disabled: boolean;
  theme?: VectorTheme;
}

export interface VectorConstraintControlState {
  item: VectorItem | null;
  value: number;
  constraint: VectorConstraint;
  mode: VectorRole;
  theme?: VectorTheme;
}

export interface VectorInspectorState {
  item: VectorItem | null;
  value: number;
  constraint: VectorConstraint;
  role: VectorRole;
  palette: readonly string[];
  theme?: VectorTheme;
}

export interface SummaryMeterItem extends VectorItem {
  value: number;
  threshold?: ThresholdBand;
  thresholds?: ThresholdBand[];
  precision?: number;
  severity?: ThresholdSeverity;
}

export interface VectorSummaryMeterState {
  items: SummaryMeterItem[];
  theme?: VectorTheme;
}

export interface ConstraintFeedbackState {
  hits: ConstraintHit[];
  theme?: VectorTheme;
}

export interface VectorAmountListState {
  items: ScalarVectorItem[];
  values: NamedVector;
  constraints: Record<string, VectorConstraint>;
  thresholds: Record<string, ThresholdBand[]>;
  unitPreferences: Record<string, string>;
  measurementSystem: MeasurementSystem | '';
  basis: MeasurementBasis | '';
  measurementScope: MeasurementScope | '';
  measurementMeasure: MeasurementMeasure | '';
  context: VectorAmountContext | null;
  role: VectorRole;
  control: 'constraint' | 'value' | 'quantity' | string;
  unitDisplay: 'picker' | 'text' | 'none' | string;
  activeEmphasis: boolean;
  palette: readonly string[];
  theme?: VectorTheme;
}

export interface VectorPieState {
  items: VectorItem[];
  value: NamedVector;
  constraints: Record<string, VectorConstraint>;
  total: number;
  selectedKey: string;
  hits: ConstraintHit[];
  disabled: boolean;
  precision: number | null;
  centerValue: number | string | null;
  centerLabel: string;
  centerPrecision: number | null;
  theme?: VectorTheme;
  palette: readonly string[];
}

export interface VectorRadarState {
  axes: VectorAxis[];
  value: NamedVector;
  previewValue: NamedVector | null;
  targetValue: NamedVector | null;
  reachableRange: VectorRange;
  preferredRange: VectorRange;
  selectedKey: string;
  hits: ConstraintHit[];
  disabled: boolean;
  precision: number | null;
  showValues: boolean;
  theme?: VectorTheme;
}

export interface VectorConstraintRailState extends ScalarVectorState {
  role: VectorRole;
  hits: ConstraintHit[];
  rangeMin: number;
  rangeMax: number;
  unitOptions: UnitOption[];
  variant: 'default' | 'embedded' | string;
  unitDisplay: 'picker' | 'text' | 'none' | string;
  activeEmphasis: boolean;
}

export interface VectorEventBase {
  source: VectorEventSource;
  role: VectorRole;
  transactionId: string;
  key?: string;
  unitKey?: string;
  basis?: MeasurementBasis | '';
  measurementScope?: MeasurementScope | '';
  measurementMeasure?: MeasurementMeasure | '';
  measurementSystem?: MeasurementSystem | '';
  itemType?: string;
  option?: unknown;
  selection?: string[];
  action?: 'add' | 'remove';
  listType?: string;
  constraintRole?: VectorRole;
  selected?: boolean;
  value?: number | string | boolean | NamedVector | VectorConstraint;
  target?: number;
  displayValue?: number;
  canonicalValue?: number;
  thresholdKey?: string;
  handle?: 'min' | 'value' | 'max';
  constraint?: VectorConstraint;
  previousValue?: NamedVector;
  requestedValue?: NamedVector;
  proposedValue?: NamedVector;
  delta?: number;
  hits?: ConstraintHit[];
}

export type VectorSelectDetail = VectorEventBase & { key: string };
export type VectorPreviewDetail = VectorEventBase & {
  proposedValue?: NamedVector;
  target?: number;
};
export type VectorChangeDetail = VectorEventBase;
export type VectorCancelDetail = VectorEventBase;
export type VectorConstraintHitDetail = VectorEventBase & {
  hits: ConstraintHit[];
};

export interface VectorEventDetailMap {
  'vector-select': VectorSelectDetail;
  'vector-preview': VectorPreviewDetail;
  'vector-change': VectorChangeDetail;
  'vector-cancel': VectorCancelDetail;
  'vector-constraint-hit': VectorConstraintHitDetail;
}

export type VectorEventType = keyof VectorEventDetailMap;

declare global {
  interface HTMLElementTagNameMap {
    'constraint-feedback-list': ConstraintFeedbackList;
    'oil-search-list': OilSearchList;
    'vector-amount-list': VectorAmountList;
    'vector-choice-control': VectorChoiceControl;
    'vector-constraint-control': VectorConstraintControl;
    'vector-constraint-rail': VectorConstraintRail;
    'vector-ingredient-list': VectorIngredientList;
    'vector-inspector': VectorInspector;
    'vector-item-list': VectorItemList;
    'vector-pie-chart': VectorPieChart;
    'vector-quantity-input': VectorQuantityInput;
    'vector-radar-chart': VectorRadarChart;
    'vector-scalar-rail': VectorScalarRail;
    'vector-summary-meter': VectorSummaryMeter;
    'vector-unit-toggle': VectorUnitToggle;
    'vector-value-slider': VectorValueSlider;
  }

  interface HTMLElementEventMap {
    'vector-select': CustomEvent<VectorSelectDetail>;
    'vector-preview': CustomEvent<VectorPreviewDetail>;
    'vector-change': CustomEvent<VectorChangeDetail>;
    'vector-cancel': CustomEvent<VectorCancelDetail>;
    'vector-constraint-hit': CustomEvent<VectorConstraintHitDetail>;
  }
}
import type { ConstraintFeedbackList } from './constraint-feedback-list';
import type { OilSearchList } from './oil-search-list';
import type { VectorAmountList } from './vector-amount-list';
import type { VectorChoiceControl } from './vector-choice-control';
import type { VectorConstraintControl } from './vector-constraint-control';
import type { VectorConstraintRail } from './vector-constraint-rail';
import type { VectorIngredientList } from './vector-ingredient-list';
import type { VectorInspector } from './vector-inspector';
import type { VectorItemList } from './vector-item-list';
import type { VectorPieChart } from './vector-pie-chart';
import type { VectorQuantityInput } from './vector-quantity-input';
import type { VectorRadarChart } from './vector-radar-chart';
import type { VectorScalarRail } from './vector-scalar-rail';
import type { VectorSummaryMeter } from './vector-summary-meter';
import type { VectorUnitToggle } from './vector-unit-toggle';
import type { VectorValueSlider } from './vector-value-slider';
