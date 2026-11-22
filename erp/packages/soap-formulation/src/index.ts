import {
  clamp,
  cloneVector,
  correctCompositionTotal,
  createHit,
  labelize,
  normalizeComposition,
  redistributeComposition,
  round,
  roundComposition,
  sumVector,
  vectorDistance,
} from '@rmsc/vector-widgets/vector-math';
import type {
  ApplyOilConstraintResult,
  FattyAcidKey,
  FattyAcidProfile,
  FormulationHit,
  FormulationResult,
  FormulationWorkspace,
  MetricSolveResult,
  OilConstraint,
  OilConstraints,
  OilItem,
  OilKey,
  OilProfiles,
  OilVector,
  PartialQualityVector,
  QualityAxis,
  QualityKey,
  QualityVector,
  ReachableRanges,
  SolveMetricTargetInput,
  SolveOilAdjustmentInput,
} from './formulation-types';
import {
  APPROXIMATE_NAOH_SAP_VALUES,
  DEFAULT_OIL_COLORS,
  DEFAULT_QUALITY_AXES,
  DEMO_OIL_PROFILES,
  IODINE_FACTORS,
  NAOH_TO_KOH_FACTOR,
} from './reference-data';

export * from './formulation-types';
export {
  DEFAULT_OIL_COLORS,
  DEFAULT_QUALITY_AXES,
  DEMO_OIL_PROFILES,
} from './reference-data';

/* legacy data moved to reference-data.ts
const REMOVED_DATA = {
  olive_oil: {
    lauric: 0,
    myristic: 0,
    palmitic: 14,
    stearic: 3,
    ricinoleic: 0,
    oleic: 69,
    linoleic: 12,
    linolenic: 1
  },
  coconut_oil: {
    lauric: 48,
    myristic: 19,
    palmitic: 9,
    stearic: 3,
    ricinoleic: 0,
    oleic: 8,
    linoleic: 2,
    linolenic: 0
  },
  lard: {
    lauric: 0,
    myristic: 1,
    palmitic: 26,
    stearic: 14,
    ricinoleic: 0,
    oleic: 44,
    linoleic: 10,
    linolenic: 1
  },
  castor_oil: {
    lauric: 0,
    myristic: 0,
    palmitic: 2,
    stearic: 1,
    ricinoleic: 90,
    oleic: 4,
    linoleic: 4,
    linolenic: 0
  },
  shea_butter: {
    lauric: 0,
    myristic: 0,
    palmitic: 4,
    stearic: 42,
    ricinoleic: 0,
    oleic: 46,
    linoleic: 6,
    linolenic: 0
  },
  cocoa_butter: {
    lauric: 0,
    myristic: 0,
    palmitic: 26,
    stearic: 34,
    ricinoleic: 0,
    oleic: 35,
    linoleic: 3,
    linolenic: 0
  },
  avocado_oil: {
    lauric: 0,
    myristic: 0,
    palmitic: 20,
    stearic: 1,
    ricinoleic: 0,
    oleic: 58,
    linoleic: 12,
    linolenic: 1
  },
  sweet_almond_oil: {
    lauric: 0,
    myristic: 0,
    palmitic: 7,
    stearic: 2,
    ricinoleic: 0,
    oleic: 68,
    linoleic: 22,
    linolenic: 0
  },
  sunflower_oil: {
    lauric: 0,
    myristic: 0,
    palmitic: 6,
    stearic: 4,
    ricinoleic: 0,
    oleic: 30,
    linoleic: 59,
    linolenic: 1
  },
  rice_bran_oil: {
    lauric: 0,
    myristic: 1,
    palmitic: 22,
    stearic: 2,
    ricinoleic: 0,
    oleic: 38,
    linoleic: 34,
    linolenic: 1
  },
  palm_oil: {
    lauric: 0,
    myristic: 1,
    palmitic: 44,
    stearic: 5,
    ricinoleic: 0,
    oleic: 39,
    linoleic: 10,
    linolenic: 0
  },
  jojoba_oil: {
    lauric: 0,
    myristic: 0,
    palmitic: 2,
    stearic: 1,
    ricinoleic: 0,
    oleic: 12,
    linoleic: 5,
    linolenic: 0
  }
};

export const DEFAULT_OIL_COLORS = {
  olive_oil: "#6f8d42",
  coconut_oil: "#3f7f95",
  lard: "#b38b59",
  castor_oil: "#8b5f9d",
  shea_butter: "#c09654",
  cocoa_butter: "#8d5a3c",
  avocado_oil: "#4f9c68",
  sweet_almond_oil: "#c48a70",
  sunflower_oil: "#d6a13d",
  rice_bran_oil: "#9d9a5a",
  palm_oil: "#b66d4d",
  jojoba_oil: "#7fa89d"
};

const APPROXIMATE_NAOH_SAP_VALUES = {
  olive_oil: 0.134,
  coconut_oil: 0.183,
  lard: 0.138,
  castor_oil: 0.128,
  shea_butter: 0.128,
  cocoa_butter: 0.137,
  avocado_oil: 0.133,
  sweet_almond_oil: 0.136,
  sunflower_oil: 0.135,
  rice_bran_oil: 0.128,
  palm_oil: 0.142,
  jojoba_oil: 0.069
};

const NAOH_TO_KOH_FACTOR = 1.4025;
const IODINE_FACTORS = {
  oleic: 0.899,
  linoleic: 1.814,
  linolenic: 2.737,
  ricinoleic: 0.86
};

const DEFAULT_QUALITY_AXES_REMOVED = [
  { key: "hardness", label: "Hardness", min: 0, max: 80, preferredMin: 29, preferredMax: 54, step: 1 },
  { key: "cleansing", label: "Cleansing", min: 0, max: 40, preferredMin: 12, preferredMax: 22, step: 1 },
  { key: "conditioning", label: "Conditioning", min: 0, max: 90, preferredMin: 44, preferredMax: 69, step: 1 },
  { key: "bubbly", label: "Bubbly", min: 0, max: 70, preferredMin: 14, preferredMax: 46, step: 1 },
  { key: "creamy", label: "Creamy", min: 0, max: 60, preferredMin: 16, preferredMax: 48, step: 1 }
]; */

export function oilItemsFromWorkspace(
  workspace: Partial<FormulationWorkspace> = {},
): OilItem[] {
  const inventoryOils = Object.keys(workspace.inventory?.raw_materials || {});
  const recipeOils = (workspace.base_recipes || []).flatMap((recipe) =>
    Object.keys(recipe.oils_pct || {}),
  );
  const profileOils = Object.keys(DEMO_OIL_PROFILES);
  const keys = [
    ...new Set([...recipeOils, ...inventoryOils, ...profileOils]),
  ].filter((key) => key in DEMO_OIL_PROFILES);

  return keys.map((key, index) => ({
    key,
    label: labelize(key),
    color: DEFAULT_OIL_COLORS[key] || colorForIndex(index),
    order: index,
    tags: tagsForOil(key),
  }));
}

export function oilVectorFromWorkspace(
  workspace: Partial<FormulationWorkspace> = {},
): OilVector {
  const product = (workspace.product_recipes || [])[0] || null;
  const recipeId =
    product?.base_recipe_id || (workspace.base_recipes || [])[0]?.id;
  const baseRecipe =
    (workspace.base_recipes || []).find((recipe) => recipe.id === recipeId) ||
    (workspace.base_recipes || [])[0];
  return normalizeComposition(
    baseRecipe?.oils_pct || {
      olive_oil: 50,
      coconut_oil: 20,
      palm_oil: 30,
    },
    100,
  );
}

export function defaultOilConstraints(
  keys: readonly OilKey[] = [],
): OilConstraints {
  const defaults: Readonly<Record<OilKey, OilConstraint>> = {
    olive_oil: { min: 10, max: 70, step: 1 },
    coconut_oil: { min: 5, max: 30, step: 1 },
    lard: { min: 10, max: 60, step: 1 },
    castor_oil: { min: 5, max: 10, step: 1 },
    shea_butter: { min: 0, max: 20, step: 1 },
    cocoa_butter: { min: 0, max: 15, step: 1 },
    avocado_oil: { min: 0, max: 30, step: 1 },
    sweet_almond_oil: { min: 0, max: 30, step: 1 },
    sunflower_oil: { min: 0, max: 30, step: 1 },
    rice_bran_oil: { min: 0, max: 40, step: 1 },
    palm_oil: { min: 0, max: 50, step: 1 },
    jojoba_oil: { min: 0, max: 10, step: 1 },
  };

  return Object.fromEntries(
    keys.map((key) => [
      key,
      { ...(defaults[key] || { min: 0, max: 100, step: 1 }) },
    ]),
  );
}

export function qualityVectorForOils(
  oilVector: OilVector = {},
  profiles: OilProfiles = DEMO_OIL_PROFILES,
): QualityVector {
  const fatty = fattyAcidsForOils(oilVector, profiles);
  return {
    hardness: round(
      fatty.lauric + fatty.myristic + fatty.palmitic + fatty.stearic,
      1,
    ),
    cleansing: round(fatty.lauric + fatty.myristic, 1),
    conditioning: round(
      fatty.oleic + fatty.linoleic + fatty.linolenic + fatty.ricinoleic,
      1,
    ),
    bubbly: round(fatty.lauric + fatty.myristic + fatty.ricinoleic, 1),
    creamy: round(fatty.palmitic + fatty.stearic + fatty.ricinoleic, 1),
  };
}

export function insScoreForOils(
  oilVector: OilVector = {},
  sapMap: Readonly<Record<OilKey, number>> = {},
  profiles: OilProfiles = DEMO_OIL_PROFILES,
): number {
  const fatty = fattyAcidsForOils(oilVector, profiles);
  const iodine = (
    Object.entries(IODINE_FACTORS) as [FattyAcidKey, number][]
  ).reduce((total, [key, factor]) => {
    return total + Number(fatty[key] || 0) * factor;
  }, 0);
  const kohSap = Object.entries(oilVector || {}).reduce((total, [oil, pct]) => {
    const naohSap = Number(
      sapMap?.[oil] ?? APPROXIMATE_NAOH_SAP_VALUES[oil] ?? 0,
    );
    return (
      total + (Number(pct || 0) / 100) * naohSap * NAOH_TO_KOH_FACTOR * 1000
    );
  }, 0);
  return round(kohSap - iodine, 0);
}

export function fattyAcidsForOils(
  oilVector: OilVector = {},
  profiles: OilProfiles = DEMO_OIL_PROFILES,
): FattyAcidProfile {
  const fatty: FattyAcidProfile = {
    lauric: 0,
    myristic: 0,
    palmitic: 0,
    stearic: 0,
    ricinoleic: 0,
    oleic: 0,
    linoleic: 0,
    linolenic: 0,
  };

  for (const [oil, pct] of Object.entries(oilVector || {})) {
    const profile = profiles[oil];
    if (!profile) {
      continue;
    }
    const ratio = Number(pct || 0) / 100;
    for (const key of Object.keys(fatty) as FattyAcidKey[]) {
      fatty[key] += Number(profile[key] || 0) * ratio;
    }
  }

  return Object.fromEntries(
    Object.entries(fatty).map(([key, value]) => [key, round(value, 2)]),
  ) as FattyAcidProfile;
}

export function solveOilAdjustment({
  oilVector,
  key,
  target,
  oilConstraints = {},
  oilItems = [],
}: SolveOilAdjustmentInput): FormulationResult {
  const result = redistributeComposition({
    value: oilVector,
    key,
    target,
    constraints: oilConstraints,
    items: oilItems,
    total: 100,
  });
  return {
    oilVector: result.vector,
    qualityVector: qualityVectorForOils(result.vector),
    hits: result.hits,
    explanations: result.hits.map((hit) => hit.message),
  };
}

export function solveMetricTarget({
  oilVector,
  targetQuality,
  oilConstraints = {},
  axes = DEFAULT_QUALITY_AXES,
  profiles = DEMO_OIL_PROFILES,
}: SolveMetricTargetInput): MetricSolveResult {
  const keys = Object.keys(oilVector || {});
  let best = correctCompositionTotal(
    clampOilVector(oilVector, oilConstraints),
    oilConstraints,
    100,
    keys[0],
  );
  let bestQuality = qualityVectorForOils(best, profiles);
  let bestScore = objectiveScore(best, bestQuality, targetQuality, oilVector);
  const stepSizes = solverStepSizes(oilConstraints, keys);

  for (const step of stepSizes) {
    let improved = true;
    let guard = 0;

    while (improved && guard < 250) {
      improved = false;
      guard += 1;
      let roundBest = best;
      let roundBestQuality = bestQuality;
      let roundBestScore = bestScore;

      for (const fromKey of keys) {
        for (const toKey of keys) {
          if (fromKey === toKey) {
            continue;
          }
          const candidate = moveOil(best, fromKey, toKey, step, oilConstraints);
          if (!candidate) {
            continue;
          }
          const candidateQuality = qualityVectorForOils(candidate, profiles);
          const candidateScore = objectiveScore(
            candidate,
            candidateQuality,
            targetQuality,
            oilVector,
          );
          if (candidateScore + 1e-7 < roundBestScore) {
            roundBest = candidate;
            roundBestQuality = candidateQuality;
            roundBestScore = candidateScore;
            improved = true;
          }
        }
      }

      best = roundBest;
      bestQuality = roundBestQuality;
      bestScore = roundBestScore;
    }
  }

  const hits = explainMetricLimits(
    best,
    bestQuality,
    targetQuality,
    oilConstraints,
    axes,
  );

  return {
    oilVector: best,
    qualityVector: bestQuality,
    hits,
    explanations: hits.map((hit) => hit.message),
    score: bestScore,
  };
}

export function reachableRanges(
  oilVector: OilVector,
  oilConstraints: OilConstraints = {},
  axes: readonly QualityAxis[] = DEFAULT_QUALITY_AXES,
): ReachableRanges {
  const ranges = {} as ReachableRanges;

  for (const axis of axes) {
    const low = solveMetricTarget({
      oilVector,
      oilConstraints,
      axes,
      targetQuality: { [axis.key]: axis.min },
    });
    const high = solveMetricTarget({
      oilVector,
      oilConstraints,
      axes,
      targetQuality: { [axis.key]: axis.max },
    });
    ranges[axis.key] = {
      min: round(low.qualityVector[axis.key], 1),
      max: round(high.qualityVector[axis.key], 1),
    };
  }

  return ranges;
}

export function clampOilVector(
  oilVector: OilVector = {},
  oilConstraints: OilConstraints = {},
): OilVector {
  const next = cloneVector(oilVector);

  for (const [key, value] of Object.entries(next)) {
    const constraint = oilConstraints[key] || {};
    next[key] = clamp(value, constraint.min ?? 0, constraint.max ?? 100);
  }

  return correctCompositionTotal(
    roundComposition(next, oilConstraints),
    oilConstraints,
    100,
    Object.keys(next)[0],
  );
}

export function applyOilConstraint(
  oilVector: OilVector,
  oilConstraints: OilConstraints,
  key: OilKey,
  patch: OilConstraint,
  oilItems: OilItem[] = [],
): ApplyOilConstraintResult {
  const nextConstraints = {
    ...oilConstraints,
    [key]: {
      ...(oilConstraints[key] || {}),
      ...patch,
    },
  };
  let nextVector = cloneVector(oilVector);
  const value = Number(nextVector[key] || 0);
  const min = Number(nextConstraints[key].min ?? 0);
  const max = Number(nextConstraints[key].max ?? 100);

  if (value < min || value > max) {
    nextVector = redistributeComposition({
      value: nextVector,
      key,
      target: clamp(value, min, max),
      constraints: nextConstraints,
      items: oilItems,
      total: 100,
    }).vector;
  }

  return {
    oilVector: nextVector,
    oilConstraints: nextConstraints,
    qualityVector: qualityVectorForOils(nextVector),
  };
}

function moveOil(
  oilVector: OilVector,
  fromKey: OilKey,
  toKey: OilKey,
  step: number,
  oilConstraints: OilConstraints,
): OilVector | null {
  const fromConstraint = oilConstraints[fromKey] || {};
  const toConstraint = oilConstraints[toKey] || {};
  if (fromConstraint.locked || toConstraint.locked) {
    return null;
  }

  const fromMin = Number(fromConstraint.min ?? 0);
  const toMax = Number(toConstraint.max ?? 100);
  if (Number(oilVector[fromKey] || 0) - step < fromMin - 1e-7) {
    return null;
  }
  if (Number(oilVector[toKey] || 0) + step > toMax + 1e-7) {
    return null;
  }

  const next = cloneVector(oilVector);
  next[fromKey] = round(next[fromKey] - step, 4);
  next[toKey] = round(next[toKey] + step, 4);
  return correctCompositionTotal(
    roundComposition(next, oilConstraints),
    oilConstraints,
    100,
    toKey,
  );
}

function solverStepSizes(
  oilConstraints: OilConstraints = {},
  keys: readonly OilKey[] = [],
): number[] {
  const minimumStep = keys.reduce((minimum, key) => {
    const step = Number(oilConstraints[key]?.step || 1);
    if (!Number.isFinite(step) || step <= 0) {
      return minimum;
    }
    return Math.min(minimum, step);
  }, Infinity);
  const smallest = Number.isFinite(minimumStep) ? minimumStep : 1;
  return [5, 1, 0.25, 0.1].filter((step) => step >= smallest - 1e-7);
}

function objectiveScore(
  oilVector: OilVector,
  qualityVector: QualityVector,
  targetQuality: PartialQualityVector = {},
  originOilVector: OilVector = {},
): number {
  const qualityScore = (
    Object.entries(targetQuality) as [QualityKey, number][]
  ).reduce((total, [key, target]) => {
    const error = Number(qualityVector[key] || 0) - Number(target || 0);
    return total + error * error;
  }, 0);
  return qualityScore + vectorDistance(oilVector, originOilVector) * 0.015;
}

function explainMetricLimits(
  oilVector: OilVector,
  qualityVector: QualityVector,
  targetQuality: PartialQualityVector,
  oilConstraints: OilConstraints,
  axes: readonly QualityAxis[],
): FormulationHit[] {
  const hits: FormulationHit[] = [];

  for (const [key, target] of Object.entries(targetQuality) as [
    QualityKey,
    number,
  ][]) {
    const solved = Number(qualityVector[key] || 0);
    if (Math.abs(solved - Number(target)) > 0.6) {
      const axis = axes.find((candidate) => candidate.key === key);
      hits.push(
        createHit(
          key,
          'unreachable',
          `${axis?.label || labelize(key)} reached ${round(solved, 1)} instead of ${round(target, 1)} with the selected oils.`,
        ),
      );
    }
  }

  for (const [key, value] of Object.entries(oilVector || {})) {
    const constraint = oilConstraints[key] || {};
    if (constraint.locked) {
      hits.push(createHit(key, 'locked', `${labelize(key)} is locked.`));
      continue;
    }
    if (
      constraint.min != null &&
      Math.abs(Number(value) - Number(constraint.min)) < 0.05
    ) {
      hits.push(
        createHit(
          key,
          'min',
          `${labelize(key)} hit minimum ${round(constraint.min, 2)}%.`,
        ),
      );
    }
    if (
      constraint.max != null &&
      Math.abs(Number(value) - Number(constraint.max)) < 0.05
    ) {
      hits.push(
        createHit(
          key,
          'max',
          `${labelize(key)} hit maximum ${round(constraint.max, 2)}%.`,
        ),
      );
    }
  }

  if (Math.abs(sumVector(oilVector) - 100) > 0.01) {
    hits.push(
      createHit('composition', 'sum', 'Oil percentages must add to 100%.'),
    );
  }

  return hits;
}

function tagsForOil(key: OilKey): string[] {
  const hardOils = new Set([
    'coconut_oil',
    'lard',
    'shea_butter',
    'cocoa_butter',
    'palm_oil',
  ]);
  const liquidOils = new Set([
    'olive_oil',
    'avocado_oil',
    'sweet_almond_oil',
    'sunflower_oil',
    'rice_bran_oil',
    'jojoba_oil',
  ]);
  const latherOils = new Set(['coconut_oil', 'castor_oil']);
  return [
    hardOils.has(key) ? 'hard' : null,
    liquidOils.has(key) ? 'liquid' : null,
    latherOils.has(key) ? 'lather' : null,
  ].filter((tag): tag is string => tag !== null);
}

function colorForIndex(index: number): string {
  const colors = [
    '#426a8c',
    '#d9824b',
    '#6f8d42',
    '#8b5f9d',
    '#9d9a5a',
    '#c48a70',
  ];
  return colors[index % colors.length];
}
