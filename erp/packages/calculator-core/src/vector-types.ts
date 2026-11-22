export type NamedVector = Record<string, number>;

export interface VectorConstraint {
  min?: number;
  max?: number;
  step?: number;
  preferredMin?: number;
  preferredMax?: number;
  locked?: boolean;
}

export interface VectorItem {
  key: string;
  label?: string;
  order?: number;
  color?: string;
  tags?: readonly string[];
}

export interface ConstraintHit {
  key: string;
  type: string;
  severity: 'hard' | 'warn' | 'info';
  message: string;
  [key: string]: unknown;
}
