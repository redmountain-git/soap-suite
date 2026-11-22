import { LitElement, html, type TemplateResult } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import {
  applyTheme,
  DEFAULT_VECTOR_PALETTE,
  DEFAULT_VECTOR_THEME,
  styleVariables,
} from '@redmountainsoap/vector-widgets';
import type {
  ConstraintHit,
  MeasurementBasis,
  MeasurementMeasure,
  MeasurementScope,
  MeasurementSystem,
  ScalarVectorItem,
  UnitOption,
  VectorConstraint,
  VectorEventBase,
  VectorTheme,
} from '@redmountainsoap/vector-widgets';
import type {
  CalculatorChangeDetail,
  CalculatorDocument,
  FormulationHit,
  OilConstraints,
  OilItem,
  OilVector,
  PartialQualityVector,
  QualityAxis,
  QualityKey,
  QualityVector,
  ReachableRanges,
} from '@redmountainsoap/calculator-core';
import {
  additivePercentToBatchGrams,
  additivePercentToBatchMl,
  batchGramsToAdditivePercent,
  batchMlToAdditivePercent,
  densityForContext,
  estimateBatch,
  percentBatchToPercentOils,
  percentOilsToPercentBatch,
  sapMapFor,
} from './recipe-vector-workbench-model';
import { recipeVectorWorkbenchStyles } from './recipe-vector-workbench.styles.generated';
import {
  applyOilConstraint,
  defaultOilConstraints,
  DEFAULT_QUALITY_AXES,
  insScoreForOils,
  oilItemsFromDocument,
  oilVectorFromDocument,
  qualityVectorForOils,
  reachableRanges,
  solveMetricTarget,
  solveOilAdjustment,
} from '@redmountainsoap/calculator-core';
import {
  clamp,
  cloneVector,
  createHit,
  redistributeComposition,
  round,
  roundToStep,
  sumVector,
  transactionId,
  vectorDistance,
} from '@redmountainsoap/vector-widgets';

const LOCK_ICON = String.fromCodePoint(0x1f512);
const GREATER_EQUAL = String.fromCodePoint(0x2265);
const LESS_EQUAL = String.fromCodePoint(0x2264);
const GRAMS_PER_OUNCE = 28.3495;
const GRAMS_PER_POUND = 453.592;
const ML_PER_FLUID_OUNCE = 29.5735;
const ML_PER_IN3 = 16.387064;

type NumericValues = Record<string, number>;
type ConstraintMap = Record<string, VectorConstraint>;
type UnitPreferences = Record<string, string>;
interface BatchContext extends Record<string, unknown> {
  oilWeightG?: number;
  totalMassG?: number;
  density?: number;
  densities?: Readonly<Record<string, number>>;
}
type WorkbenchEventDetail = VectorEventBase & {
  key: string;
  role: string;
  action?: 'add' | 'remove';
  constraintRole?: string;
  listType?: string;
};
interface QualityAxisView extends QualityAxis {
  reachableMin?: number;
  reachableMax?: number;
}
interface WorkbenchPreview {
  transactionId?: string;
  oilVector: OilVector;
  qualityVector: QualityVector;
  oilConstraints: OilConstraints;
  qualityConstraints: ConstraintMap;
  reachableRange: ReachableRanges;
  targetQuality?: PartialQualityVector;
  constraintRole?: string;
  hits: FormulationHit[];
}
interface ScalarPreview {
  scope: string;
  key: string;
  values: NumericValues;
  hits: ConstraintHit[];
}

const PERCENT_OILS_UNIT: UnitOption = {
  key: 'percent_oils',
  label: '% oils',
  basis: 'percent_oils',
  scope: 'oils',
  measure: 'scalar',
  symbol: '%',
  precision: 1,
  step: 0.1,
};
const PERCENT_BATCH_UNIT: UnitOption = {
  key: 'percent_batch',
  label: '% batch',
  basis: 'percent_batch',
  scope: 'batch',
  measure: 'scalar',
  symbol: '%',
  precision: 1,
  step: 0.1,
  fromCanonical: (value: number, context?: unknown) =>
    percentOilsToPercentBatch(value, context),
  toCanonical: (value: number, context?: unknown) =>
    percentBatchToPercentOils(value, context),
};
const GRAMS_PER_KG_UNIT: UnitOption = {
  key: 'g_per_kg_oils',
  label: 'g/kg oils',
  system: 'metric',
  basis: 'weight',
  scope: 'oils',
  measure: 'weight',
  symbol: ' g/kg',
  precision: 0,
  step: 1,
  fromCanonical: (value: number) => Number(value || 0) * 10,
  toCanonical: (value: number) => Number(value || 0) / 10,
};
const OUNCES_PER_POUND_UNIT: UnitOption = {
  key: 'oz_per_lb_oils',
  label: 'oz/lb oils',
  system: 'imperial',
  basis: 'weight',
  scope: 'oils',
  measure: 'weight',
  symbol: ' oz/lb',
  precision: 2,
  step: 0.05,
  fromCanonical: (value: number) => Number(value || 0) * 0.16,
  toCanonical: (value: number) => Number(value || 0) / 0.16,
};
const GRAMS_BATCH_UNIT: UnitOption = {
  key: 'g_batch',
  label: 'g',
  system: 'metric',
  basis: 'weight',
  scope: 'batch',
  measure: 'weight',
  symbol: ' g',
  precision: 1,
  step: 1,
  fromCanonical: (value: number, context?: unknown) =>
    additivePercentToBatchGrams(value, context),
  toCanonical: (value: number, context?: unknown) =>
    batchGramsToAdditivePercent(value, context),
};
const OUNCES_BATCH_UNIT: UnitOption = {
  key: 'oz_batch',
  label: 'oz',
  system: 'imperial',
  basis: 'weight',
  scope: 'batch',
  measure: 'weight',
  symbol: ' oz',
  precision: 2,
  step: 0.05,
  fromCanonical: (value: number, context?: unknown) =>
    additivePercentToBatchGrams(value, context) / GRAMS_PER_OUNCE,
  toCanonical: (value: number, context?: unknown) =>
    batchGramsToAdditivePercent(Number(value || 0) * GRAMS_PER_OUNCE, context),
};
const ML_PER_KG_OILS_UNIT: UnitOption = {
  key: 'ml_per_kg_oils',
  label: 'ml/kg oils',
  system: 'metric',
  basis: 'volume',
  scope: 'oils',
  measure: 'volume',
  symbol: ' ml/kg',
  precision: 0,
  step: 1,
  fromCanonical: (value: number, context?: unknown) =>
    (Number(value || 0) * 10) / densityForContext(context),
  toCanonical: (value: number, context?: unknown) =>
    (Number(value || 0) * densityForContext(context)) / 10,
};
const ML_BATCH_UNIT: UnitOption = {
  key: 'ml_batch',
  label: 'ml',
  system: 'metric',
  basis: 'volume',
  scope: 'batch',
  measure: 'volume',
  symbol: ' ml',
  precision: 1,
  step: 1,
  fromCanonical: (value: number, context?: unknown) =>
    additivePercentToBatchMl(value, context),
  toCanonical: (value: number, context?: unknown) =>
    batchMlToAdditivePercent(value, context),
};
const FL_OZ_PER_POUND_OILS_UNIT: UnitOption = {
  key: 'floz_per_lb_oils',
  label: 'fl oz/lb oils',
  system: 'imperial',
  basis: 'volume',
  scope: 'oils',
  measure: 'volume',
  symbol: ' fl oz/lb',
  precision: 2,
  step: 0.05,
  fromCanonical: (value: number, context?: unknown) =>
    ((Number(value || 0) / 100) * GRAMS_PER_POUND) /
    densityForContext(context) /
    ML_PER_FLUID_OUNCE,
  toCanonical: (value: number, context?: unknown) =>
    ((Number(value || 0) * ML_PER_FLUID_OUNCE * densityForContext(context)) /
      GRAMS_PER_POUND) *
    100,
};
const FL_OZ_BATCH_UNIT: UnitOption = {
  key: 'floz_batch',
  label: 'fl oz',
  system: 'imperial',
  basis: 'volume',
  scope: 'batch',
  measure: 'volume',
  symbol: ' fl oz',
  precision: 2,
  step: 0.05,
  fromCanonical: (value: number, context?: unknown) =>
    additivePercentToBatchMl(value, context) / ML_PER_FLUID_OUNCE,
  toCanonical: (value: number, context?: unknown) =>
    batchMlToAdditivePercent(Number(value || 0) * ML_PER_FLUID_OUNCE, context),
};
const GLOBAL_UNIT_OPTIONS = [
  { key: 'metric', label: 'Metric', system: 'metric', symbol: 'g' },
  { key: 'imperial', label: 'Imperial', system: 'imperial', symbol: 'oz' },
];
const SCOPE_OPTIONS = [
  { key: 'oils', label: 'Oils', scope: 'oils' },
  { key: 'batch', label: 'Total', scope: 'batch' },
];
const MEASURE_OPTIONS = [
  { key: 'weight', label: 'Weight', measure: 'weight' },
  { key: 'volume', label: 'Volume', measure: 'volume' },
];
const GRAM_UNIT: UnitOption = {
  key: 'g',
  label: 'g',
  system: 'metric',
  basis: 'weight',
  measure: 'weight',
  symbol: ' g',
  precision: 0,
  step: 25,
};
const KILOGRAM_UNIT: UnitOption = {
  key: 'kg',
  label: 'kg',
  system: 'metric',
  basis: 'weight',
  measure: 'weight',
  symbol: ' kg',
  precision: 2,
  step: 0.05,
  fromCanonical: (value: number) => Number(value || 0) / 1000,
  toCanonical: (value: number) => Number(value || 0) * 1000,
};
const OUNCE_UNIT: UnitOption = {
  key: 'oz',
  label: 'oz',
  system: 'imperial',
  basis: 'weight',
  measure: 'weight',
  symbol: ' oz',
  precision: 1,
  step: 1,
  fromCanonical: (value: number) => Number(value || 0) / GRAMS_PER_OUNCE,
  toCanonical: (value: number) => Number(value || 0) * GRAMS_PER_OUNCE,
};
const POUND_UNIT: UnitOption = {
  key: 'lb',
  label: 'lb',
  system: 'imperial',
  basis: 'weight',
  measure: 'weight',
  symbol: ' lb',
  precision: 2,
  step: 0.1,
  fromCanonical: (value: number) => Number(value || 0) / GRAMS_PER_POUND,
  toCanonical: (value: number) => Number(value || 0) * GRAMS_PER_POUND,
};
const ML_UNIT: UnitOption = {
  key: 'ml',
  label: 'ml',
  system: 'metric',
  basis: 'volume',
  measure: 'volume',
  symbol: ' ml',
  precision: 0,
  step: 50,
};
const LITER_UNIT: UnitOption = {
  key: 'l',
  label: 'L',
  system: 'metric',
  basis: 'volume',
  measure: 'volume',
  symbol: ' L',
  precision: 2,
  step: 0.05,
  fromCanonical: (value: number) => Number(value || 0) / 1000,
  toCanonical: (value: number) => Number(value || 0) * 1000,
};
const IN3_UNIT: UnitOption = {
  key: 'in3',
  label: 'in3',
  system: 'imperial',
  basis: 'volume',
  measure: 'volume',
  symbol: ' in3',
  precision: 1,
  step: 1,
  fromCanonical: (value: number) => Number(value || 0) / ML_PER_IN3,
  toCanonical: (value: number) => Number(value || 0) * ML_PER_IN3,
};
const BATCH_ITEMS: ScalarVectorItem[] = [
  {
    key: 'oil_weight_g',
    label: 'Oil weight',
    defaultValue: 1800,
    min: 250,
    max: 10000,
    step: 25,
    defaultUnitKey: 'g',
    unitOptions: [GRAM_UNIT, KILOGRAM_UNIT, OUNCE_UNIT, POUND_UNIT],
  },
  {
    key: 'batch_volume_ml',
    label: 'Batch volume',
    defaultValue: 3000,
    min: 400,
    max: 16000,
    step: 25,
    defaultUnitKey: 'ml',
    unitOptions: [ML_UNIT, LITER_UNIT, IN3_UNIT],
  },
];
const FORMULA_ITEMS: ScalarVectorItem[] = [
  {
    key: 'superfat',
    label: 'Superfat',
    unit: '%',
    defaultValue: 5,
    min: 0,
    max: 15,
    step: 0.5,
    defaultUnitKey: 'percent_oils',
    unitOptions: [PERCENT_OILS_UNIT],
    thresholds: [
      {
        key: 'lean',
        min: 0,
        max: 2.9,
        severity: 'warn',
        label: 'Low superfat can feel lean.',
      },
      {
        key: 'balanced',
        min: 3,
        max: 7,
        severity: 'ok',
        label: 'Balanced superfat range.',
      },
      {
        key: 'rich',
        min: 7.1,
        max: 10,
        severity: 'warn',
        label: 'Higher superfat can soften bars.',
      },
      {
        key: 'very_rich',
        min: 10.1,
        max: 15,
        severity: 'danger',
        label: 'Very high superfat may shorten shelf life.',
      },
    ],
  },
  {
    key: 'lye_concentration',
    label: 'Lye concentration',
    unit: '%',
    defaultValue: 33,
    min: 25,
    max: 45,
    step: 0.5,
    defaultUnitKey: 'percent_oils',
    unitOptions: [PERCENT_OILS_UNIT],
    thresholds: [
      {
        key: 'loose',
        min: 25,
        max: 27.9,
        severity: 'warn',
        label: 'Extra water slows unmolding.',
      },
      {
        key: 'friendly',
        min: 28,
        max: 35,
        severity: 'ok',
        label: 'Friendly cold-process range.',
      },
      {
        key: 'fast',
        min: 35.1,
        max: 40,
        severity: 'warn',
        label: 'Higher concentration can speed trace.',
      },
      {
        key: 'advanced',
        min: 40.1,
        max: 45,
        severity: 'danger',
        label: 'Advanced lye concentration.',
      },
    ],
  },
];
const LYE_TYPE_ITEM = { key: 'lye_type', label: 'Lye type' };
const LYE_TYPE_OPTIONS = [
  { key: 'naoh', label: 'NaOH' },
  { key: 'koh', label: 'KOH' },
  { key: 'blend', label: 'Blend' },
];
const ADDITIVE_UNITS = [
  PERCENT_OILS_UNIT,
  PERCENT_BATCH_UNIT,
  GRAMS_PER_KG_UNIT,
  GRAMS_BATCH_UNIT,
  OUNCES_PER_POUND_UNIT,
  OUNCES_BATCH_UNIT,
  ML_PER_KG_OILS_UNIT,
  ML_BATCH_UNIT,
  FL_OZ_PER_POUND_OILS_UNIT,
  FL_OZ_BATCH_UNIT,
];
const DEFAULT_ADDITIVE_ITEMS: ScalarVectorItem[] = [
  {
    key: 'fragrance',
    label: 'Fragrance',
    summary: 'Scent load for the finished bar.',
    type: 'fragrance',
    category: 'scent',
    material: 'fragrance_oil',
    color: '#8b5f9d',
    defaultValue: 3.1,
    min: 0,
    max: 6,
    step: 0.1,
    defaultUnitKey: 'percent_oils',
    unitOptions: ADDITIVE_UNITS,
    tags: ['scent', 'ifra'],
    thresholds: [
      {
        key: 'light',
        min: 0,
        max: 2.9,
        severity: 'ok',
        label: 'Light scent load.',
      },
      {
        key: 'standard',
        min: 3,
        max: 4.9,
        severity: 'ok',
        label: 'Typical scent load.',
      },
      {
        key: 'high',
        min: 5,
        max: 5.7,
        severity: 'warn',
        label: 'High scent load; check acceleration.',
      },
      {
        key: 'ifra_limit',
        min: 5.8,
        max: 6,
        severity: 'danger',
        label: 'Near supplier or IFRA maximum.',
      },
    ],
  },
  {
    key: 'kaolin_clay',
    label: 'Kaolin clay',
    summary: 'Adds slip and can anchor scent.',
    type: 'clay',
    category: 'additive',
    material: 'kaolin_clay',
    color: '#9d9a5a',
    defaultValue: 0.6,
    min: 0,
    max: 2,
    step: 0.1,
    defaultUnitKey: 'percent_oils',
    unitOptions: ADDITIVE_UNITS,
    tags: ['clay', 'slip'],
    thresholds: [
      {
        key: 'light',
        min: 0,
        max: 0.7,
        severity: 'ok',
        label: 'Light clay load.',
      },
      {
        key: 'noticeable',
        min: 0.8,
        max: 1.4,
        severity: 'warn',
        label: 'Clay may affect slip and trace.',
      },
      {
        key: 'heavy',
        min: 1.5,
        max: 2,
        severity: 'danger',
        label: 'Heavy clay can feel draggy.',
      },
    ],
  },
  {
    key: 'sodium_lactate',
    label: 'Sodium lactate',
    summary: 'Helps harden bars for unmolding.',
    type: 'hardener',
    category: 'additive',
    material: 'sodium_lactate',
    color: '#426a8c',
    defaultValue: 2,
    min: 0,
    max: 3,
    step: 0.1,
    defaultUnitKey: 'percent_oils',
    unitOptions: ADDITIVE_UNITS,
    tags: ['hardener'],
    thresholds: [
      {
        key: 'normal',
        min: 0,
        max: 2,
        severity: 'ok',
        label: 'Typical hardening support.',
      },
      {
        key: 'brittle',
        min: 2.1,
        max: 3,
        severity: 'warn',
        label: 'Too much may make bars brittle.',
      },
    ],
  },
  {
    key: 'botanicals',
    label: 'Botanicals',
    summary: 'Visual texture or top decoration.',
    type: 'botanical',
    category: 'decoration',
    material: 'botanicals',
    color: '#6f8d42',
    defaultValue: 0.2,
    min: 0,
    max: 1,
    step: 0.1,
    defaultUnitKey: 'percent_oils',
    unitOptions: ADDITIVE_UNITS,
    tags: ['decoration', 'texture'],
    thresholds: [
      {
        key: 'sprinkle',
        min: 0,
        max: 0.3,
        severity: 'ok',
        label: 'Light decoration.',
      },
      {
        key: 'scratch',
        min: 0.4,
        max: 1,
        severity: 'warn',
        label: 'Botanicals can brown or scratch.',
      },
    ],
  },
];

export class RecipeVectorWorkbench extends LitElement {
  static override styles = recipeVectorWorkbenchStyles;
  private _document: CalculatorDocument | null;
  private _initialized: boolean;
  private _oilItems: OilItem[];
  private _oilVector: OilVector;
  private _oilConstraints: OilConstraints;
  private _qualityAxes: readonly QualityAxis[];
  private _qualityConstraints: ConstraintMap;
  private _qualityVector: QualityVector;
  private _reachableRange: ReachableRanges;
  private _selectedOil: string;
  private _selectedQuality: string;
  private _selectionRole: string;
  private _preview: WorkbenchPreview | null;
  private _hits: ConstraintHit[];
  private _history: OilVector[];
  private _future: OilVector[];
  private _theme: VectorTheme;
  private _palette: readonly string[];
  private _pendingPreviewDetail: WorkbenchEventDetail | null;
  private _previewFrame: number;
  private _measurementSystem: MeasurementSystem;
  private _measurementUnitKey: string;
  private _measurementScope: MeasurementScope;
  private _measurementScopeKey: string;
  private _measurementMeasure: MeasurementMeasure;
  private _measurementMeasureKey: string;
  private _measurementBasis: MeasurementBasis;
  private _batchOilWeightG: number;
  private _unitPreferences: UnitPreferences;
  private _formulaValues: NumericValues;
  private _formulaConstraints: ConstraintMap;
  private _formulaChoices: Record<string, string>;
  private _additiveItems: ScalarVectorItem[];
  private _selectedAdditives: string[];
  private _additiveValues: NumericValues;
  private _additiveConstraints: ConstraintMap;
  private _selectedAdditive: string;
  private _scalarPreview: ScalarPreview | null;
  constructor() {
    super();
    this._document = null;
    this._initialized = false;
    this._oilItems = [];
    this._oilVector = {};
    this._oilConstraints = {};
    this._qualityAxes = DEFAULT_QUALITY_AXES;
    this._qualityConstraints = {};
    this._qualityVector = {
      hardness: 0,
      cleansing: 0,
      conditioning: 0,
      bubbly: 0,
      creamy: 0,
    };
    this._reachableRange = {
      hardness: { min: 0, max: 0 },
      cleansing: { min: 0, max: 0 },
      conditioning: { min: 0, max: 0 },
      bubbly: { min: 0, max: 0 },
      creamy: { min: 0, max: 0 },
    };
    this._selectedOil = '';
    this._selectedQuality = 'hardness';
    this._selectionRole = 'composition';
    this._preview = null;
    this._hits = [];
    this._history = [];
    this._future = [];
    this._theme = DEFAULT_VECTOR_THEME;
    this._palette = DEFAULT_VECTOR_PALETTE;
    this._pendingPreviewDetail = null;
    this._previewFrame = 0;
    this._measurementSystem = 'metric';
    this._measurementUnitKey = 'metric';
    this._measurementScope = 'oils';
    this._measurementScopeKey = 'oils';
    this._measurementMeasure = 'weight';
    this._measurementMeasureKey = 'weight';
    this._measurementBasis = 'weight';
    this._batchOilWeightG = 1800;
    this._unitPreferences = {};
    this._formulaValues = Object.fromEntries(
      [...BATCH_ITEMS, ...FORMULA_ITEMS].map((item) => [
        item.key,
        item.defaultValue ?? 0,
      ]),
    ) as NumericValues;
    this._formulaConstraints = Object.fromEntries(
      [...BATCH_ITEMS, ...FORMULA_ITEMS].map((item) => [
        item.key,
        { min: item.min, max: item.max, step: item.step },
      ]),
    );
    this._formulaChoices = { lye_type: 'naoh' };
    this._additiveItems = DEFAULT_ADDITIVE_ITEMS;
    this._selectedAdditives = ['fragrance', 'kaolin_clay', 'sodium_lactate'];
    this._additiveValues = this._initialAdditiveValues();
    this._additiveConstraints = Object.fromEntries(
      DEFAULT_ADDITIVE_ITEMS.map((item) => [
        item.key,
        { min: item.min, max: item.max, step: item.step },
      ]),
    );
    this._selectedAdditive = 'fragrance';
    this._scalarPreview = null;
  }

  set document(value: CalculatorDocument | null) {
    this._document = value;
    if (!this._initialized) {
      this._loadDocument(value || { version: 1, oils: {} });
    } else {
      this._loadDocument(value || { version: 1, oils: {} });
      this.requestUpdate();
    }
  }

  get document() {
    return this._document;
  }

  set theme(value) {
    const previous = this._theme;
    this._theme = { ...DEFAULT_VECTOR_THEME, ...(value || {}) };
    if (this.isConnected) applyTheme(this, this._theme, previous);
    this.requestUpdate();
  }

  get theme() {
    return this._theme;
  }

  set palette(value) {
    this._palette =
      Array.isArray(value) && value.length ? value : DEFAULT_VECTOR_PALETTE;
    this.requestUpdate();
  }

  get palette() {
    return this._palette;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    applyTheme(this, this._theme);
    if (!this._initialized && this._document) {
      this._loadDocument(this._document);
    } else if (!this._initialized) {
      this.requestUpdate();
    } else {
      this.requestUpdate();
    }
  }

  override render(): TemplateResult {
    if (!this._initialized) {
      return html`<div class="empty">Loading recipe design tools.</div>`;
    }

    const activeQuality = this._preview?.qualityVector || this._qualityVector;
    const activeReachable = this._activeReachableRange();
    const activeOilVector = this._preview?.oilVector || this._oilVector;
    const activeOilConstraints = this._activeOilConstraints();
    const activeFormulaValues = this._activeFormulaValues();
    const activeAdditiveValues = this._activeAdditiveValues();
    const batchContext = this._batchContext(
      activeOilVector,
      activeFormulaValues,
      activeAdditiveValues,
    );
    const oilWeightItem =
      BATCH_ITEMS.find((item) => item.key === 'oil_weight_g') || BATCH_ITEMS[0];
    const batchVolumeItem =
      BATCH_ITEMS.find((item) => item.key === 'batch_volume_ml') ||
      BATCH_ITEMS[1];
    const additiveItems = this._additiveItemsForContext(batchContext);
    const activeScalarHits = this._scalarHits(
      activeFormulaValues,
      activeAdditiveValues,
    );
    const activeHits = [...this._activeHits(), ...activeScalarHits];
    const oilItems = this._selectedOilItems();
    const oilRailItem = this._oilItems.find(
      (item) => item.key === this._selectedOil,
    );
    const formulaThresholds = Object.fromEntries(
      FORMULA_ITEMS.map((item) => [item.key, item.thresholds || []]),
    );
    const additiveThresholds = Object.fromEntries(
      additiveItems.map((item) => [item.key, item.thresholds || []]),
    );
    const formulaSummary = this._formulaSummary(
      activeFormulaValues,
      activeAdditiveValues,
    );
    const measurementBasis = this._activeMeasurementBasis();
    const insScore = insScoreForOils(
      activeOilVector,
      sapMapFor(this._document),
    );
    const pieState = {
      items: oilItems,
      value: activeOilVector,
      constraints: activeOilConstraints,
      total: 100,
      selectedKey: this._selectedOil,
      hits: activeHits,
      precision: 0,
      centerValue: insScore,
      centerLabel: 'INS',
      centerPrecision: 0,
      theme: this._theme,
      palette: this._palette,
    };
    const radarState = {
      axes: this._qualityAxes.map((axis) => ({
        ...axis,
        reachableMin: activeReachable[axis.key]?.min,
        reachableMax: activeReachable[axis.key]?.max,
      })),
      value: this._qualityVector,
      previewValue: this._preview?.qualityVector || null,
      targetValue: this._preview?.targetQuality || null,
      reachableRange: activeReachable,
      selectedKey: this._selectedQuality,
      hits: activeHits,
      precision: 1,
      showValues: true,
      theme: this._theme,
    };
    const oilRailState = {
      item: oilRailItem || null,
      value: activeOilVector[this._selectedOil] || 0,
      constraint: activeOilConstraints[this._selectedOil] || {},
      role: 'composition',
      hits: activeHits,
      rangeMin: 0,
      rangeMax: 100,
      precision: 0,
      theme: this._theme,
      palette: this._palette,
      variant: 'embedded',
    };
    const lockedKeys = new Set(
      Object.entries(activeOilConstraints || {})
        .filter(([, constraint]) => constraint?.locked)
        .map(([key]) => key),
    );
    const lockedHitKeys = new Set(
      activeHits.filter((hit) => hit.type === 'locked').map((hit) => hit.key),
    );
    const oilKeys = new Set(Object.keys(activeOilConstraints || {}));
    const limitHits = new Map(
      activeHits
        .filter(
          (hit) =>
            (hit.type === 'min' || hit.type === 'max') && oilKeys.has(hit.key),
        )
        .map((hit) => [JSON.stringify([hit.type, hit.key]), hit]),
    );
    const pieDecorators = [
      ...[...lockedKeys].map(
        (key) => html`
          <span
            slot="slice-decorator"
            data-lock-badge
            data-key=${key}
            class=${classMap({
              'pie-lock-badge': true,
              hit: lockedHitKeys.has(key),
            })}
            aria-hidden="true"
            title=${`${this._labelForKey(key)} locked`}
            >${LOCK_ICON}</span
          >
        `,
      ),
      ...[...limitHits.values()].map(
        (hit) => html`
          <span
            slot="slice-decorator"
            data-limit-badge
            data-key=${hit.key}
            data-limit-type=${hit.type}
            class=${classMap({
              'pie-limit-badge': true,
              [hit.type]: true,
              [hit.severity || 'hard']: true,
              hit: true,
            })}
            aria-hidden="true"
            title=${`${this._labelForKey(hit.key)} ${hit.type === 'min' ? 'minimum' : 'maximum'} reached`}
          >
            ${hit.type === 'min' ? GREATER_EQUAL : LESS_EQUAL}
          </span>
        `,
      ),
    ];

    return html`
      <section
        class="workbench"
        @vector-select=${(event: CustomEvent<WorkbenchEventDetail>) =>
          this._handleSelect(event.detail)}
        @vector-preview=${(event: CustomEvent<WorkbenchEventDetail>) =>
          this._handlePreview(event.detail)}
        @vector-change=${(event: CustomEvent<WorkbenchEventDetail>) =>
          this._handleChange(event.detail)}
        @vector-cancel=${() => this._cancelPreview()}
        @vector-constraint-hit=${(event: CustomEvent<WorkbenchEventDetail>) =>
          this._handleConstraintHit(event.detail)}
      >
        <div class="toolbar">
          <div>
            <h2>Recipe Designer</h2>
            <p data-status>${this._statusText()}</p>
          </div>
          <div class="toolbar-actions">
            <button
              data-action="undo"
              ?disabled=${!this._history.length}
              @click=${() => this._undo()}
            >
              Undo
            </button>
            <button
              data-action="redo"
              ?disabled=${!this._future.length}
              @click=${() => this._redo()}
            >
              Redo
            </button>
            <button
              data-action="reset"
              @click=${() =>
                this._loadDocument(
                  this._document || { version: 1, oils: this._oilVector },
                )}
            >
              Reset
            </button>
          </div>
        </div>

        <div class="visual-grid">
          <article class="surface chart-card">
            <div class="card-heading">
              <h3>Quality Radar</h3>
              <span>axis reach</span>
            </div>
            <vector-radar-chart
              .axes=${radarState.axes}
              .value=${radarState.value}
              .previewValue=${radarState.previewValue}
              .targetValue=${radarState.targetValue}
              .reachableRange=${radarState.reachableRange}
              .selectedKey=${radarState.selectedKey}
              .hits=${radarState.hits}
              .precision=${radarState.precision}
              .showValues=${radarState.showValues}
            ></vector-radar-chart>
            <div class="quality-rail-list">
              ${repeat(
                this._qualityAxes,
                (axis) => axis.key,
                (axis) =>
                  this._qualityRow(axis, activeQuality, activeReachable),
              )}
            </div>
          </article>

          <article class="surface chart-card">
            <div class="card-heading">
              <h3>Oil Blend</h3>
              <span
                >${round(
                  sumVector(this._preview?.oilVector || this._oilVector),
                  1,
                )}%</span
              >
            </div>
            <vector-pie-chart
              .items=${pieState.items}
              .value=${pieState.value}
              .constraints=${pieState.constraints}
              .total=${pieState.total}
              .selectedKey=${pieState.selectedKey}
              .hits=${pieState.hits}
              .precision=${pieState.precision}
              .centerValue=${pieState.centerValue}
              .centerLabel=${pieState.centerLabel}
              .centerPrecision=${pieState.centerPrecision}
              .palette=${pieState.palette}
            >
              ${pieDecorators}
              <vector-constraint-rail
                slot="after-legend"
                data-oil-rail
                .item=${oilRailState.item}
                .value=${oilRailState.value}
                .constraint=${oilRailState.constraint}
                .role=${oilRailState.role}
                .hits=${oilRailState.hits}
                .rangeMin=${oilRailState.rangeMin}
                .rangeMax=${oilRailState.rangeMax}
                .precision=${oilRailState.precision}
                .palette=${oilRailState.palette}
                .variant=${oilRailState.variant}
              ></vector-constraint-rail>
            </vector-pie-chart>
          </article>

          <aside class="side-stack">
            <article class="surface">
              <div class="card-heading">
                <h3>Limits</h3>
                <span>${activeHits.length}</span>
              </div>
              <constraint-feedback-list
                .hits=${activeHits}
              ></constraint-feedback-list>
            </article>
          </aside>
        </div>

        <div class="control-grid">
          <article class="surface formula-panel">
            <div class="card-heading"><h3>Formula</h3></div>
            <div class="formula-stack">
              <div class="measurement-toggles system-only">
                <vector-unit-toggle
                  .label=${'System'}
                  .groupKey=${'system'}
                  .options=${GLOBAL_UNIT_OPTIONS}
                  .unitKey=${this._measurementUnitKey}
                  .measurementSystem=${this._measurementSystem}
                ></vector-unit-toggle>
              </div>
              <div class="batch-size-grid">
                <vector-quantity-input
                  .item=${oilWeightItem}
                  .value=${activeFormulaValues['oil_weight_g'] || 0}
                  .constraint=${this._formulaConstraints['oil_weight_g'] || {}}
                  .unitOptions=${oilWeightItem.unitOptions ?? []}
                  .unitKey=${''}
                  .measurementSystem=${this._measurementSystem}
                  .basis=${'weight'}
                  .measurementMeasure=${'weight'}
                  .role=${'formula'}
                  .context=${batchContext}
                  .palette=${this._palette}
                ></vector-quantity-input>
                <vector-quantity-input
                  .item=${batchVolumeItem}
                  .value=${activeFormulaValues['batch_volume_ml'] || 0}
                  .constraint=${this._formulaConstraints['batch_volume_ml'] ||
                  {}}
                  .unitOptions=${batchVolumeItem.unitOptions ?? []}
                  .unitKey=${''}
                  .measurementSystem=${this._measurementSystem}
                  .basis=${'volume'}
                  .measurementMeasure=${'volume'}
                  .role=${'formula'}
                  .context=${batchContext}
                  .palette=${this._palette}
                ></vector-quantity-input>
              </div>
              <vector-choice-control
                .item=${LYE_TYPE_ITEM}
                .options=${LYE_TYPE_OPTIONS}
                .value=${this._formulaChoices['lye_type']}
                .role=${'formula_choice'}
              ></vector-choice-control>
              <vector-amount-list
                .items=${FORMULA_ITEMS}
                .values=${activeFormulaValues}
                .constraints=${this._formulaConstraints}
                .thresholds=${formulaThresholds}
                .unitPreferences=${this._unitPreferences}
                .measurementSystem=${this._measurementSystem}
                .basis=${'percent_oils'}
                .measurementScope=${'oils'}
                .measurementMeasure=${'scalar'}
                .context=${batchContext}
                .role=${'formula'}
                .control=${'slider'}
                .unitDisplay=${'text'}
                .activeEmphasis=${false}
                .palette=${this._palette}
              ></vector-amount-list>
            </div>
          </article>

          <article class="surface additive-panel">
            <div class="card-heading"><h3>Additives</h3></div>
            <div class="additive-stack">
              <div class="measurement-toggles additive-toggles">
                <vector-unit-toggle
                  .label=${'Basis'}
                  .groupKey=${'scope'}
                  .options=${SCOPE_OPTIONS}
                  .unitKey=${this._measurementScopeKey}
                  .measurementScope=${this._measurementScope}
                ></vector-unit-toggle>
                <vector-unit-toggle
                  .label=${'Measure'}
                  .groupKey=${'measure'}
                  .options=${MEASURE_OPTIONS}
                  .unitKey=${this._measurementMeasureKey}
                  .measurementMeasure=${this._measurementMeasure}
                ></vector-unit-toggle>
              </div>
              <vector-amount-list
                .items=${additiveItems}
                .values=${activeAdditiveValues}
                .constraints=${this._additiveConstraints}
                .thresholds=${additiveThresholds}
                .unitPreferences=${this._unitPreferences}
                .measurementSystem=${this._measurementSystem}
                .basis=${measurementBasis}
                .measurementScope=${this._measurementScope}
                .measurementMeasure=${this._measurementMeasure}
                .context=${batchContext}
                .role=${'additive'}
                .control=${'slider'}
                .palette=${this._palette}
              ></vector-amount-list>
              <vector-summary-meter
                .items=${formulaSummary}
              ></vector-summary-meter>
            </div>
          </article>

          <article class="surface">
            <div class="card-heading">
              <h3>Oil Library</h3>
              <span>${this._selectedOilItems().length} selected</span>
            </div>
            <oil-search-list
              .items=${this._oilItems}
              .selectedKeys=${Object.keys(this._oilVector)}
              .palette=${this._palette}
            ></oil-search-list>
          </article>
        </div>
      </section>
    `;
  }

  _loadDocument(document: Partial<CalculatorDocument>) {
    this._oilItems = oilItemsFromDocument(document);
    this._oilVector = oilVectorFromDocument(document);
    this._oilConstraints = {
      ...defaultOilConstraints(this._oilItems.map((item) => item.key)),
      ...(document.oilConstraints || {}),
    };
    this._qualityAxes = DEFAULT_QUALITY_AXES;
    this._qualityConstraints = Object.fromEntries(
      this._qualityAxes.map((axis) => [
        axis.key,
        {
          min: axis.min,
          max: axis.max,
          preferredMin: axis.preferredMin,
          preferredMax: axis.preferredMax,
          step: axis.step || 1,
        },
      ]),
    );
    this._qualityVector = qualityVectorForOils(this._oilVector);
    this._reachableRange = reachableRanges(
      this._oilVector,
      this._oilConstraints,
      this._qualityAxes,
    );
    this._selectedOil = Object.keys(this._oilVector)[0] || '';
    this._selectedQuality = this._qualityAxes[0]?.key || '';
    this._selectionRole = 'composition';
    this._preview = null;
    this._hits = [];
    this._history = [];
    this._future = [];
    this._measurementSystem = document.measurementSystem || 'metric';
    this._measurementUnitKey = this._measurementSystem;
    this._measurementScope = 'oils';
    this._measurementScopeKey = 'oils';
    this._measurementMeasure = 'weight';
    this._measurementMeasureKey = 'weight';
    this._measurementBasis = 'weight';
    this._batchOilWeightG = Number(document.batchOilWeightG || 1800);
    this._unitPreferences = { ...(document.unitPreferences || {}) };
    const defaultFormulaValues = Object.fromEntries(
      [...BATCH_ITEMS, ...FORMULA_ITEMS].map((item) => [
        item.key,
        item.defaultValue ?? 0,
      ]),
    ) as NumericValues;
    this._formulaValues = {
      ...defaultFormulaValues,
      ...(document.formulaValues || {}),
    };
    this._formulaValues['oil_weight_g'] = this._batchOilWeightG;
    this._formulaChoices = {
      lye_type: 'naoh',
      ...(document.formulaChoices || {}),
    };
    this._selectedAdditives = [
      ...(document.selectedAdditives || [
        'fragrance',
        'kaolin_clay',
        'sodium_lactate',
      ]),
    ];
    this._additiveValues = {
      ...this._initialAdditiveValues(),
      ...(document.additiveValues || {}),
    };
    this._selectedAdditive = this._selectedAdditives[0] || 'fragrance';
    this._scalarPreview = null;
    this._initialized = true;
    this.requestUpdate();
  }

  _initialAdditiveValues(): NumericValues {
    const selected = new Set(this._selectedAdditives || []);
    return Object.fromEntries(
      this._additiveItems.map((item) => [
        item.key,
        selected.has(item.key) ? (item.defaultValue ?? 0) : 0,
      ]),
    ) as NumericValues;
  }

  _emitDocument(source: CalculatorChangeDetail['source']) {
    const document: CalculatorDocument = {
      version: 1,
      oils: cloneVector(this._oilVector),
      oilConstraints: structuredClone(this._oilConstraints),
      formulaValues: { ...this._formulaValues },
      formulaChoices: { ...this._formulaChoices },
      selectedAdditives: [...this._selectedAdditives],
      additiveValues: { ...this._additiveValues },
      batchOilWeightG: this._batchOilWeightG,
      measurementSystem: this._measurementSystem,
      unitPreferences: { ...this._unitPreferences },
      referenceData: this._document?.referenceData,
    };
    this._document = document;
    this.dispatchEvent(
      new CustomEvent<CalculatorChangeDetail>('calculator-change', {
        detail: { document, source },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _handleSelect(detail: WorkbenchEventDetail) {
    const { source, role, key } = detail;
    if (!key) {
      return;
    }
    if (
      this._additiveItems.some((item) => item.key === key) ||
      [...BATCH_ITEMS, ...FORMULA_ITEMS].some((item) => item.key === key)
    ) {
      this._selectedAdditive = key;
      this.requestUpdate();
      return;
    }
    if (
      role === 'metric' ||
      this._qualityAxes.some((axis) => axis.key === key)
    ) {
      this._selectedQuality = key;
      this._selectionRole = 'metric';
    } else if (
      source === 'constraint' &&
      this._qualityAxes.some((axis) => axis.key === key)
    ) {
      this._selectedQuality = key;
      this._selectionRole = 'metric';
    } else {
      this._selectedOil = key;
      this._selectionRole = 'composition';
    }
    this.requestUpdate();
  }

  _handlePreview(detail: WorkbenchEventDetail) {
    this._queuePreview(detail);
  }

  _queuePreview(detail: WorkbenchEventDetail) {
    this._pendingPreviewDetail = detail || {};
    if (this._previewFrame) {
      return;
    }
    const run = () => {
      this._previewFrame = 0;
      const latest = this._pendingPreviewDetail;
      this._pendingPreviewDetail = null;
      if (latest) {
        this._applyPreview(latest);
      }
    };
    const schedule = globalThis.requestAnimationFrame;
    if (typeof schedule !== 'function') {
      run();
      return;
    }
    this._previewFrame = schedule(run);
  }

  _flushPreview() {
    if (!this._pendingPreviewDetail) {
      return;
    }
    if (this._previewFrame) {
      const cancel = globalThis.cancelAnimationFrame;
      if (typeof cancel === 'function') {
        cancel(this._previewFrame);
      }
      this._previewFrame = 0;
    }
    const latest = this._pendingPreviewDetail;
    this._pendingPreviewDetail = null;
    this._applyPreview(latest);
  }

  _clearPendingPreview() {
    this._pendingPreviewDetail = null;
    if (!this._previewFrame) {
      return;
    }
    const cancel = globalThis.cancelAnimationFrame;
    if (typeof cancel === 'function') {
      cancel(this._previewFrame);
    }
    this._previewFrame = 0;
  }

  _applyPreview(detail: WorkbenchEventDetail) {
    if (detail.role === 'additive' || detail.role === 'formula') {
      this._previewScalar(detail);
      return;
    }

    if (detail.role === 'constraint') {
      this._previewConstraint(detail);
      return;
    }

    if (detail.role === 'composition') {
      const result = this._solveCompositionDetail(detail);
      this._preview = {
        transactionId: detail.transactionId,
        oilVector: result.oilVector,
        qualityVector: result.qualityVector,
        oilConstraints: this._oilConstraints,
        qualityConstraints: this._qualityConstraints,
        reachableRange: this._reachableRange,
        hits: result.hits,
      };
      this.requestUpdate();
      return;
    }

    if (detail.role === 'metric') {
      const targetQuality = this._metricTarget(detail);
      const result = solveMetricTarget({
        oilVector: this._oilVector,
        targetQuality,
        oilConstraints: this._activeOilConstraints(),
        axes: this._qualityAxes,
      });
      this._preview = {
        transactionId: detail.transactionId,
        oilVector: result.oilVector,
        qualityVector: result.qualityVector,
        oilConstraints: this._oilConstraints,
        qualityConstraints: this._qualityConstraints,
        reachableRange: this._reachableRange,
        targetQuality,
        hits: result.hits,
      };
      this.requestUpdate();
    }
  }

  _handleChange(detail: WorkbenchEventDetail) {
    this._flushPreview();
    if (detail.role === 'measurement') {
      this._changeMeasurement(detail);
      return;
    }
    if (detail.role === 'formula_choice') {
      this._formulaChoices = {
        ...this._formulaChoices,
        [detail.key]: String(detail.value ?? ''),
      };
      this.requestUpdate();
      this._emitDocument('formula');
      return;
    }
    if (detail.role === 'selection') {
      if (
        detail.listType === 'ingredient' ||
        this._additiveItems.some((item) => item.key === detail.key)
      ) {
        this._changeAdditiveSelection(detail.key, detail.action);
        return;
      }
      this._changeOilSelection(detail.key, detail.action);
      return;
    }
    if (detail.role === 'additive' || detail.role === 'formula') {
      this._commitScalar(detail);
      return;
    }
    if (detail.role === 'constraint') {
      if (this._commitConstraintPreview(detail)) {
        return;
      }
      this._changeConstraint(detail);
      return;
    }
    if (detail.role === 'composition') {
      const result = this._solveCompositionDetail(detail);
      this._commitOilVector(result.oilVector, result.hits);
      return;
    }
    if (detail.role === 'metric') {
      const targetQuality = this._metricTarget(detail);
      const result = solveMetricTarget({
        oilVector: this._oilVector,
        targetQuality,
        oilConstraints: this._activeOilConstraints(),
        axes: this._qualityAxes,
      });
      this._commitOilVector(result.oilVector, result.hits);
    }
  }

  _handleConstraintHit(detail: WorkbenchEventDetail) {
    this._hits = detail.hits || [];
    if (detail.key) {
      if (
        this._additiveItems.some((item) => item.key === detail.key) ||
        FORMULA_ITEMS.some((item) => item.key === detail.key)
      ) {
        this._selectedAdditive = detail.key;
      } else if (this._qualityAxes.some((axis) => axis.key === detail.key)) {
        this._selectedQuality = detail.key;
        this._selectionRole = 'metric';
      } else {
        this._selectedOil = detail.key;
        this._selectionRole = 'composition';
      }
    }
    this.requestUpdate();
  }

  _previewScalar(detail: WorkbenchEventDetail) {
    const key = detail.key;
    const scope = detail.role;
    const baseValues =
      scope === 'formula' ? this._formulaValues : this._additiveValues;
    const value = this._scalarTarget(detail, baseValues[key] ?? 0);
    const values =
      scope === 'formula'
        ? this._resolveFormulaValues(
            { ...baseValues, [key]: value },
            key,
            value,
          )
        : { ...baseValues, [key]: value };
    this._scalarPreview = {
      scope,
      key,
      values,
      hits: this._scalarHits(
        scope === 'formula' ? values : this._formulaValues,
        scope === 'additive' ? values : this._additiveValues,
      ),
    };
    this.requestUpdate();
  }

  _commitScalar(detail: WorkbenchEventDetail) {
    const key = detail.key;
    const scope = detail.role;
    const value = this._scalarTarget(
      detail,
      scope === 'formula'
        ? this._formulaValues[key]
        : this._additiveValues[key],
    );
    if (scope === 'formula') {
      const values = this._resolveFormulaValues(
        { ...this._formulaValues, [key]: value },
        key,
        value,
      );
      this._batchOilWeightG = Number(
        values['oil_weight_g'] || this._batchOilWeightG,
      );
      this._formulaValues = values;
    } else {
      this._additiveValues = { ...this._additiveValues, [key]: value };
      this._selectedAdditives = this._activeAdditiveKeys(this._additiveValues);
    }
    this._scalarPreview = null;
    this.requestUpdate();
    this._emitDocument(scope === 'formula' ? 'formula' : 'additive');
  }

  _scalarTarget(detail: WorkbenchEventDetail, fallback = 0) {
    const key = detail.key;
    return Number(
      detail.canonicalValue ??
        detail.proposedValue?.[key] ??
        detail.requestedValue?.[key] ??
        fallback ??
        0,
    );
  }

  _changeMeasurement(detail: WorkbenchEventDetail) {
    if (detail.key === 'system') {
      this._measurementUnitKey = detail.unitKey || this._measurementUnitKey;
      this._measurementSystem =
        detail.measurementSystem || this._measurementSystem;
      this._unitPreferences = {};
      this.requestUpdate();
      this._emitDocument('measurement');
      return;
    }
    if (detail.key === 'scope') {
      this._measurementScopeKey = detail.unitKey || this._measurementScopeKey;
      this._measurementScope =
        detail.measurementScope ||
        (detail.unitKey === 'oils' || detail.unitKey === 'batch'
          ? detail.unitKey
          : this._measurementScope);
      this._measurementBasis = this._activeMeasurementBasis();
      this._unitPreferences = {};
      this.requestUpdate();
      this._emitDocument('measurement');
      return;
    }
    if (detail.key === 'measure') {
      this._measurementMeasureKey =
        detail.unitKey || this._measurementMeasureKey;
      this._measurementMeasure =
        detail.measurementMeasure ||
        (detail.unitKey === 'weight' ||
        detail.unitKey === 'volume' ||
        detail.unitKey === 'scalar'
          ? detail.unitKey
          : this._measurementMeasure);
      this._measurementBasis = this._activeMeasurementBasis();
      this._unitPreferences = {};
      this.requestUpdate();
      this._emitDocument('measurement');
      return;
    }
    if (detail.key && detail.unitKey) {
      this._unitPreferences = {
        ...this._unitPreferences,
        [detail.key]: detail.unitKey,
      };
      this.requestUpdate();
      this._emitDocument('measurement');
      return;
    }
    this._measurementUnitKey = detail.unitKey || this._measurementUnitKey;
    this._measurementSystem =
      detail.measurementSystem || this._measurementSystem;
    this._measurementBasis = detail.basis || this._activeMeasurementBasis();
    this.requestUpdate();
    this._emitDocument('measurement');
  }

  _changeAdditiveSelection(key: string, action?: 'add' | 'remove') {
    if (!key) {
      return;
    }
    const selected = new Set(this._selectedAdditives);
    const item = this._additiveItems.find((candidate) => candidate.key === key);
    if (action === 'remove') {
      selected.delete(key);
    } else {
      selected.add(key);
      if (!(key in this._additiveValues) && item) {
        this._additiveValues = {
          ...this._additiveValues,
          [key]: item.defaultValue ?? 0,
        };
      }
    }
    this._selectedAdditives = [...selected];
    this._selectedAdditive = key;
    this._scalarPreview = null;
    this.requestUpdate();
    this._emitDocument('selection');
  }

  _previewConstraint(detail: WorkbenchEventDetail) {
    const preview = this._resolveConstraintPreview(detail);
    this._preview = preview;
    this.requestUpdate();
  }

  _commitConstraintPreview(detail: WorkbenchEventDetail) {
    if (
      !this._preview ||
      this._preview.transactionId !== detail.transactionId ||
      !this._preview.constraintRole
    ) {
      return false;
    }
    this._pushHistory();
    this._oilVector = cloneVector(this._preview.oilVector || this._oilVector);
    this._qualityVector = { ...this._preview.qualityVector };
    this._oilConstraints = this._preview.oilConstraints || this._oilConstraints;
    this._qualityConstraints =
      this._preview.qualityConstraints || this._qualityConstraints;
    this._reachableRange =
      this._preview.reachableRange ||
      reachableRanges(this._oilVector, this._oilConstraints, this._qualityAxes);
    this._hits = this._preview.hits || [];
    this._preview = null;
    this._future = [];
    this.requestUpdate();
    this._emitDocument('constraint');
    return true;
  }

  _resolveConstraintPreview(detail: WorkbenchEventDetail) {
    if (detail.constraintRole !== 'composition') {
      return this._resolveQualityConstraintPreview(detail);
    }
    return this._resolveOilConstraintPreview(detail);
  }

  _resolveOilConstraintPreview(detail: WorkbenchEventDetail) {
    const key = detail.key as QualityKey;
    const baseConstraints = this._oilConstraints;
    const baseVector = this._oilVector;
    const patch = this._constraintPatchForLockedValue(
      key,
      detail.constraint || {},
      baseConstraints[key] || {},
      Number(baseVector[key] || 0),
      '%',
    );
    const result = applyOilConstraint(
      baseVector,
      baseConstraints,
      key,
      patch.constraint,
      this._selectedOilItems(),
    );
    const reachableRange = reachableRanges(
      result.oilVector,
      result.oilConstraints,
      this._qualityAxes,
    );
    return {
      transactionId: detail.transactionId,
      constraintRole: 'composition',
      oilVector: result.oilVector,
      oilConstraints: result.oilConstraints,
      qualityVector: result.qualityVector,
      qualityConstraints: this._qualityConstraints,
      reachableRange,
      hits: patch.hits,
    };
  }

  _resolveQualityConstraintPreview(detail: WorkbenchEventDetail) {
    const key = detail.key as QualityKey;
    const baseConstraints = this._qualityConstraints;
    const currentValue = Number(this._qualityVector[key] || 0);
    const patch = this._constraintPatchForLockedValue(
      key,
      detail.constraint || {},
      baseConstraints[key] || {},
      currentValue,
      '',
    );
    const qualityConstraints = {
      ...baseConstraints,
      [key]: {
        ...(baseConstraints[key] || {}),
        ...patch.constraint,
      },
    };
    const nextConstraint = qualityConstraints[key] || {};
    const clampedValue = clamp(
      currentValue,
      Number(nextConstraint.min ?? -Infinity),
      Number(nextConstraint.max ?? Infinity),
    );
    let oilVector = this._oilVector;
    let qualityVector = this._qualityVector;
    let hits = patch.hits;

    if (
      !hits.length &&
      Number.isFinite(clampedValue) &&
      Math.abs(clampedValue - currentValue) > 0.001
    ) {
      const result = solveMetricTarget({
        oilVector: this._oilVector,
        targetQuality: {
          ...this._qualityVector,
          [key]: clampedValue,
        },
        oilConstraints: this._oilConstraints,
        axes: this._qualityAxes,
      });
      oilVector = result.oilVector;
      qualityVector = result.qualityVector;
      hits = result.hits || [];
    }

    return {
      transactionId: detail.transactionId,
      constraintRole: 'metric',
      oilVector,
      oilConstraints: this._oilConstraints,
      qualityVector,
      qualityConstraints,
      reachableRange: this._reachableRange,
      hits,
    };
  }

  _constraintPatchForLockedValue(
    key: string,
    patch: VectorConstraint,
    currentConstraint: VectorConstraint,
    currentValue: number,
    unit: string,
  ) {
    const nextConstraint = { ...currentConstraint, ...patch };
    const locked = Boolean(nextConstraint.locked);
    const nextPatch = { ...patch };
    const hits: ConstraintHit[] = [];
    if (locked && patch.min != null && Number(patch.min) > currentValue) {
      nextPatch.min = currentValue;
      hits.push(
        createHit(
          key,
          'locked',
          `${this._labelForKey(key)} is locked at ${round(currentValue, 1)}${unit}.`,
        ),
      );
    }
    if (locked && patch.max != null && Number(patch.max) < currentValue) {
      nextPatch.max = currentValue;
      hits.push(
        createHit(
          key,
          'locked',
          `${this._labelForKey(key)} is locked at ${round(currentValue, 1)}${unit}.`,
        ),
      );
    }
    return {
      constraint: nextPatch,
      hits,
    };
  }

  _solveCompositionDetail(detail: WorkbenchEventDetail) {
    if (detail.proposedValue && Object.keys(detail.proposedValue).length > 1) {
      const oilVector = cloneVector(detail.proposedValue);
      return {
        oilVector,
        qualityVector: qualityVectorForOils(oilVector),
        hits: detail.hits || [],
      };
    }
    const key = detail.key as QualityKey;
    const target = Number(
      detail.proposedValue?.[key] ??
        detail.requestedValue?.[key] ??
        this._oilVector[key] ??
        0,
    );
    return solveOilAdjustment({
      oilVector: this._oilVector,
      key,
      target,
      oilConstraints: this._activeOilConstraints(),
      oilItems: this._selectedOilItems(),
    });
  }

  _metricTarget(detail: WorkbenchEventDetail) {
    const key = detail.key as QualityKey;
    if (
      detail.requestedValue &&
      Object.keys(detail.requestedValue).length > 1
    ) {
      return detail.requestedValue;
    }
    return {
      ...this._qualityVector,
      [key]: Number(
        detail.proposedValue?.[key] ??
          detail.requestedValue?.[key] ??
          this._qualityVector[key] ??
          0,
      ),
    };
  }

  _changeConstraint(detail: WorkbenchEventDetail) {
    this._preview = this._resolveConstraintPreview(detail);
    this._commitConstraintPreview(detail);
  }

  _changeOilSelection(key: string, action?: 'add' | 'remove') {
    if (!key) {
      return;
    }
    this._pushHistory();
    if (action === 'add' && !(key in this._oilVector)) {
      this._oilVector = { ...this._oilVector, [key]: 0 };
      this._selectedOil = key;
    } else if (action === 'remove' && key in this._oilVector) {
      if (Number(this._oilVector[key] || 0) > 0) {
        const result = redistributeComposition({
          value: this._oilVector,
          key,
          target: 0,
          constraints: this._oilConstraints,
          items: this._selectedOilItems(),
          total: 100,
        });
        this._oilVector = result.vector;
        this._hits = result.hits;
      }
      delete this._oilVector[key];
      this._selectedOil = Object.keys(this._oilVector)[0] || '';
    }
    this._qualityVector = qualityVectorForOils(this._oilVector);
    this._reachableRange = reachableRanges(
      this._oilVector,
      this._oilConstraints,
      this._qualityAxes,
    );
    this._preview = null;
    this._future = [];
    this.requestUpdate();
    this._emitDocument('selection');
  }

  _commitOilVector(oilVector: OilVector, hits: ConstraintHit[] = []) {
    if (vectorDistance(this._oilVector, oilVector) < 0.001) {
      this._preview = null;
      this._hits = hits;
      this.requestUpdate();
      return;
    }
    this._pushHistory();
    this._oilVector = cloneVector(oilVector);
    this._qualityVector = qualityVectorForOils(this._oilVector);
    this._reachableRange = reachableRanges(
      this._oilVector,
      this._oilConstraints,
      this._qualityAxes,
    );
    this._preview = null;
    this._hits = hits;
    this._future = [];
    this.requestUpdate();
    this._emitDocument('composition');
  }

  _pushHistory() {
    this._history = [...this._history, cloneVector(this._oilVector)].slice(-50);
  }

  _undo() {
    const previous = this._history.at(-1);
    if (!previous) {
      return;
    }
    this._future = [cloneVector(this._oilVector), ...this._future].slice(0, 50);
    this._history = this._history.slice(0, -1);
    this._oilVector = cloneVector(previous);
    this._qualityVector = qualityVectorForOils(this._oilVector);
    this._reachableRange = reachableRanges(
      this._oilVector,
      this._oilConstraints,
      this._qualityAxes,
    );
    this._preview = null;
    this._hits = [];
    this.requestUpdate();
    this._emitDocument('history');
  }

  _redo() {
    const next = this._future[0];
    if (!next) {
      return;
    }
    this._history = [...this._history, cloneVector(this._oilVector)].slice(-50);
    this._future = this._future.slice(1);
    this._oilVector = cloneVector(next);
    this._qualityVector = qualityVectorForOils(this._oilVector);
    this._reachableRange = reachableRanges(
      this._oilVector,
      this._oilConstraints,
      this._qualityAxes,
    );
    this._preview = null;
    this._hits = [];
    this.requestUpdate();
    this._emitDocument('history');
  }

  _cancelPreview() {
    this._clearPendingPreview();
    this._preview = null;
    this.requestUpdate();
  }

  _emitQualityRange(
    event: Event,
    eventName: 'vector-preview' | 'vector-change',
  ) {
    const input = event.currentTarget as HTMLInputElement;
    const requestedKey = input.dataset['qualityRange'];
    const axis = this._qualityAxes.find(
      (candidate) => candidate.key === requestedKey,
    );
    if (!axis) {
      return;
    }
    const key = axis.key;
    if (eventName === 'vector-preview' && !input.dataset['transaction']) {
      input.dataset['transaction'] = transactionId('quality-row');
    }
    const transaction =
      input.dataset['transaction'] || transactionId('quality-row');
    const target = Number(input.value);
    this._selectedQuality = key;
    this._selectionRole = 'metric';
    const requestedValue = {
      ...this._qualityVector,
      [key]: target,
    };
    const detail = {
      source: 'table',
      role: 'metric',
      transactionId: transaction,
      key,
      previousValue: this._qualityVector,
      requestedValue,
      proposedValue: requestedValue,
      delta: round(target - Number(this._qualityVector[key] || 0), 4),
      hits: [],
    };
    if (eventName === 'vector-preview') {
      this._handlePreview(detail);
    } else {
      this._handleChange(detail);
      delete input.dataset['transaction'];
    }
  }

  _qualityRow(
    axis: QualityAxisView,
    activeQuality: QualityVector,
    activeReachable: ReachableRanges,
  ) {
    const range = activeReachable[axis.key] || {};
    const value = Number(activeQuality[axis.key] || 0);
    const reachMin = Number(range.min ?? axis.reachableMin ?? axis.min ?? 0);
    const reachMax = Number(range.max ?? axis.reachableMax ?? axis.max ?? 100);
    const preferredMin = axis.preferredMin ?? reachMin;
    const preferredMax = axis.preferredMax ?? reachMax;
    const selected = axis.key === this._selectedQuality;
    const inputValue = roundToStep(
      clamp(value, axis.min ?? 0, axis.max ?? 100),
      axis.step || 1,
    );
    return html`
      <div
        class=${classMap({ 'quality-row': true, selected })}
        data-quality=${axis.key}
        @click=${() => this._selectQuality(axis.key)}
      >
        <button class="quality-name" type="button" data-quality=${axis.key}>
          ${axis.label}
        </button>
        <div class="quality-combo">
          <div class="quality-track" aria-hidden="true">
            <span
              class="quality-reach"
              ${styleVariables({
                '--quality-start': `${this._qualityPct(reachMin, axis)}%`,
                '--quality-width': `${Math.max(0, this._qualityPct(reachMax, axis) - this._qualityPct(reachMin, axis))}%`,
              })}
            ></span>
            <span
              class="quality-preferred"
              ${styleVariables({
                '--quality-start': `${this._qualityPct(preferredMin, axis)}%`,
                '--quality-width': `${Math.max(0, this._qualityPct(preferredMax, axis) - this._qualityPct(preferredMin, axis))}%`,
              })}
            ></span>
            <span
              class="quality-current"
              ${styleVariables({
                '--quality-position': `${this._qualityPct(value, axis)}%`,
              })}
            ></span>
          </div>
          <input
            data-quality-range=${axis.key}
            type="range"
            min=${axis.min ?? 0}
            max=${axis.max ?? 100}
            step=${axis.step || 1}
            .value=${String(round(inputValue, 1))}
            aria-label=${`${axis.label} target`}
            @input=${(event: Event) =>
              this._emitQualityRange(event, 'vector-preview')}
            @change=${(event: Event) =>
              this._emitQualityRange(event, 'vector-change')}
          />
        </div>
        <output>${round(value, 1)}</output>
        <span class="quality-reach-label"
          >${round(reachMin, 1)}-${round(reachMax, 1)}</span
        >
      </div>
    `;
  }

  _selectQuality(key: string) {
    this._selectedQuality = key;
    this._selectionRole = 'metric';
    this.requestUpdate();
  }

  _qualityPct(value: number, axis: QualityAxis) {
    const min = Number(axis.min ?? 0);
    const max = Number(axis.max ?? 100);
    return clamp(((Number(value || 0) - min) / (max - min || 1)) * 100, 0, 100);
  }

  _activeOilConstraints() {
    return this._preview?.oilConstraints || this._oilConstraints;
  }

  _activeQualityConstraints() {
    return this._preview?.qualityConstraints || this._qualityConstraints;
  }

  _activeReachableRange() {
    return this._preview?.reachableRange || this._reachableRange;
  }

  _activeFormulaValues() {
    const values =
      this._scalarPreview?.scope === 'formula'
        ? this._scalarPreview.values
        : this._formulaValues;
    return this._withBatchFormulaValues(values);
  }

  _activeAdditiveValues() {
    return this._scalarPreview?.scope === 'additive'
      ? this._scalarPreview.values
      : this._additiveValues;
  }

  _activeAdditiveKeys(
    additiveValues: NumericValues = this._activeAdditiveValues(),
  ) {
    return this._additiveItems
      .map((item) => item.key)
      .filter((key) => Math.abs(Number(additiveValues?.[key] || 0)) > 1e-9);
  }

  _withBatchFormulaValues(values: NumericValues = this._formulaValues) {
    const oilWeightG = Number(
      values['oil_weight_g'] || this._batchOilWeightG || 0,
    );
    const estimate = this._batchEstimateForOilWeight(
      oilWeightG,
      values,
      this._activeAdditiveValues(),
      this._preview?.oilVector || this._oilVector,
    );
    return {
      ...values,
      oil_weight_g: round(oilWeightG, 1),
      batch_volume_ml: round(estimate['volumeMl'], 1),
    };
  }

  _resolveFormulaValues(values: NumericValues, key: string, value: number) {
    let next = { ...values };
    if (key === 'batch_volume_ml') {
      const oilWeightG = this._oilWeightForBatchVolume(
        value,
        next,
        this._activeAdditiveValues(),
        this._preview?.oilVector || this._oilVector,
      );
      next['oil_weight_g'] = round(oilWeightG, 1);
    } else if (key === 'oil_weight_g') {
      next['oil_weight_g'] = round(value, 1);
    }
    return this._withBatchFormulaValues(next);
  }

  _activeMeasurementBasis() {
    return this._measurementMeasure === 'volume' ? 'volume' : 'weight';
  }

  _batchContext(
    oilVector = this._oilVector,
    formulaValues = this._activeFormulaValues(),
    additiveValues = this._activeAdditiveValues(),
  ) {
    const estimate = this._batchEstimateForOilWeight(
      Number(formulaValues['oil_weight_g'] || this._batchOilWeightG || 0),
      formulaValues,
      additiveValues,
      oilVector,
    );
    return {
      ...estimate,
      densities: this._document?.referenceData?.density || {},
    };
  }

  _batchItems(batchContext: BatchContext) {
    return BATCH_ITEMS.map((item) => {
      if (item.key !== 'batch_volume_ml') {
        return item;
      }
      return {
        ...item,
        defaultValue: round(Number(batchContext['volumeMl'] ?? 0), 1),
      };
    });
  }

  _batchSizeItem() {
    return (
      BATCH_ITEMS.find(
        (item) =>
          item.key ===
          (this._measurementMeasure === 'volume'
            ? 'batch_volume_ml'
            : 'oil_weight_g'),
      ) || BATCH_ITEMS[0]
    );
  }

  _batchSizeUnitOptions() {
    const desiredMeasure =
      this._measurementMeasure === 'volume' ? 'volume' : 'weight';
    return (this._batchSizeItem().unitOptions ?? []).filter(
      (option) => option.measure === desiredMeasure,
    );
  }

  _additiveItemsForContext(batchContext: BatchContext) {
    const densities = batchContext?.densities || {};
    return this._additiveItems.map((item) => {
      const material = item.material || item.key;
      const hasDensity = Number.isFinite(Number(densities[material]));
      return {
        ...item,
        unitOptions: (item.unitOptions || []).filter(
          (option) => option.measure !== 'volume' || hasDensity,
        ),
      };
    });
  }

  _batchEstimateForOilWeight(
    oilWeightG: number,
    formulaValues: NumericValues = this._formulaValues,
    additiveValues: NumericValues = this._additiveValues,
    oilVector: OilVector = this._oilVector,
  ) {
    return estimateBatch({
      oilWeightG,
      oilVector,
      formulaValues,
      additiveValues,
      selectedAdditives: this._activeAdditiveKeys(additiveValues),
      additiveItems: this._additiveItems,
      document: this._document,
    });
  }

  _oilWeightForBatchVolume(
    volumeMl: number,
    formulaValues: NumericValues = this._formulaValues,
    additiveValues: NumericValues = this._additiveValues,
    oilVector: OilVector = this._oilVector,
  ) {
    const unitEstimate = this._batchEstimateForOilWeight(
      1000,
      formulaValues,
      additiveValues,
      oilVector,
    );
    const ratio = unitEstimate['volumeMl'] / 1000 || 1;
    return clamp(
      Number(volumeMl || 0) / ratio,
      BATCH_ITEMS[0].min,
      BATCH_ITEMS[0].max,
    );
  }

  _selectedOilItems() {
    const selected = new Set(Object.keys(this._oilVector));
    return this._oilItems.filter((item) => selected.has(item.key));
  }

  _labelForKey(key: string) {
    return (
      this._oilItems.find((item) => item.key === key)?.label ||
      this._qualityAxes.find((axis) => axis.key === key)?.label ||
      [...BATCH_ITEMS, ...FORMULA_ITEMS, ...this._additiveItems].find(
        (item) => item.key === key,
      )?.label ||
      key
    );
  }

  _activeHits() {
    return this._preview?.hits || this._hits || [];
  }

  _scalarHits(
    formulaValues = this._formulaValues,
    additiveValues = this._additiveValues,
  ) {
    const formulaHits = FORMULA_ITEMS.flatMap((item) =>
      this._thresholdHit(item, formulaValues[item.key]),
    );
    const activeAdditives = new Set(this._activeAdditiveKeys(additiveValues));
    const additiveHits = this._additiveItems
      .filter((item) => activeAdditives.has(item.key))
      .flatMap((item) => this._thresholdHit(item, additiveValues[item.key]));
    return [...formulaHits, ...additiveHits];
  }

  _thresholdHit(item: ScalarVectorItem, value: number) {
    const threshold = (item.thresholds || []).find((band) => {
      return (
        Number(value || 0) >= Number(band.min) &&
        Number(value || 0) <= Number(band.max)
      );
    });
    if (!threshold || threshold.severity === 'ok') {
      return [];
    }
    return [
      createHit(
        item.key,
        'threshold',
        threshold.label ||
          `${item.label || item.key} is in ${threshold.severity} range.`,
        threshold.severity === 'danger' ? 'hard' : 'warn',
      ),
    ];
  }

  _formulaSummary(formulaValues: NumericValues, additiveValues: NumericValues) {
    const activeAdditives = new Set(this._activeAdditiveKeys(additiveValues));
    const totalAdditives = Object.entries(additiveValues || {})
      .filter(([key]) => activeAdditives.has(key))
      .reduce((total, [, value]) => total + Number(value || 0), 0);
    const fragrance = Number(additiveValues['fragrance'] || 0);
    const lyeConcentration = Number(formulaValues['lye_concentration'] || 0);
    return [
      {
        key: 'batch_volume_ml',
        label: 'Batch volume',
        value: Number(formulaValues['batch_volume_ml'] || 0),
        min: 400,
        max: 16000,
        unit: ' ml',
        precision: 0,
        thresholds: [],
      },
      {
        key: 'total_additives',
        label: 'Additive load',
        value: totalAdditives,
        min: 0,
        max: 10,
        unit: '%',
        precision: 1,
        thresholds: [
          { key: 'normal', min: 0, max: 5, severity: 'ok' },
          { key: 'busy', min: 5.1, max: 8, severity: 'warn' },
          { key: 'crowded', min: 8.1, max: 10, severity: 'danger' },
        ],
      },
      {
        key: 'fragrance_load',
        label: 'Fragrance load',
        value: fragrance,
        min: 0,
        max: 6,
        unit: '%',
        precision: 1,
        thresholds:
          this._additiveItems.find((item) => item.key === 'fragrance')
            ?.thresholds || [],
      },
      {
        key: 'lye_strength',
        label: 'Lye strength',
        value: lyeConcentration,
        min: 25,
        max: 45,
        unit: '%',
        precision: 1,
        thresholds:
          FORMULA_ITEMS.find((item) => item.key === 'lye_concentration')
            ?.thresholds || [],
      },
    ];
  }

  _statusText() {
    if (this._preview) {
      return 'Previewing a recipe change.';
    }
    if (this._hits.length) {
      return this._hits[0].message;
    }
    return 'Approximate quality model; fatty-acid data is a demo fixture.';
  }
}

export function defineRecipeVectorWorkbench() {
  if (
    globalThis.customElements &&
    !customElements.get('recipe-vector-workbench')
  ) {
    customElements.define('recipe-vector-workbench', RecipeVectorWorkbench);
  }
}

defineRecipeVectorWorkbench();
