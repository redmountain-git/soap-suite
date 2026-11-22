import type { Batch, NumericMap } from '@rmsc/worker-protocol';

export function validateYieldWeights(counts: NumericMap, weights: unknown) {
  if (!weights || typeof weights !== 'object' || Array.isArray(weights))
    throw new Error('Bar weights must be recorded by size.');
  for (const [size, grams] of Object.entries(weights)) {
    if (!Object.hasOwn(counts, size) || !(counts[size] > 0))
      throw new Error('Enter a positive bar count for each weighed size.');
    if (typeof grams !== 'number' || !Number.isFinite(grams) || grams <= 0)
      throw new Error('Total bar weights must be positive grams.');
  }
}

export function validateCureWeights(
  cutCounts: NumericMap,
  counts: NumericMap,
  weights: unknown,
) {
  validateYieldWeights(counts, weights);
  if (
    !Object.keys(counts).length ||
    Object.keys(weights as object).length !== Object.keys(counts).length
  )
    throw new Error('Enter a count and total weight for each group weighed.');
  for (const [size, count] of Object.entries(counts))
    if (
      !Number.isInteger(count) ||
      !Object.hasOwn(cutCounts, size) ||
      count > cutCounts[size]
    )
      throw new Error(
        'Cure counts must be whole bars and cannot exceed the cut count.',
      );
}

export function cutMassBalance(batch: Batch) {
  const counts = batch.yield_actual?.size_counts || {};
  const weights = batch.yield_actual?.weight_g_by_size || {};
  const sizes = Object.keys(counts).filter((size) => counts[size] > 0);
  const actual = batch.weighing?.actual_g;
  if (
    !sizes.length ||
    sizes.some((size) => !Object.hasOwn(weights, size)) ||
    !actual ||
    Object.keys(batch.weighing!.suggested_g).some(
      (material) => !Object.hasOwn(actual, material),
    )
  )
    return undefined;
  const inputG = Object.values(actual).reduce((sum, grams) => sum + grams, 0);
  const barsG = sizes.reduce((sum, size) => sum + weights[size], 0);
  const trimG = batch.yield_actual?.scrap_g || 0;
  const shreddedG = batch.yield_actual?.shredded_g || 0;
  return {
    inputG,
    barsG,
    accountedG: barsG + trimG + shreddedG,
    gapG: inputG - barsG - trimG - shreddedG,
  };
}
