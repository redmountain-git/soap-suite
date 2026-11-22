import { clamp, round, sumVector } from '@redmountainsoap/vector-widgets';
import type { ScalarVectorItem } from '@redmountainsoap/vector-widgets';
import type {
  CalculatorDocument,
  OilVector,
} from '@redmountainsoap/calculator-core';

const ML_PER_IN3 = 16.387064;
interface BatchContext extends Record<string, unknown> {
  oilWeightG?: number;
  totalMassG?: number;
  density?: number;
}
interface EstimateBatchInput {
  oilWeightG: number;
  oilVector: OilVector;
  formulaValues: Record<string, number>;
  additiveValues: Record<string, number>;
  selectedAdditives: string[];
  additiveItems: ScalarVectorItem[];
  document: CalculatorDocument | null;
}

export function sapMapFor(
  document: Partial<CalculatorDocument> | null,
): Readonly<Record<string, number>> {
  return document?.referenceData?.sapValues ?? {};
}

export function estimateBatch(input: EstimateBatchInput) {
  const {
    oilWeightG,
    oilVector,
    formulaValues,
    additiveValues,
    selectedAdditives,
    additiveItems,
    document,
  } = input;
  const densities = document?.referenceData?.density ?? {};
  const sapMap = sapMapFor(document);
  const oilDensity = weightedDensity(oilVector, densities, 0.92);
  const superfat = clamp(Number(formulaValues['superfat'] ?? 5), 0, 100);
  const concentration = clamp(
    Number(formulaValues['lye_concentration'] ?? 33),
    1,
    99,
  );
  const lyeG = Object.entries(oilVector).reduce(
    (total, [key, pct]) =>
      total +
      oilWeightG *
        (pct / 100) *
        Number(sapMap[key] ?? 0) *
        (1 - superfat / 100),
    0,
  );
  const liquidG = (lyeG * (100 - concentration)) / concentration;
  const additiveG = selectedAdditives.reduce(
    (total, key) =>
      total + oilWeightG * (Number(additiveValues[key] ?? 0) / 100),
    0,
  );
  const additiveVolumeMl = selectedAdditives.reduce((total, key) => {
    const item = additiveItems.find((candidate) => candidate.key === key);
    const density = Number(densities[item?.material ?? key]);
    return Number.isFinite(density) && density > 0
      ? total +
          (oilWeightG * (Number(additiveValues[key] ?? 0) / 100)) / density
      : total;
  }, 0);
  const volumeMl =
    oilWeightG / oilDensity +
    lyeG / densityFor(densities, 'naoh', 2.13) +
    liquidG / densityFor(densities, 'distilled_water', 1) +
    additiveVolumeMl;
  return {
    oilWeightG,
    lyeG: round(lyeG, 1),
    liquidG: round(liquidG, 1),
    totalMassG: round(oilWeightG + lyeG + liquidG + additiveG, 1),
    volumeMl: round(volumeMl, 1),
    volumeIn3: round(volumeMl / ML_PER_IN3, 2),
    oilDensity: round(oilDensity, 4),
  };
}

function weightedDensity(
  vector: OilVector,
  densities: Readonly<Record<string, number>>,
  fallback: number,
): number {
  const totalPct = sumVector(vector) || 100;
  return (
    Object.entries(vector).reduce(
      (total, [key, pct]) =>
        total + (pct / totalPct) * densityFor(densities, key, fallback),
      0,
    ) || fallback
  );
}

function densityFor(
  densities: Readonly<Record<string, number>> | null,
  key: string,
  fallback = 1,
): number {
  const value = Number(densities?.[key] ?? densities?.[key.toLowerCase()]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function contextOf(context: unknown): BatchContext {
  return context && typeof context === 'object'
    ? (context as BatchContext)
    : {};
}

export function densityForContext(context: unknown): number {
  return Number(contextOf(context).density ?? 0) || 1;
}
export function additivePercentToBatchGrams(
  value: number,
  context?: unknown,
): number {
  return (value / 100) * Number(contextOf(context).oilWeightG ?? 0);
}
export function batchGramsToAdditivePercent(
  value: number,
  context?: unknown,
): number {
  return (value / Number(contextOf(context).oilWeightG ?? 1)) * 100;
}
export function additivePercentToBatchMl(
  value: number,
  context?: unknown,
): number {
  return (
    additivePercentToBatchGrams(value, context) / densityForContext(context)
  );
}
export function batchMlToAdditivePercent(
  value: number,
  context?: unknown,
): number {
  return batchGramsToAdditivePercent(
    value * densityForContext(context),
    context,
  );
}
export function percentOilsToPercentBatch(
  value: number,
  context?: unknown,
): number {
  const batch = contextOf(context);
  const oilWeight = Number(batch.oilWeightG ?? 0);
  return (value * oilWeight) / Number(batch.totalMassG ?? (oilWeight || 1));
}
export function percentBatchToPercentOils(
  value: number,
  context?: unknown,
): number {
  const batch = contextOf(context);
  const oilWeight = Number(batch.oilWeightG ?? 1);
  return (value * Number(batch.totalMassG ?? (oilWeight || 1))) / oilWeight;
}
