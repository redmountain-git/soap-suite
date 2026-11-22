import type { Workspace } from '@rmsc/worker-protocol';

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

export type FormulationWorkspace = Pick<
  Workspace,
  'inventory' | 'base_recipes' | 'product_recipes'
>;
