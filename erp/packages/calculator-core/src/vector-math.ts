import { clamp, labelize, round, roundToStep } from './vector-numeric';
import type {
  ConstraintHit,
  NamedVector,
  VectorConstraint,
  VectorItem,
} from './vector-types';

export {
  clamp,
  labelize,
  round,
  roundToStep,
  transactionId,
} from './vector-numeric';
export type {
  ConstraintHit,
  NamedVector,
  VectorConstraint,
  VectorItem,
} from './vector-types';

const DEFAULT_PERCENT_TOTAL = 100;
const DEFAULT_PERCENT_STEP = 0.1;
const VECTOR_ROUND_PLACES = 4;
const REDISTRIBUTION_REMAINDER_PLACES = 7;
const COMPARISON_EPSILON = 1e-7;
const APPLIED_DELTA_EPSILON = 1e-9;
const MIN_DISTRIBUTION_WEIGHT = 0.0001;
const REDISTRIBUTION_EXTRA_PASSES = 8;
const TOTAL_CORRECTION_MAX_PASSES = 100;

export function cloneVector(vector: NamedVector = {}): NamedVector {
  return Object.fromEntries(
    Object.entries(vector).map(([key, value]) => [key, Number(value ?? 0)]),
  );
}

export function vectorKeys(
  items: readonly VectorItem[] = [],
  vector: NamedVector = {},
): string[] {
  const ordered = [...items]
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
    .map((item) => item.key);
  return [...new Set([...ordered, ...Object.keys(vector)])];
}

export function sumVector(vector: NamedVector = {}): number {
  return Object.values(vector).reduce(
    (total, value) => total + Number(value ?? 0),
    0,
  );
}

export function constraintMin(constraint: VectorConstraint = {}): number {
  return Number.isFinite(Number(constraint.min)) ? Number(constraint.min) : 0;
}

export function constraintMax(constraint: VectorConstraint = {}): number {
  return Number.isFinite(Number(constraint.max))
    ? Number(constraint.max)
    : DEFAULT_PERCENT_TOTAL;
}

export function createHit(
  key: string,
  type: string,
  message: string,
  severity: ConstraintHit['severity'] = 'hard',
): ConstraintHit {
  return { key, type, severity, message };
}

export function normalizeComposition(
  value: NamedVector = {},
  total = DEFAULT_PERCENT_TOTAL,
  keys: readonly string[] = Object.keys(value),
): NamedVector {
  const next: Record<string, number> = {};
  const currentTotal = sumVector(value);
  const fallback = keys.length
    ? Number(total ?? DEFAULT_PERCENT_TOTAL) / keys.length
    : 0;

  for (const key of keys) {
    next[key] =
      currentTotal > 0
        ? (Number(value[key] ?? 0) * Number(total ?? DEFAULT_PERCENT_TOTAL)) /
          currentTotal
        : fallback;
  }

  return correctCompositionTotal(next, {}, total, keys[0]);
}

export interface RedistributeCompositionOptions {
  value?: NamedVector;
  key: string;
  target: number;
  constraints?: Record<string, VectorConstraint>;
  items?: readonly VectorItem[];
  total?: number;
}

export interface RedistributeCompositionResult {
  vector: NamedVector;
  hits: ConstraintHit[];
  delta: number;
}

export function redistributeComposition({
  value = {},
  key,
  target,
  constraints = {},
  items = [],
  total = DEFAULT_PERCENT_TOTAL,
}: RedistributeCompositionOptions): RedistributeCompositionResult {
  const keys = vectorKeys(items, value).filter(
    (itemKey) => itemKey in value || itemKey === key,
  );
  const hits: ConstraintHit[] = [];
  const start = normalizeComposition(value, total, keys);
  const vector = cloneVector(start);
  const activeConstraint = constraints[key] || {};

  if (!key || !(key in vector)) {
    return {
      vector: correctCompositionTotal(vector, constraints, total, key),
      hits: [
        createHit(
          key || 'composition',
          'sum',
          'No active slice was available.',
        ),
      ],
      delta: 0,
    };
  }

  if (activeConstraint.locked) {
    return {
      vector,
      hits: [createHit(key, 'locked', `${labelize(key)} is locked.`)],
      delta: 0,
    };
  }

  const requestedTarget = Number(target);
  const min = constraintMin(activeConstraint);
  const max = constraintMax(activeConstraint);
  let activeTarget = clamp(requestedTarget, min, max);

  if (activeTarget !== requestedTarget) {
    hits.push(
      createHit(
        key,
        activeTarget <= min ? 'min' : 'max',
        `${labelize(key)} hit ${activeTarget <= min ? 'minimum' : 'maximum'} ${round(activeTarget, 2)}%.`,
      ),
    );
  }

  activeTarget = roundToStep(
    activeTarget,
    activeConstraint.step ?? DEFAULT_PERCENT_STEP,
  );
  const activeDelta = activeTarget - vector[key];
  vector[key] = activeTarget;

  let remaining = -activeDelta;
  const frozen = new Set([key]);
  let guard = 0;

  while (
    hasMeaningfulRemainder(remaining) &&
    guard < redistributionMaxPasses(keys)
  ) {
    guard += 1;
    const candidates = keys.filter((candidateKey) => {
      if (frozen.has(candidateKey)) {
        return false;
      }
      const constraint = constraints[candidateKey] || {};
      if (constraint.locked) {
        hits.push(
          createHit(
            candidateKey,
            'locked',
            `${labelize(candidateKey)} is locked.`,
          ),
        );
        frozen.add(candidateKey);
        return false;
      }
      if (remaining < 0) {
        return canMoveTowardMinimum(vector[candidateKey], constraint);
      }
      return canMoveTowardMaximum(vector[candidateKey], constraint);
    });

    if (!candidates.length) {
      absorbRemainder(vector, key, remaining);
      hits.push(
        createHit(
          key,
          'unreachable',
          `${labelize(key)} was clamped because the remaining oils cannot absorb the change.`,
        ),
      );
      remaining = 0;
      break;
    }

    const weightTotal = candidates.reduce((totalWeight, candidateKey) => {
      return totalWeight + distributionWeight(vector[candidateKey]);
    }, 0);
    let appliedAny = false;

    for (const candidateKey of candidates) {
      const constraint = constraints[candidateKey] || {};
      const weight = distributionWeight(vector[candidateKey]) / weightTotal;
      const proposed = remaining * weight;
      const candidateMin = constraintMin(constraint);
      const candidateMax = constraintMax(constraint);
      let applied = proposed;

      if (proposed < 0 && vector[candidateKey] + proposed < candidateMin) {
        applied = candidateMin - vector[candidateKey];
        vector[candidateKey] = candidateMin;
        frozen.add(candidateKey);
        hits.push(
          createHit(
            candidateKey,
            'min',
            `${labelize(candidateKey)} hit minimum ${round(candidateMin, 2)}%.`,
          ),
        );
      } else if (
        proposed > 0 &&
        vector[candidateKey] + proposed > candidateMax
      ) {
        applied = candidateMax - vector[candidateKey];
        vector[candidateKey] = candidateMax;
        frozen.add(candidateKey);
        hits.push(
          createHit(
            candidateKey,
            'max',
            `${labelize(candidateKey)} hit maximum ${round(candidateMax, 2)}%.`,
          ),
        );
      } else {
        vector[candidateKey] += applied;
      }

      remaining = roundRedistributionRemainder(remaining - applied);
      appliedAny = appliedAny || isMeaningfulAppliedDelta(applied);
    }

    if (!appliedAny) {
      absorbRemainder(vector, key, remaining);
      hits.push(
        createHit(key, 'unreachable', 'No remaining oil can legally move.'),
      );
      remaining = 0;
      break;
    }
  }

  return {
    vector: correctCompositionTotal(
      roundComposition(vector, constraints),
      constraints,
      total,
      key,
    ),
    hits: dedupeHits(hits),
    delta: round(activeTarget - start[key], 4),
  };
}

export function roundComposition(
  vector: NamedVector = {},
  constraints: Record<string, VectorConstraint> = {},
): NamedVector {
  return Object.fromEntries(
    Object.entries(vector).map(([key, value]) => [
      key,
      roundToStep(value, constraints[key]?.step ?? DEFAULT_PERCENT_STEP),
    ]),
  );
}

export function correctCompositionTotal(
  vector: NamedVector = {},
  constraints: Record<string, VectorConstraint> = {},
  total = DEFAULT_PERCENT_TOTAL,
  preferredKey: string | null = null,
): NamedVector {
  const next = cloneVector(vector);
  const keys = Object.keys(next);
  let diff = roundVectorValue(
    Number(total ?? DEFAULT_PERCENT_TOTAL) - sumVector(next),
  );
  let guard = 0;

  while (hasMeaningfulRemainder(diff) && guard < TOTAL_CORRECTION_MAX_PASSES) {
    guard += 1;
    const ordered = [
      preferredKey,
      ...keys.filter((key) => key !== preferredKey),
    ].filter((candidate): candidate is string => Boolean(candidate));
    let adjusted = false;

    for (const key of ordered) {
      const constraint = constraints[key] || {};
      if (constraint.locked) {
        continue;
      }
      const min = constraintMin(constraint);
      const max = constraintMax(constraint);
      const available = diff > 0 ? max - next[key] : next[key] - min;
      if (!hasAvailableAdjustment(available)) {
        continue;
      }
      const amount = Math.sign(diff) * Math.min(Math.abs(diff), available);
      next[key] = roundVectorValue(next[key] + amount);
      diff = roundVectorValue(diff - amount);
      adjusted = true;
      break;
    }

    if (!adjusted) {
      break;
    }
  }

  return next;
}

export function vectorDistance(
  a: NamedVector = {},
  b: NamedVector = {},
): number {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys.reduce(
    (total, key) => total + Math.abs(Number(a[key] ?? 0) - Number(b[key] ?? 0)),
    0,
  );
}

export function dedupeHits(
  hits: readonly ConstraintHit[] = [],
): ConstraintHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const id = `${hit.key}:${hit.type}:${hit.message}`;
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function redistributionMaxPasses(keys: readonly string[]): number {
  return keys.length + REDISTRIBUTION_EXTRA_PASSES;
}

function hasMeaningfulRemainder(value: number): boolean {
  return Math.abs(Number(value ?? 0)) > COMPARISON_EPSILON;
}

function hasAvailableAdjustment(value: number): boolean {
  return Number(value ?? 0) > APPLIED_DELTA_EPSILON;
}

function isMeaningfulAppliedDelta(value: number): boolean {
  return Math.abs(Number(value ?? 0)) > APPLIED_DELTA_EPSILON;
}

function canMoveTowardMinimum(
  value: number,
  constraint: VectorConstraint,
): boolean {
  return Number(value ?? 0) > constraintMin(constraint) + COMPARISON_EPSILON;
}

function canMoveTowardMaximum(
  value: number,
  constraint: VectorConstraint,
): boolean {
  return Number(value ?? 0) < constraintMax(constraint) - COMPARISON_EPSILON;
}

function distributionWeight(value: number): number {
  return Math.max(
    MIN_DISTRIBUTION_WEIGHT,
    Number(value ?? MIN_DISTRIBUTION_WEIGHT),
  );
}

function roundVectorValue(value: number): number {
  return round(value, VECTOR_ROUND_PLACES);
}

function roundRedistributionRemainder(value: number): number {
  return round(value, REDISTRIBUTION_REMAINDER_PLACES);
}

function absorbRemainder(
  vector: NamedVector,
  key: string,
  remaining: number,
): void {
  vector[key] = roundVectorValue(
    Number(vector[key] ?? 0) + Number(remaining ?? 0),
  );
}
