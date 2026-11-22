import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  applyOilConstraint,
  createDefaultCalculatorDocument,
  defaultOilConstraints,
  insScoreForOils,
  oilItemsFromDocument,
  qualityVectorForOils,
  solveMetricTarget,
  sumVector,
} from './index';

test('soap quality formulas use weighted fatty-acid sums', () => {
  const quality = qualityVectorForOils({
    coconut_oil: 50,
    olive_oil: 50,
  });

  assert.equal(quality.hardness, 48);
  assert.equal(quality.cleansing, 33.5);
  assert.equal(quality.bubbly, 33.5);
  assert.equal(quality.creamy, 14.5);
  assert.equal(quality.conditioning, 46);
});

test('soap INS score uses weighted SAP and iodine approximations', () => {
  const ins = insScoreForOils(
    {
      coconut_oil: 50,
      olive_oil: 50,
    },
    {
      coconut_oil: 0.183,
      olive_oil: 0.134,
    },
  );

  assert.equal(ins, 174);
});

test('pairwise solver improves the target metric and respects oil constraints', () => {
  const document = createDefaultCalculatorDocument();
  const oilVector = {
    olive_oil: 35,
    coconut_oil: 22,
    lard: 36,
    castor_oil: 7,
  };
  const constraints = defaultOilConstraints(Object.keys(oilVector));
  const before = qualityVectorForOils(oilVector);
  const result = solveMetricTarget({
    oilVector,
    oilConstraints: constraints,
    targetQuality: {
      ...before,
      bubbly: before.bubbly + 10,
    },
  });

  assert.ok(result.qualityVector.bubbly >= before.bubbly);
  assert.equal(Math.round(sumVector(result.oilVector) * 10) / 10, 100);
  for (const [key, value] of Object.entries(result.oilVector)) {
    assert.ok(
      value >= (constraints[key]?.min ?? 0) - 0.001,
      `${key} below minimum`,
    );
    assert.ok(
      value <= (constraints[key]?.max ?? 100) + 0.001,
      `${key} above maximum`,
    );
  }
  assert.ok(
    oilItemsFromDocument(document).length >= Object.keys(oilVector).length,
  );
});

test('whole-percent oil defaults keep metric solver results on whole percentages', () => {
  const oilVector = {
    olive_oil: 35,
    coconut_oil: 22,
    lard: 36,
    castor_oil: 7,
  };
  const constraints = defaultOilConstraints(Object.keys(oilVector));
  const before = qualityVectorForOils(oilVector);
  const result = solveMetricTarget({
    oilVector,
    oilConstraints: constraints,
    targetQuality: {
      ...before,
      creamy: before.creamy + 8,
    },
  });

  assert.equal(constraints.coconut_oil.step, 1);
  assert.equal(Math.round(sumVector(result.oilVector)), 100);
  for (const value of Object.values(result.oilVector)) {
    assert.equal(Number.isInteger(value), true);
  }
});

test('applying a minimum above the current oil value clamps and preserves total', () => {
  const oilVector = {
    olive_oil: 35,
    coconut_oil: 22,
    lard: 36,
    castor_oil: 7,
  };
  const constraints = defaultOilConstraints(Object.keys(oilVector));
  const result = applyOilConstraint(oilVector, constraints, 'castor_oil', {
    min: 9,
  });

  assert.equal(result.oilVector.castor_oil, 9);
  assert.equal(Math.round(sumVector(result.oilVector) * 10) / 10, 100);
  assert.equal(result.oilConstraints.castor_oil.min, 9);
});
