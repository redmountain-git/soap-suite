import assert from 'node:assert/strict';
import { test } from 'vitest';
import { redistributeComposition, sumVector } from './vector-math';
import type { VectorConstraint } from './vector-types';

function constraints(keys: string[]): Record<string, VectorConstraint> {
  const defaults: Record<string, VectorConstraint> = {
    primary: { min: 10, max: 70, step: 1 },
    secondary: { min: 5, max: 30, step: 1 },
    base: { min: 10, max: 60, step: 1 },
    accent: { min: 5, max: 10, step: 1 },
  };
  return Object.fromEntries(
    keys.map((key) => [
      key,
      { ...(defaults[key] ?? { min: 0, max: 100, step: 1 }) },
    ]),
  );
}

const value = { primary: 40, secondary: 20, base: 32, accent: 8 };

test('composition redistribution preserves a 100 percent total', () => {
  const result = redistributeComposition({
    value: { primary: 70, secondary: 30 },
    key: 'secondary',
    target: 35,
    total: 100,
  });
  assert.equal(Math.round(sumVector(result.vector) * 10) / 10, 100);
  assert.deepEqual(result.vector, { primary: 65, secondary: 35 });
});

test('composition redistribution respects locked components', () => {
  const limits = constraints(Object.keys(value));
  limits.primary.locked = true;
  const result = redistributeComposition({
    value,
    key: 'secondary',
    target: 27,
    constraints: limits,
    total: 100,
  });
  assert.equal(result.vector.primary, value.primary);
  assert.ok(
    result.hits.some((hit) => hit.key === 'primary' && hit.type === 'locked'),
  );
});

test('composition redistribution emits minimum constraint hits', () => {
  const limits = constraints(Object.keys(value));
  limits.accent.min = 7;
  const result = redistributeComposition({
    value,
    key: 'primary',
    target: 70,
    constraints: limits,
    total: 100,
  });
  assert.equal(result.vector.accent, 7);
  assert.ok(
    result.hits.some((hit) => hit.key === 'accent' && hit.type === 'min'),
  );
});
