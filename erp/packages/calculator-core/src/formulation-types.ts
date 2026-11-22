export type OilKey = string;
export type FattyAcidKey =
  | 'lauric'
  | 'myristic'
  | 'palmitic'
  | 'stearic'
  | 'ricinoleic'
  | 'oleic'
  | 'linoleic'
  | 'linolenic';
export type QualityKey =
  | 'hardness'
  | 'cleansing'
  | 'conditioning'
  | 'bubbly'
  | 'creamy';

export type OilVector = Record<OilKey, number>;
export type QualityVector = Record<QualityKey, number>;
export type PartialQualityVector = Partial<QualityVector>;
export type FattyAcidProfile = Record<FattyAcidKey, number>;
export type OilProfiles = Readonly<Record<OilKey, FattyAcidProfile>>;

export interface OilConstraint {
  min?: number;
  max?: number;
  step?: number;
  locked?: boolean;
}

export type OilConstraints = Record<OilKey, OilConstraint>;

export interface OilItem {
  key: OilKey;
  label: string;
  color: string;
  order: number;
  tags: string[];
}

export interface QualityAxis {
  key: QualityKey;
  label: string;
  min: number;
  max: number;
  preferredMin: number;
  preferredMax: number;
  step: number;
}

export interface FormulationHit {
  key: string;
  type: string;
  severity: string;
  message: string;
  [key: string]: unknown;
}

export interface FormulationResult {
  oilVector: OilVector;
  qualityVector: QualityVector;
  hits: FormulationHit[];
  explanations: string[];
}

export interface MetricSolveResult extends FormulationResult {
  score: number;
}

export interface SolveOilAdjustmentInput {
  oilVector: OilVector;
  key: OilKey;
  target: number;
  oilConstraints?: OilConstraints;
  oilItems?: OilItem[];
}

export interface SolveMetricTargetInput {
  oilVector: OilVector;
  targetQuality: PartialQualityVector;
  oilConstraints?: OilConstraints;
  axes?: readonly QualityAxis[];
  profiles?: OilProfiles;
}

export interface ApplyOilConstraintResult {
  oilVector: OilVector;
  oilConstraints: OilConstraints;
  qualityVector: QualityVector;
}

export type ReachableRanges = Record<QualityKey, { min: number; max: number }>;

export type NumericValues = Record<string, number>;

export interface CalculatorReferenceData {
  readonly density?: Readonly<Record<string, number>>;
  readonly sapValues?: Readonly<Record<string, number>>;
  readonly oilProfiles?: OilProfiles;
}

export interface CalculatorDocument {
  readonly version: 1;
  readonly oils: OilVector;
  readonly oilConstraints?: OilConstraints;
  readonly formulaValues?: NumericValues;
  readonly formulaChoices?: Readonly<Record<string, string>>;
  readonly selectedAdditives?: readonly string[];
  readonly additiveValues?: NumericValues;
  readonly batchOilWeightG?: number;
  readonly measurementSystem?: 'metric' | 'imperial';
  readonly unitPreferences?: Readonly<Record<string, string>>;
  readonly referenceData?: CalculatorReferenceData;
}

export interface CalculatorChangeDetail {
  readonly document: CalculatorDocument;
  readonly source:
    | 'composition'
    | 'constraint'
    | 'formula'
    | 'additive'
    | 'selection'
    | 'measurement'
    | 'history';
}
