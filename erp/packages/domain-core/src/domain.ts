import type {
  AssetInput,
  Asset,
  Batch,
  BatchEvent,
  BatchStatus,
  BatchCalculation,
  BatchCalculationInput,
  CapacityAudit,
  Inventory,
  InventoryRecord,
  NumericMap,
  ProductRecipe,
  BaseRecipe,
  Receipt,
  ReceiptLine,
  ReceiptInput,
  Reports,
  WorkerCommandMap,
  WorkspaceConstants,
  Workspace,
} from '@rmsc/worker-protocol';
import {
  date,
  finite,
  migrateWorkspace,
  validateWorkspace,
} from './validation';
import {
  allocateMolds,
  calendarDate,
  estimatedTrim,
  productionAdditives,
  timestamp,
  validateProductionLog,
  wholeGramTargets,
  weighingGroup,
} from './production';
import { validateCureWeights, validateYieldWeights } from './yield-weights';

type MutableInventorySection = Record<string, InventoryRecord>;
interface MutableInventory {
  raw_materials: MutableInventorySection;
  additives: MutableInventorySection;
  finished_goods: MutableInventorySection;
  [section: string]: MutableInventorySection;
}

type InventorySectionName = 'raw_materials' | 'additives' | 'finished_goods';

interface MaterialCosting {
  readonly scope: 'materials_required';
  readonly total_material_cost: number;
  readonly material_costs: NumericMap;
  readonly missing_material_costs: ReadonlyArray<string>;
}

const STATUS_EVENTS: Partial<Record<BatchStatus, string>> = {
  planned: 'prepped',
  prepped: 'poured',
  poured: 'unmolded',
  unmolded: 'cut',
  cut: 'cure_started',
  curing: 'cure_completed',
  cured: 'posted_to_inventory',
};

const EVENT_STATUS: Readonly<Record<string, BatchStatus>> = {
  prepped: 'prepped',
  poured: 'poured',
  unmolded: 'unmolded',
  cut: 'cut',
  cure_started: 'curing',
  cure_completed: 'cured',
  shredded: 'shredded',
  posted_to_inventory: 'in_inventory',
};

export function calculateBatch(
  workspace: Workspace,
  input: BatchCalculationInput,
): BatchCalculation {
  const molds = allocateMolds(workspace, input);
  if (
    input.weighingResolutionG !== undefined &&
    input.weighingResolutionG !== 1
  )
    throw new Error('Unsupported weighing resolution.');
  if (input.weighingResolutionG && !molds)
    throw new Error('Actual weighing requires mold allocations.');
  const recipeId = input.recipeId;
  const volumeIn3 = Number(input.volumeIn3);
  if (input.oilRatio !== undefined) {
    finite(input.oilRatio, 'Deprecated oil fraction', Number.MIN_VALUE);
    if (input.oilRatio > 1)
      throw new Error('Oil fraction must not exceed one.');
  }
  const fragrancePct = Number(
    input.fragrancePct ?? productDefault(workspace, recipeId),
  );
  const { baseRecipe, productRecipe } = resolveRecipe(workspace, recipeId);
  if (baseRecipe['status'] === 'draft')
    throw new Error(
      `Recipe ${baseRecipe.id} is a draft. ${Array.isArray(baseRecipe['review_required']) ? baseRecipe['review_required'].join(' ') : 'Review the formulation before calculating a batch.'}`,
    );
  const constants = unwrapConstants(workspace);
  const superfatPct = Number(
    input.superfatPct ?? baseRecipe.lye?.default_superfat_pct ?? 5,
  );
  const liquidType =
    input.liquidType || baseRecipe.liquid?.default_type || 'distilled_water';
  const lyeType = String(baseRecipe.lye?.type || 'naoh').toLowerCase();
  const sapMap = constants.sap_values[lyeType] || {};
  const fragranceMaterial = resolveFragranceMaterial(productRecipe);

  if (!Number.isFinite(volumeIn3) || volumeIn3 <= 0) {
    throw new Error('Mold volume must be greater than zero.');
  }
  finite(fragrancePct, 'Fragrance percent');
  finite(superfatPct, 'Superfat');
  if (superfatPct >= 100) throw new Error('Superfat must be less than 100%.');
  const maximum = productRecipe?.fragrance?.['max_percent'];
  if (typeof maximum === 'number' && fragrancePct > maximum)
    throw new Error(`Fragrance exceeds recipe maximum ${maximum}%.`);
  if (productRecipe?.fragrance?.type === 'none' && fragrancePct > 0)
    throw new Error('This recipe is fragrance free.');
  for (const [oil, pct] of Object.entries(baseRecipe.oils_pct))
    finite(pct, `Oil percent ${oil}`);
  if (Math.abs(sumValues(baseRecipe.oils_pct) - 100) > 1e-6)
    throw new Error('Oil percentages must sum to 100.');
  const purity = finite(
    Number(baseRecipe.lye?.['purity_percent'] ?? 100),
    'Lye purity',
    Number.MIN_VALUE,
  );
  if (purity > 100) throw new Error('Lye purity must not exceed 100%.');
  const perOil = splitOils(1, baseRecipe.oils_pct);
  const perLye = lyeForOils(perOil, sapMap, superfatPct) / (purity / 100);
  const waterPerOil = baseRecipe.liquid?.['default_ratio'];
  const lyeRatio =
    input.lyeRatio !== undefined
      ? finite(input.lyeRatio, 'Liquid/lye ratio', Number.MIN_VALUE)
      : waterPerOil !== undefined
        ? finite(waterPerOil, 'Liquid/oil ratio', Number.MIN_VALUE) / perLye
        : 2.3;
  const perGram: Record<string, number> = {
    ...perOil,
    [lyeType]: perLye,
    [liquidType]: perLye * lyeRatio,
  };
  if (fragrancePct)
    perGram[fragranceMaterial] =
      (perGram[fragranceMaterial] || 0) + fragrancePct / 100;
  const additives = baseRecipe['additives_pct'] || {};
  if (!isRecord(additives)) throw new Error('Invalid recipe additives.');
  for (const [material, pct] of Object.entries(additives))
    perGram[material] =
      (perGram[material] || 0) +
      finite(pct, `Additive percent ${material}`) / 100;
  const volumeMl =
    volumeIn3 *
    finite(
      unitToMl(constants, 'in3'),
      'Cubic inch conversion',
      Number.MIN_VALUE,
    );
  const volumePerOilGram = Object.entries(perGram).reduce(
    (n, [material, grams]) =>
      grams ? n + grams / densityFor(constants.density, material) : n,
    0,
  );
  const totalOilsG = volumeMl / volumePerOilGram;
  const materialsRequiredG = Object.fromEntries(
    Object.entries(perGram).map(([k, v]) => [k, v * totalOilsG]),
  );
  const substitutionWarnings: string[] = [];
  const snapshotAdditives = { ...(additives as Record<string, number>) };
  // Substitutions preserve the reference oil weight, not an invented substitute density.
  for (const [source, target] of Object.entries(
    input.additiveSubstitutions || {},
  )) {
    if (
      !(source in snapshotAdditives) ||
      typeof target !== 'string' ||
      !target.trim() ||
      target in materialsRequiredG
    )
      throw new Error('Invalid additive substitution.');
    materialsRequiredG[target] = materialsRequiredG[source];
    delete materialsRequiredG[source];
    snapshotAdditives[target] = snapshotAdditives[source];
    delete snapshotAdditives[source];
    substitutionWarnings.push(
      `${source} replaced with ${target} at the same oil-weight percentage. Oil weight and mold-fit estimate use the original formulation; substitute density is unverified.`,
    );
  }
  const snapshotRecipe = {
    ...structuredClone(baseRecipe),
    additives_pct: snapshotAdditives,
  };
  const oilsG = splitOils(totalOilsG, baseRecipe.oils_pct);
  const lyeG = perLye * totalOilsG;
  const liquidG = lyeG * lyeRatio;
  const fragranceG = (totalOilsG * fragrancePct) / 100;
  const fragranceDensity = fragranceG
    ? densityFor(constants.density, fragranceMaterial)
    : 1;
  const totalMassG = sumValues(materialsRequiredG);
  const batterDensity = totalMassG / volumeMl;

  const costing = costMaterials(
    workspace.inventory,
    materialsRequiredG,
    constants,
  );
  const selectedBar = input.barSize
    ? workspace.bar_sizes?.[input.barSize] || null
    : null;
  const estimatedBars = selectedBar
    ? Math.floor(volumeIn3 / Number(selectedBar.approx_volume_in3 || 1))
    : null;

  return {
    calculation_version: 3,
    inputs: structuredClone({
      ...input,
      fragrancePct,
      superfatPct,
      lyeRatio,
      liquidType,
    }),
    ...(molds ? { molds: structuredClone(molds) } : {}),
    recipe_snapshot: snapshotRecipe,
    warnings:
      input.oilRatio === undefined
        ? substitutionWarnings
        : [
            'oilRatio is deprecated; complete formulation determines oil fraction.',
            ...substitutionWarnings,
          ],
    recipe_id: recipeId,
    base_recipe_id: baseRecipe.id,
    product_recipe_id: productRecipe?.id || null,
    product_recipe_name: productRecipe?.name || null,
    base_recipe_name: baseRecipe.name,
    volume_in3: round(volumeIn3, 2),
    volume_ml: round(volumeMl, 1),
    batter_density: round(batterDensity, 4),
    total_mass_g: round(totalMassG, 4),
    total_oils_g: round(totalOilsG, 6),
    oils_g: roundMap(oilsG, 1),
    lye_type: lyeType.toUpperCase(),
    lye_g: round(lyeG, 1),
    liquid_type: liquidType,
    liquid_g: round(liquidG, 1),
    fragrance: {
      material: fragranceMaterial,
      percent_of_oils: fragrancePct,
      amount_g: round(fragranceG, 1),
      volume_ml: round(fragranceG / fragranceDensity, 1),
      amount_oz: round(fragranceG / unitToG(constants, 'oz'), 3),
    },
    fragrance_pct: fragrancePct,
    materials_required_g: roundMap(materialsRequiredG, 6),
    costing,
    bar_size: molds ? null : input.barSize || null,
    bars_expected: molds
      ? molds.reduce((n, m) => n + m.bars_expected, 0)
      : estimatedBars,
  };
}

export function parseBaseRecipe(raw: string): BaseRecipe {
  const bundle: unknown = JSON.parse(raw);
  if (
    !isRecord(bundle) ||
    bundle['app'] !== 'red-mountain-soap-recipe' ||
    bundle['version'] !== 1 ||
    !isRecord(bundle['recipe'])
  )
    throw new Error('Unsupported recipe file.');
  const recipe = bundle['recipe'] as unknown as BaseRecipe;
  if (typeof recipe.id !== 'string' || !/^BSR-\d{3}$/.test(recipe.id))
    throw new Error('Invalid base recipe identifier.');
  if (typeof recipe.name !== 'string' || !recipe.name.trim())
    throw new Error('Recipe name is required.');
  return recipe;
}

export function addBaseRecipe(
  workspace: Workspace,
  raw: string,
  nowIso: string,
): Workspace {
  const recipe = parseBaseRecipe(raw);
  const previous = workspace.base_recipes?.find((r) => r.id === recipe.id);
  if (previous) {
    if (stable(previous) === stable(recipe)) return workspace;
    throw new Error(
      'A different recipe already uses this identifier; existing recipes are not overwritten.',
    );
  }
  const next = {
    ...workspace,
    base_recipes: [...(workspace.base_recipes || []), recipe],
  };
  validateWorkspace(next);
  const meta = integrity(next);
  return {
    ...next,
    integrity: {
      ...meta,
      audit: [
        ...meta.audit,
        {
          at: nowIso,
          action: `Added base recipe ${recipe.id}: ${recipe.name}`,
        },
      ],
    },
  };
}

export function savePlannedBatch(
  workspace: Workspace,
  calculation: BatchCalculation,
  today: string,
  batchId = `B-LOCAL-${crypto.randomUUID()}`,
): Workspace {
  date(today);
  const suggested =
    calculation.inputs?.weighingResolutionG === 1
      ? wholeGramTargets(calculation)
      : undefined;
  const batch: Batch = {
    id: batchId,
    date: today,
    recipe_id: calculation.recipe_id,
    base_recipe_id: calculation.base_recipe_id,
    product_recipe_id: calculation.product_recipe_id,
    formulation: structuredClone(calculation),
    ...(calculation.molds ? { production: { additives: {} } } : {}),
    ...(suggested
      ? {
          weighing: {
            resolution_g: 1 as const,
            suggested_g: suggested,
            actual_g: {},
          },
        }
      : {}),
    volume_in3: calculation.volume_in3,
    fragrance_pct: calculation.fragrance_pct,
    bar_size: calculation.bar_size,
    oil_weight_g: calculation.total_oils_g,
    total_mass_g: calculation.total_mass_g,
    status: 'planned',
    bars_expected: calculation.bars_expected || 0,
    material_usage_g: structuredClone(
      suggested || calculation.materials_required_g,
    ),
    extra_material_usage_g: {},
    inventory_deducted: false,
    inventory_deducted_at: null,
    events: [],
    yield_actual: null,
    costing_scope: 'materials_required',
    costed: false,
    total_cost: calculation.costing.total_material_cost,
    cost_per_bar: calculation.bars_expected
      ? round(
          calculation.costing.total_material_cost / calculation.bars_expected,
          2,
        )
      : null,
  };

  return {
    ...workspace,
    batches: [...(workspace.batches || []), batch],
  };
}

export function recordReceipt(
  workspace: Workspace,
  input: ReceiptInput,
  today: string,
  receiptId: string,
): Workspace {
  const receipt = normalizeReceipt(input, today, receiptId);
  const existing = workspace.receipts?.find((r) => r.id === receipt.id);
  if (existing) {
    if (stable(normalizeReceiptRecord(existing)) !== stable(receipt))
      throw new Error(
        'Receipt identifier already exists with different contents.',
      );
    return applyReceiptToInventory(workspace, receipt);
  }
  const nextWorkspace = {
    ...applyReceiptToInventory(workspace, receipt),
    receipts: [receipt, ...(workspace.receipts || [])],
  };
  return nextWorkspace;
}

export function applyReceiptToInventory(
  workspace: Workspace,
  receipt: Receipt,
): Workspace {
  receipt = normalizeReceiptRecord(receipt);
  const fingerprint = stable(receipt);
  const applied = workspace.integrity?.appliedReceipts[receipt.id];
  if (applied) {
    if (applied !== fingerprint)
      throw new Error('Receipt already applied with different contents.');
    return workspace;
  }
  if (
    workspace.integrity?.reviewIssues.length &&
    workspace.receipts?.some((r) => r.id === receipt.id)
  )
    throw new Error(
      'Reconstruct historical receipt applications before applying this record.',
    );
  const constants = unwrapConstants(workspace);
  const inventory = cloneInventory(workspace.inventory);

  for (const item of receipt.items || []) {
    if (!item.material) {
      continue;
    }

    const sectionName = resolveInventorySection(
      inventory,
      item.material,
      item.category,
    );
    const section = inventory[sectionName];
    const record = section[item.material] || {
      unit: 'g',
      on_hand: 0,
      avg_cost_per_unit: 0,
    };
    const quantity = Number(item.quantity || 0);
    const total = finite(item.total, 'Receipt line amount');
    const grams = quantityToGrams(
      constants,
      item.material,
      quantity,
      item.unit || record.unit || 'g',
    );

    if (!Number.isFinite(grams) || grams <= 0) {
      throw new Error(`Invalid quantity for ${item.material}.`);
    }

    const currentGrams = quantityToGrams(
      constants,
      item.material,
      Number(record.on_hand || 0),
      record.unit || 'g',
    );
    const recordUnitGrams =
      quantityToGrams(constants, item.material, 1, record.unit || 'g') || 1;
    const currentCostPerGram =
      Number(record.avg_cost_per_unit ?? record.cost_per_unit ?? 0) /
      recordUnitGrams;
    const nextGrams = currentGrams + grams;
    const nextCostPerGram =
      (currentGrams * currentCostPerGram + total) / nextGrams;
    const outputFactor = recordUnitGrams || 1;

    section[item.material] = {
      ...record,
      on_hand: round(nextGrams / outputFactor, 4),
      avg_cost_per_unit: round(nextCostPerGram * outputFactor, 6),
    };
  }

  return {
    ...workspace,
    inventory,
    integrity: {
      ...integrity(workspace),
      appliedReceipts: {
        ...workspace.integrity?.appliedReceipts,
        [receipt.id]: fingerprint,
      },
    },
  };
}

export function recordAsset(
  workspace: Workspace,
  input: AssetInput,
  today: string,
  assetId: string,
): Workspace {
  const life = finite(input.usefulLifeMonths ?? 36, 'Useful life', 1);
  if (!Number.isInteger(life))
    throw new Error('Useful life must be whole months.');
  const asset = {
    id: assetId,
    name: String(input.name || 'Asset').trim(),
    purchased_at: input.purchasedAt || today,
    amount_usd: round(Number(input.amountUsd || 0), 2),
    useful_life_months: life,
  };
  date(asset.purchased_at);
  finite(asset.amount_usd, 'Asset amount');
  finite(asset.useful_life_months, 'Useful life', 1);

  return {
    ...workspace,
    assets: [asset, ...(workspace.assets || [])],
  };
}

export function enableBatchWeighing(
  workspace: Workspace,
  batchId: string,
): Workspace {
  const batch = findBatch(workspace, batchId);
  if (batch.weighing) return workspace;
  if (
    batch.status !== 'planned' ||
    batch.inventory_deducted ||
    batch.events?.length ||
    !batch.production ||
    !batch.formulation ||
    batch.reconciliation_required
  )
    throw new Error(
      'Actual weighing can only be enabled on an unstarted production plan.',
    );
  ensureLeaf(workspace, batchId);
  const suggested = wholeGramTargets(batch.formulation);
  return updateBatch(workspace, batchId, (b) => ({
    ...b,
    weighing: { resolution_g: 1, suggested_g: suggested, actual_g: {} },
    material_usage_g: suggested,
    costed: false,
  }));
}

export function correctAdditiveTimestamp(
  workspace: Workspace,
  input: WorkerCommandMap['correctAdditiveTimestamp']['payload'],
  nowIso: string,
): Workspace {
  return correctRecordedProductionTime(workspace, input, nowIso, 'additive');
}

export function correctPourEndTimestamp(
  workspace: Workspace,
  input: WorkerCommandMap['correctPourEndTimestamp']['payload'],
  nowIso: string,
): Workspace {
  return correctRecordedProductionTime(
    workspace,
    input,
    nowIso,
    'pour_finished',
  );
}

function correctRecordedProductionTime(
  workspace: Workspace,
  input:
    | WorkerCommandMap['correctAdditiveTimestamp']['payload']
    | WorkerCommandMap['correctPourEndTimestamp']['payload'],
  nowIso: string,
  step: 'additive' | 'pour_finished',
): Workspace {
  const batch = findBatch(workspace, input.batchId);
  if (batch.reconciliation_required)
    throw new Error('Reconcile this batch before correcting production.');
  if (batch.status === 'in_inventory' || batch.posted_to_inventory_at)
    throw new Error('Posted batches are locked.');
  const log = batch.production;
  const material = 'material' in input ? input.material : '';
  if (
    !log ||
    !batch.formulation ||
    (step === 'additive' &&
      (!productionAdditives(batch.formulation).includes(material) ||
        !log.additives[material])) ||
    (step === 'pour_finished' && !log.pour_finished)
  )
    throw new Error(
      step === 'additive'
        ? 'Record this batch additive before correcting its time.'
        : 'Record the pour end before correcting its time.',
    );
  const previous = (
    step === 'additive' ? log.additives[material] : log.pour_finished
  )!;
  if (timestamp(input.expectedAt) !== previous)
    throw new Error(
      'Recorded time changed. Review the latest batch before correcting it.',
    );
  if (
    typeof input.reason !== 'string' ||
    !input.reason.trim() ||
    input.reason.length > 500
  )
    throw new Error('Enter a correction reason (up to 500 characters).');
  const at = timestamp(input.at);
  const correctedAt = timestamp(nowIso);
  if (at > correctedAt)
    throw new Error('Production timestamp cannot be in the future.');
  const localDay = calendarDate(
    at,
    typeof workspace['timeZone'] === 'string'
      ? workspace['timeZone']
      : undefined,
  );
  if (localDay < (batch.prepped_at || batch.date || ''))
    throw new Error('Production timestamp precedes preparation.');
  const estimated =
    'estimated' in input
      ? (input.estimated ?? log.pour_finished_estimated)
      : log.pour_finished_estimated;
  if (estimated !== undefined && typeof estimated !== 'boolean')
    throw new Error('Estimated time must be a yes or no value.');
  const production =
    step === 'additive'
      ? {
          ...log,
          additives: { ...log.additives, [material]: at },
        }
      : {
          ...log,
          pour_finished: at,
          ...(estimated === undefined
            ? {}
            : { pour_finished_estimated: estimated }),
        };
  validateProductionLog(production, omittedBatchMaterials(batch));
  if (
    at === previous &&
    (step === 'additive' || !!estimated === !!log.pour_finished_estimated)
  )
    return workspace;
  const events =
    step === 'pour_finished'
      ? batch.events?.map((event) =>
          event.type === 'poured' ? { ...event, at: localDay } : event,
        )
      : batch.events;
  if (step === 'pour_finished') {
    if (!events?.some((event) => event.type === 'poured'))
      throw new Error(
        'Reconcile the missing poured event before correcting its time.',
      );
    for (let i = 1; i < events.length; i++)
      if (events[i].at < events[i - 1].at)
        throw new Error(
          'Pour end conflicts with the existing lifecycle dates.',
        );
  }
  const next = updateBatch(workspace, batch.id, (b) => ({
    ...b,
    production,
    ...(step === 'pour_finished' ? { events, poured_at: localDay } : {}),
  }));
  return {
    ...next,
    integrity: {
      appliedReceipts: {},
      finishedPosts: {},
      reviewIssues: [],
      ...next.integrity,
      audit: [
        ...(next.integrity?.audit || []),
        {
          at: correctedAt,
          action: `Corrected ${step === 'additive' ? 'additive' : 'pour end'} time for ${batch.id}${material ? `/${material}` : ''}: ${previous} -> ${at}${step === 'pour_finished' && estimated ? ' (estimated)' : ''}. Reason: ${input.reason.trim()}`,
        },
      ],
    },
  };
}

function omittedBatchMaterials(batch: Batch): string[] {
  return Object.entries(batch.weighing?.actual_g || {})
    .filter(([, g]) => g === 0)
    .map(([m]) => m);
}

export function correctAdditiveOmission(
  workspace: Workspace,
  input: WorkerCommandMap['correctAdditiveOmission']['payload'],
  nowIso: string,
): Workspace {
  const batch = findBatch(workspace, input.batchId);
  const { material, expectedWeightG } = input;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason || reason.length > 500)
    throw new Error('Enter a correction reason (up to 500 characters).');
  if (
    batch.reconciliation_required ||
    !['prepped', 'poured', 'unmolded', 'cut', 'curing', 'cured'].includes(
      batch.status,
    )
  )
    throw new Error(
      'Only a reconciled, unposted batch can correct a consumed additive.',
    );
  ensureLeaf(workspace, batch.id);
  if (
    !batch.formulation ||
    !batch.weighing ||
    !batch.production ||
    !productionAdditives(batch.formulation).includes(material)
  )
    throw new Error(
      'This batch does not have a weighed record for that additive.',
    );
  if (
    batch.production.additives[material] !== timestamp(input.expectedAt) ||
    batch.weighing.actual_g[material] !== expectedWeightG ||
    batch.material_usage_g?.[material] !== expectedWeightG ||
    !Number.isSafeInteger(expectedWeightG) ||
    expectedWeightG <= 0 ||
    (batch.inventory_deducted &&
      batch.consumption_fingerprint !== stable(batch.material_usage_g))
  )
    throw new Error(
      'The recorded additive changed. Review the batch before correcting it.',
    );

  const inventory = cloneInventory(workspace.inventory);
  const section = resolveInventorySection(inventory, material, '');
  const stock = inventory[section][material];
  if (!stock) throw new Error('The original stock item is missing.');
  const cost = finite(
    batch.consumption_costs?.[material],
    'Recorded additive cost',
  );
  const onHand = finite(stock.on_hand, 'On-hand amount');
  const oldUnitCost = finite(
    stock.avg_cost_per_unit ??
      stock.cost_per_unit ??
      (onHand === 0 ? 0 : undefined),
    'Existing stock cost',
  );
  const units =
    expectedWeightG /
    quantityToGrams(unwrapConstants(workspace), material, 1, stock.unit || 'g');
  const nextOnHand = round(onHand + units, 8);
  inventory[section][material] = {
    ...stock,
    on_hand: nextOnHand,
    avg_cost_per_unit: (onHand * oldUnitCost + cost) / nextOnHand,
  };

  const actual = { ...batch.weighing.actual_g, [material]: 0 };
  const usage = { ...batch.material_usage_g, [material]: 0 };
  const costs = { ...batch.consumption_costs, [material]: 0 };
  const meta = integrity(workspace);
  const corrected = updateBatch(
    {
      ...workspace,
      inventory,
      integrity: {
        ...meta,
        audit: [
          ...meta.audit,
          {
            at: timestamp(nowIso),
            action: `Corrected ${batch.id} ${material} as omitted. Returned ${expectedWeightG} g and ${cost} USD of recorded cost to stock. Reason: ${reason}`,
          },
        ],
      },
    },
    batch.id,
    (current) => ({
      ...current,
      weighing: { ...batch.weighing!, actual_g: actual },
      material_usage_g: usage,
      consumption_costs: costs,
      ...(batch.inventory_deducted
        ? {
            consumption_fingerprint: stable(usage),
            total_mass_g: sumValues(actual),
          }
        : {}),
      total_cost: round(sumValues(costs), 6),
      cost_per_bar: undefined,
      cost_per_bar_by_size: undefined,
      costed: false,
    }),
  );
  validateWorkspace(corrected);
  return corrected;
}

export function recordProductionStep(
  workspace: Workspace,
  input: WorkerCommandMap['recordProductionStep']['payload'],
  nowIso: string,
): Workspace {
  const batch = findBatch(workspace, input.batchId);
  if (batch.reconciliation_required)
    throw new Error('Reconcile this batch before production.');
  const log = batch.production;
  const calc = batch.formulation;
  if (!log || !calc) throw new Error('Plan a timed production batch first.');
  if (
    ![
      'lye_ready',
      'oils_ready',
      'mixed',
      'trace',
      'additive',
      'pour_started',
      'pour_finished',
    ].includes(input.step)
  )
    throw new Error('Unknown production step.');
  const material = input.material || '';
  if (
    input.step === 'additive' &&
    !productionAdditives(calc).includes(material)
  )
    throw new Error('Unknown batch additive.');
  const previous =
    input.step === 'additive' ? log.additives[material] : log[input.step];
  const group = weighingGroup(calc, input.step, material);
  if (input.actualWeightsG && (!batch.weighing || !group.length))
    throw new Error(
      'Actual weights are only accepted at weighing checkpoints.',
    );
  if (
    input.estimated !== undefined &&
    (input.step !== 'pour_finished' || typeof input.estimated !== 'boolean')
  )
    throw new Error('An estimate flag is only accepted for pour end.');
  const weights =
    batch.weighing && group.length
      ? input.actualWeightsG ||
        Object.fromEntries(
          group.map((m) => [m, batch.weighing!.suggested_g[m]]),
        )
      : undefined;
  if (previous) {
    if (input.at && timestamp(input.at) !== previous)
      throw new Error('Conflicting production timestamp.');
    if (
      input.estimated !== undefined &&
      input.estimated !== !!log.pour_finished_estimated
    )
      throw new Error(
        'Correct the recorded pour end to change its estimate flag.',
      );
    if (
      weights &&
      (Object.keys(weights).length !== group.length ||
        group.some((m) => weights[m] !== batch.weighing!.actual_g[m]))
    )
      throw new Error(
        'Conflicting actual weights; confirmed consumption is locked.',
      );
    return workspace;
  }
  if (batch.status !== 'prepped' || log.pour_finished)
    throw new Error(
      'Begin preparation before recording production; completed pours are locked.',
    );
  const at = timestamp(input.at || nowIso);
  if (at > timestamp(nowIso))
    throw new Error('Production timestamp cannot be in the future.');
  const localDay = calendarDate(
    at,
    typeof workspace['timeZone'] === 'string'
      ? workspace['timeZone']
      : undefined,
  );
  if (localDay < (batch.prepped_at || batch.date || ''))
    throw new Error('Production timestamp precedes preparation.');
  if (input.step === 'mixed' && (!log.lye_ready || !log.oils_ready))
    throw new Error('Both the lye solution and oil mix must be ready.');
  if (
    input.step === 'pour_finished' &&
    productionAdditives(calc).some((m) => !log.additives[m])
  )
    throw new Error('Record all additives before finishing the pour.');
  const production =
    input.step === 'additive'
      ? { ...log, additives: { ...log.additives, [material]: at } }
      : {
          ...log,
          [input.step]: at,
          ...(input.estimated ? { pour_finished_estimated: true } : {}),
        };
  validateProductionLog(production, omittedBatchMaterials(batch));
  let next = weights
    ? consumeWeighedGroup(workspace, batch, group, weights, localDay)
    : workspace;
  next = updateBatch(next, batch.id, (b) => ({ ...b, production }));
  if (input.step !== 'pour_finished') return next;
  next = recordBatchEvent(
    next,
    { batchId: batch.id, eventType: 'poured', at: localDay },
    localDay,
  );
  if (!input.at || at === nowIso) return next;
  const meta = integrity(next);
  return {
    ...next,
    integrity: {
      ...meta,
      audit: [
        ...meta.audit,
        {
          at: nowIso,
          action: `Recorded ${input.estimated ? 'estimated' : 'actual'} pour end for ${batch.id}: ${at} (entered at ${nowIso}).`,
        },
      ],
    },
  };
}

export function recordBatchEvent(
  workspace: Workspace,
  input: WorkerCommandMap['recordBatchEvent']['payload'],
  today: string,
): Workspace {
  const batch = findBatch(workspace, input.batchId);
  const eventType = input.eventType;
  const at = date(input.at || today);
  if (batch.reconciliation_required)
    throw new Error(
      'Review historical batch in reconstruction before changing stock.',
    );
  if (eventType === 'posted_to_inventory')
    return postFinishedGoods(workspace, { batchId: input.batchId, at }, today);
  if (eventType === 'cut') throw new Error('Record actual cut yield first.');
  const previous = batch.events?.find((e) => e.type === eventType);
  if (previous) {
    if (
      (input.at && input.at !== previous.at) ||
      (input.notes && input.notes !== previous.notes)
    )
      throw new Error('Conflicting repeated batch event.');
    if (
      eventType === 'prepped' &&
      !batch.weighing &&
      batch.consumption_fingerprint !==
        stable(
          batch.parent_batch_id
            ? batch.extra_material_usage_g || {}
            : batch.material_usage_g || {},
        )
    )
      throw new Error('Consumed materials cannot be edited.');
    return workspace;
  }
  if (STATUS_EVENTS[batch.status] !== eventType)
    throw new Error(`Cannot record ${eventType} from ${batch.status}.`);
  if (
    eventType === 'poured' &&
    batch.production &&
    !batch.production.pour_finished
  )
    throw new Error('Finish the timed pour before marking this batch poured.');
  if ((batch.events || []).some((e) => e.at > at))
    throw new Error('Event date precedes the existing timeline.');
  let next = workspace;
  if (eventType === 'prepped' && !batch.weighing)
    next = consumeBatch(workspace, batch, at);
  return updateBatch(next, input.batchId, (current) => ({
    ...current,
    status: EVENT_STATUS[eventType],
    events: [
      ...(current.events || []),
      { type: eventType, at, notes: input.notes || '' },
    ],
    [`${eventType}_at`]: at,
  }));
}

export function recordNextBatchEvent(
  workspace: Workspace,
  batchId: string,
  today: string,
): Workspace {
  const batch = findBatch(workspace, batchId);
  const eventType = STATUS_EVENTS[batch.status];
  if (!eventType) {
    return workspace;
  }
  return recordBatchEvent(workspace, { batchId, eventType }, today);
}

export function recordCutYield(
  workspace: Workspace,
  input: WorkerCommandMap['recordCutYield']['payload'],
  today: string,
): Workspace {
  const batch = findBatch(workspace, input.batchId);
  if (batch.reconciliation_required)
    throw new Error('Review historical batch before recording yield.');
  ensureLeaf(workspace, batch.id);
  if (!['unmolded', 'cut'].includes(batch.status))
    throw new Error(
      'Yield can only be recorded after unmolding and before curing.',
    );
  const sizeCounts = input.sizeCounts || {};
  for (const [size, count] of Object.entries(sizeCounts)) {
    if (
      !workspace.bar_sizes?.[size] ||
      workspace.bar_sizes[size].active === false
    )
      throw new Error(`Unknown or inactive bar size: ${size}`);
    finite(count, 'Yield count');
    if (!Number.isInteger(count))
      throw new Error('Yield counts must be whole bars.');
  }
  if (input.scrapG !== undefined) finite(input.scrapG, 'Scrap');
  if (input.shreddedG !== undefined)
    finite(input.shreddedG, 'Shredded material');
  if (input.weightGBySize !== undefined)
    validateYieldWeights(sizeCounts, input.weightGBySize);
  const at = date(input.at || today);
  if ((batch.events || []).some((e) => e.at > at))
    throw new Error('Cut date precedes the existing timeline.');
  const barsActual = sumValues(sizeCounts);
  const trim = batch.formulation
    ? estimatedTrim(batch.formulation, sizeCounts)
    : undefined;
  return updateBatch(workspace, input.batchId, (batch) => ({
    ...batch,
    status: 'cut',
    bars_actual: barsActual,
    yield_actual: {
      recorded_at: at,
      size_counts: sizeCounts,
      ...(input.weightGBySize === undefined
        ? {}
        : { weight_g_by_size: input.weightGBySize }),
      ...(input.scrapG === undefined ? {} : { scrap_g: input.scrapG }),
      ...(input.shreddedG === undefined ? {} : { shredded_g: input.shreddedG }),
      ...trim,
    },
    cut_at: at,
    costed: false,
    events: appendEventOnce(batch.events, 'cut', at),
  }));
}

export function recordCureWeighIn(
  workspace: Workspace,
  input: WorkerCommandMap['recordCureWeighIn']['payload'],
  today: string,
): Workspace {
  const batch = findBatch(workspace, input.batchId);
  if (batch.reconciliation_required)
    throw new Error('Review historical batch before recording cure weights.');
  ensureLeaf(workspace, batch.id);
  const cutDate = batch.cut_at || batch.yield_actual?.recorded_at;
  const at = date(input.at, 'Weigh-in date');
  if (!cutDate || at < cutDate || at > today)
    throw new Error('Weigh-in date must be between the cut date and today.');
  if (
    !input.sizeCounts ||
    typeof input.sizeCounts !== 'object' ||
    Array.isArray(input.sizeCounts)
  )
    throw new Error('Enter bar counts by size.');
  validateCureWeights(
    batch.yield_actual?.size_counts || {},
    input.sizeCounts,
    input.weightGBySize,
  );
  const entry = {
    at,
    size_counts: input.sizeCounts,
    weight_g_by_size: input.weightGBySize,
  };
  const previous = batch.cure_weigh_ins?.find((reading) => reading.at === at);
  if (previous) {
    if (stable(previous) === stable(entry)) return workspace;
    throw new Error('A different weigh-in is already recorded for that date.');
  }
  if (batch.status !== 'curing' && batch.status !== 'cured')
    throw new Error(
      'Cure weights can only be recorded during cure or before posting.',
    );
  return updateBatch(workspace, batch.id, (current) => ({
    ...current,
    cure_weigh_ins: [...(current.cure_weigh_ins || []), entry].sort((a, b) =>
      a.at.localeCompare(b.at),
    ),
  }));
}

export function postFinishedGoods(
  workspace: Workspace,
  input: WorkerCommandMap['postFinishedGoods']['payload'],
  today: string,
): Workspace {
  const batch = findBatch(workspace, input.batchId);
  if (batch.reconciliation_required)
    throw new Error('Review historical batch before posting.');
  ensureLeaf(workspace, batch.id);
  const yieldActual = batch.yield_actual;
  if (!yieldActual) {
    throw new Error('Record cut yield before posting finished goods.');
  }
  const fingerprint = stable({
    yield: yieldActual,
    total: batch.total_cost,
    perBar: batch.cost_per_bar,
    ...(batch.formulation?.molds
      ? { perSize: batch.cost_per_bar_by_size }
      : {}),
  });
  const previous = workspace.integrity?.finishedPosts[batch.id];
  if (previous) {
    if (previous !== fingerprint)
      throw new Error('Posted yield and costing cannot be edited.');
    return workspace;
  }
  if (batch.status !== 'cured' || !batch.cure_completed_at)
    throw new Error('Batch must be cured before posting.');
  if (
    !batch.costed ||
    batch.cost_per_bar == null ||
    (batch.missing_material_costs as string[] | undefined)?.length
  )
    throw new Error('Complete costing before posting.');
  if (sumValues(yieldActual.size_counts || {}) <= 0)
    throw new Error('Positive observed yield is required.');
  const postedAt = date(input.at || today);
  if (String(batch.cure_completed_at) > postedAt)
    throw new Error('Posting date precedes cure completion.');

  const inventory = cloneInventory(workspace.inventory);
  const finishedGoods = { ...(inventory.finished_goods || {}) };

  for (const [size, count] of Object.entries(yieldActual.size_counts || {})) {
    const costPerBar = Number(
      batch.cost_per_bar_by_size?.[size] ?? batch.cost_per_bar ?? 0,
    );
    const key = `${batch.product_recipe_id || batch.base_recipe_id}.${size}`;
    const existing = finishedGoods[key] || {
      unit: 'bar',
      on_hand: 0,
      avg_cost_per_unit: 0,
    };
    const oldCount = Number(existing.on_hand || 0);
    const newCount = oldCount + Number(count || 0);
    const oldCost = Number(
      existing.avg_cost_per_unit ?? existing.cost_per_unit ?? 0,
    );
    const nextCost =
      newCount > 0
        ? (oldCount * oldCost + Number(count || 0) * costPerBar) / newCount
        : 0;
    finishedGoods[key] = {
      unit: 'bar',
      on_hand: newCount,
      avg_cost_per_unit: round(nextCost, 4),
    };
  }

  inventory.finished_goods = finishedGoods;
  const nextWorkspace = {
    ...workspace,
    inventory,
    integrity: {
      ...integrity(workspace),
      finishedPosts: {
        ...workspace.integrity?.finishedPosts,
        [batch.id]: fingerprint,
      },
    },
  };

  return updateBatch(nextWorkspace, input.batchId, (current) => ({
    ...current,
    status: 'in_inventory',
    posted_to_inventory_at: postedAt,
    events: appendEventOnce(
      current.events,
      'posted_to_inventory',
      input.at || today,
    ),
  }));
}

export function runCosting(
  workspace: Workspace,
  input: WorkerCommandMap['runCosting']['payload'] = {},
): Workspace {
  const constants = unwrapConstants(workspace);
  const batches = (workspace.batches || []).map((batch) => {
    if (input.batchId && batch.id !== input.batchId) {
      return batch;
    }
    if (workspace.integrity?.finishedPosts[batch.id]) return batch;
    if (batch.reconciliation_required)
      throw new Error(
        'Reconcile historical consumption before costing this batch.',
      );
    const existingUsage = batch.material_usage_g;
    const usage = Object.keys(existingUsage || {}).length
      ? existingUsage || {}
      : materialRequirementsForBatch(workspace, batch);
    const frozenCosts = batch.consumption_costs as NumericMap | undefined;
    const costing = frozenCosts
      ? {
          total_material_cost: sumValues(frozenCosts),
          missing_material_costs: [] as string[],
        }
      : costMaterials(workspace.inventory, usage, constants);
    const missingCosts = [...costing.missing_material_costs];
    if (batch.weighing && !batch.inventory_deducted)
      missingCosts.push('Unconfirmed actual weights');
    const barCount = Number(batch.bars_actual ?? batch.bars_expected ?? 0);
    const molds = batch.formulation?.molds;
    const counts =
      batch.yield_actual?.size_counts ||
      (molds
        ? molds.reduce<Record<string, number>>(
            (n, m) => ({
              ...n,
              [m.barSize]: (n[m.barSize] || 0) + m.bars_expected,
            }),
            {},
          )
        : {});
    const volumes = Object.fromEntries(
      (molds || []).map((m) => [m.barSize, m.bar_volume_in3]),
    );
    const barVolume = Object.entries(counts).reduce(
      (n, [size, count]) => n + count * (volumes[size] || 0),
      0,
    );
    const perSize =
      molds && barVolume > 0
        ? Object.fromEntries(
            Object.keys(counts).map((size) => [
              size,
              round(
                (costing.total_material_cost * (volumes[size] || 0)) /
                  barVolume,
                6,
              ),
            ]),
          )
        : undefined;
    return {
      ...batch,
      material_usage_g: usage,
      total_cost: costing.total_material_cost,
      ...(perSize ? { cost_per_bar_by_size: perSize } : {}),
      cost_per_bar:
        barCount > 0 ? round(costing.total_material_cost / barCount, 6) : null,
      missing_material_costs: missingCosts,
      costed: missingCosts.length === 0 && Boolean(frozenCosts),
    };
  });

  return {
    ...workspace,
    batches,
  };
}

export function runCapacityAudit(
  workspace: Workspace,
  input: Partial<BatchCalculationInput> = {},
): CapacityAudit {
  const recipeId =
    input.recipeId ||
    workspace.product_recipes?.[0]?.id ||
    workspace.base_recipes?.[0]?.id;
  if (!recipeId) {
    throw new Error('No recipe is available for the capacity audit.');
  }
  const calculation = calculateBatch(workspace, {
    ...input,
    recipeId,
    volumeIn3: input.volumeIn3 ?? 57.62,
    barSize: input.barSize || 'bar_5_2_oz',
    fragrancePct: input.fragrancePct,
  });
  const constants = unwrapConstants(workspace);
  const available = inventoryOnHandGrams(workspace.inventory, constants);
  const requirements =
    input.weighingResolutionG === 1
      ? wholeGramTargets(calculation)
      : calculation.materials_required_g;
  const shortages: Record<
    string,
    { required_g: number; on_hand_g: number; short_g: number }
  > = {};

  for (const [material, grams] of Object.entries(requirements)) {
    const onHand = available[material] || 0;
    if (onHand + 1e-9 < grams) {
      shortages[material] = {
        required_g: round(grams, 2),
        on_hand_g: round(onHand, 2),
        short_g: round(grams - onHand, 2),
      };
    }
  }

  return {
    recipe_id: recipeId,
    materials_required_g: requirements,
    shortages,
    can_make: Object.keys(shortages).length === 0,
  };
}

export function buildReports(
  workspace: Workspace,
  asOf = new Date().toISOString().slice(0, 10),
): Reports {
  date(asOf, 'Reporting date');
  const constants = unwrapConstants(workspace);
  const inventoryValue = inventorySections(workspace.inventory).reduce(
    (total, [, items]) => {
      return (
        total +
        Object.values(items || {}).reduce((sectionTotal, item) => {
          return (
            sectionTotal +
            Number(item.on_hand || 0) *
              Number(item.avg_cost_per_unit ?? item.cost_per_unit ?? 0)
          );
        }, 0)
      );
    },
    0,
  );
  const assetSpend = (workspace.assets || []).reduce(
    (total, asset) => total + Number(asset.amount_usd || 0),
    0,
  );
  const monthlyAmortization = (workspace.assets || []).reduce(
    (total, asset) => total + monthlyAssetCharge(asset, asOf),
    0,
  );
  const batchCount = (workspace.batches || []).length;
  const activeBatches = (workspace.batches || []).filter(
    (batch) => !['cured', 'in_inventory', 'shredded'].includes(batch.status),
  ).length;
  const gramsOnHand = inventoryOnHandGrams(workspace.inventory, constants);

  return {
    inventoryValue: round(inventoryValue, 2),
    assetSpend: round(assetSpend, 2),
    monthlyAmortization: round(monthlyAmortization, 2),
    batchCount,
    activeBatches,
    gramsOnHand,
  };
}

export function monthlyAssetCharge(
  asset: Asset,
  asOf = new Date().toISOString().slice(0, 10),
): number {
  const month = (d: string) =>
    Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
  const elapsed = month(date(asOf)) - month(date(asset.purchased_at));
  finite(asset.amount_usd, 'Asset amount');
  finite(asset.useful_life_months, 'Useful life', 1);
  return elapsed < 0 || elapsed >= asset.useful_life_months
    ? 0
    : asset.amount_usd / asset.useful_life_months;
}

export function exportWorkspace(workspace: Workspace, nowIso: string): string {
  return JSON.stringify(
    {
      exportedAt: nowIso,
      app: 'red-mountain-soap-suite',
      workspace,
    },
    null,
    2,
  );
}

export function importWorkspace(raw: string): Workspace {
  const parsed: unknown = JSON.parse(raw);
  const workspace =
    isRecord(parsed) && 'workspace' in parsed ? parsed['workspace'] : parsed;
  const migrated = migrateWorkspace(workspace);
  return {
    ...migrated,
    receipts: migrated.receipts?.map(normalizeReceiptRecord),
  };
}

export function nextEventLabel(status: BatchStatus): string {
  const eventType = STATUS_EVENTS[status];
  if (!eventType) {
    return '';
  }
  return eventType.replaceAll('_', ' ');
}

function materialRequirementsForBatch(
  workspace: Workspace,
  batch: Batch,
): NumericMap {
  const recipeId =
    batch.product_recipe_id || batch.base_recipe_id || batch.recipe_id;
  if (!recipeId) {
    throw new Error(`Batch ${batch.id} does not identify a recipe.`);
  }
  const snapshot = batch.formulation as BatchCalculation | undefined;
  if (snapshot) return snapshot.materials_required_g;
  finite(batch.oil_weight_g, 'Recorded oil weight', Number.MIN_VALUE);
  const reference = calculateBatch(workspace, {
    recipeId,
    volumeIn3: 1,
    fragrancePct: batch.fragrance_pct,
  });
  const ratio = Number(batch.oil_weight_g) / reference.total_oils_g;
  return Object.fromEntries(
    Object.entries(reference.materials_required_g).map(([k, v]) => [
      k,
      round(v * ratio, 5),
    ]),
  );
}

function productDefault(workspace: Workspace, recipeId: string): number {
  const { productRecipe } = resolveRecipe(workspace, recipeId);
  return productRecipe?.fragrance?.type === 'none'
    ? 0
    : Number(productRecipe?.fragrance?.['default_percent'] ?? 0);
}

function normalizeReceipt(
  input: ReceiptInput,
  today: string,
  receiptId: string,
): Receipt {
  const lineTotal = round(finite(input.total, 'Receipt line amount'), 2);
  if (!input.vendor.trim() || !input.unit.trim() || !input.material.trim())
    throw new Error('Vendor, material and unit are required.');
  finite(input.quantity, 'Material quantity', Number.MIN_VALUE);
  return normalizeReceiptRecord({
    id: receiptId,
    date: input.date || today,
    vendor: String(input.vendor || 'Unknown vendor').trim(),
    payment_method: input.paymentMethod || 'unknown',
    total: round(lineTotal + Number(input.taxUsd || 0), 2),
    tax_usd: Number(input.taxUsd || 0),
    items: [
      {
        name: String(input.itemName || input.material || 'Material').trim(),
        category: input.category || 'raw_material',
        material: String(input.material || '').trim(),
        quantity: Number(input.quantity || 0),
        unit: input.unit || 'g',
        total: lineTotal,
        account: input.account || 'assets.inventory.raw_materials',
      },
    ],
  });
}

export function normalizeReceiptRecord(receipt: Receipt): Receipt {
  date(receipt.date, 'Receipt date');
  if (
    !receipt.id ||
    !receipt.vendor ||
    !receipt.payment_method ||
    !Array.isArray(receipt.items) ||
    !receipt.items.length
  )
    throw new Error(
      'Receipt identity, vendor, payment and lines are required.',
    );
  const items = receipt.items.map((item: ReceiptLine) => {
    const amount = finite(item.total ?? item.amount_usd, 'Receipt line amount');
    if (
      item.total !== undefined &&
      item.amount_usd !== undefined &&
      Math.abs(item.total - item.amount_usd) > 1e-6
    )
      throw new Error('Conflicting receipt line amounts.');
    if (!item.name || !item.account)
      throw new Error('Receipt line name and account are required.');
    if (item.material) {
      finite(item.quantity, 'Material quantity', Number.MIN_VALUE);
      if (!item.unit) throw new Error('Material unit is required.');
    }
    const { amount_usd: _alias, ...rest } = item;
    return { ...rest, total: amount };
  });
  const explicitTax = items.some((item) =>
    /(^|[._\s])tax(es)?($|[._\s])/i.test(
      `${item.category || ''} ${item.account} ${item.name}`,
    ),
  );
  const tax = finite(receipt.tax_usd ?? 0, 'Tax');
  const expected = round(
    items.reduce((sum, item) => sum + item.total, 0) + (explicitTax ? 0 : tax),
    2,
  );
  const total = receipt.total ?? receipt.total_usd ?? expected;
  finite(total, 'Receipt total');
  if (
    receipt.total !== undefined &&
    receipt.total_usd !== undefined &&
    Math.abs(receipt.total - receipt.total_usd) > 1e-6
  )
    throw new Error('Conflicting receipt totals.');
  if (Math.abs(total - expected) > 0.011)
    throw new Error(
      `Receipt ${receipt.id} total does not match lines and tax (${expected}).`,
    );
  const { total_usd: _alias, ...rest } = receipt;
  return { ...rest, items, total: expected, tax_usd: tax };
}

function resolveRecipe(
  workspace: Workspace,
  recipeId: string,
): { baseRecipe: BaseRecipe; productRecipe: ProductRecipe | null } {
  const productRecipe = (workspace.product_recipes || []).find(
    (recipe) => recipe.id === recipeId,
  );
  const baseId = productRecipe?.base_recipe_id || recipeId;
  const baseRecipe = (workspace.base_recipes || []).find(
    (recipe) => recipe.id === baseId,
  );
  if (!baseRecipe) {
    throw new Error(`Recipe not found: ${recipeId}`);
  }
  return { baseRecipe, productRecipe: productRecipe || null };
}

function unwrapConstants(workspace: Workspace): WorkspaceConstants {
  const sapValues = workspace.constants?.sap_values || {};
  return {
    units: workspace.constants?.units || {},
    density: workspace.constants?.density || {},
    sap_values: isNumericMap(sapValues) ? { naoh: sapValues } : sapValues,
  };
}

function resolveFragranceMaterial(productRecipe: ProductRecipe | null): string {
  const type = productRecipe?.fragrance?.type;
  if (!type || type === 'none') {
    return 'fragrance_oil';
  }
  return String(type).replace('_optional', '');
}

function splitOils(
  totalOilsG: number,
  oilsPct: NumericMap,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(oilsPct).map(([oil, pct]) => [
      oil,
      Number(totalOilsG) * (Number(pct) / 100),
    ]),
  );
}

function lyeForOils(
  oilsG: NumericMap,
  sapMap: NumericMap,
  superfatPct: number,
): number {
  const theoretical = Object.entries(oilsG).reduce((total, [oil, grams]) => {
    if (!grams) return total;
    if (sapMap[oil] == null) {
      throw new Error(`No SAP value for ${oil}.`);
    }
    return (
      total +
      Number(grams) * finite(sapMap[oil], `SAP ${oil}`, Number.MIN_VALUE)
    );
  }, 0);
  return theoretical * (1 - Number(superfatPct) / 100);
}

function costMaterials(
  inventory: Inventory,
  materialsRequiredG: NumericMap,
  constants: WorkspaceConstants,
): MaterialCosting {
  const costPerGram = inventoryCostPerGram(inventory, constants);
  const materialCosts: Record<string, number> = {};
  const missing: string[] = [];
  let total = 0;

  for (const [material, grams] of Object.entries(materialsRequiredG || {})) {
    if (!grams) continue;
    if (costPerGram[material] == null) {
      missing.push(material);
      continue;
    }
    const cost = Number(grams) * costPerGram[material];
    materialCosts[material] = round(cost, 4);
    total += cost;
  }

  return {
    scope: 'materials_required',
    total_material_cost: round(total, 4),
    material_costs: materialCosts,
    missing_material_costs: missing.sort(),
  };
}

function inventoryCostPerGram(
  inventory: Inventory,
  constants: WorkspaceConstants,
): Record<string, number> {
  const costMap: Record<string, number> = {};
  for (const [, section] of inventorySections(inventory)) {
    for (const [material, record] of Object.entries(section || {})) {
      if (['bar', 'each'].includes(record.unit || '')) continue;
      const factor = quantityToGrams(
        constants,
        material,
        1,
        record.unit || 'g',
      );
      if (record.avg_cost_per_unit != null || record.cost_per_unit != null) {
        costMap[material] =
          finite(
            record.avg_cost_per_unit ?? record.cost_per_unit,
            `Cost ${material}`,
          ) / factor;
      }
    }
  }
  return costMap;
}

function inventoryOnHandGrams(
  inventory: Inventory,
  constants: WorkspaceConstants,
): Record<string, number> {
  const grams: Record<string, number> = {};
  for (const [, section] of inventorySections(inventory)) {
    for (const [material, record] of Object.entries(section || {})) {
      if (['bar', 'each'].includes(record.unit || '')) continue;
      grams[material] = quantityToGrams(
        constants,
        material,
        Number(record.on_hand || 0),
        record.unit || 'g',
      );
    }
  }
  return grams;
}

function inventorySections(
  inventory: Inventory,
): ReadonlyArray<readonly [string, Readonly<Record<string, InventoryRecord>>]> {
  return [
    ['raw_materials', inventory?.raw_materials || {}],
    ['additives', inventory?.additives || {}],
    ['finished_goods', inventory?.finished_goods || {}],
  ];
}

function resolveInventorySection(
  inventory: MutableInventory,
  material: string,
  category: string | undefined,
): InventorySectionName {
  if (inventory.raw_materials?.[material]) {
    return 'raw_materials';
  }
  if (inventory.additives?.[material]) {
    return 'additives';
  }
  if (String(category || '').includes('additive')) {
    inventory.additives ||= {};
    return 'additives';
  }
  inventory.raw_materials ||= {};
  return 'raw_materials';
}

function quantityToGrams(
  constants: WorkspaceConstants,
  material: string,
  quantity: number,
  unit: string,
): number {
  const massFactor = unitToG(constants, unit);
  if (massFactor) {
    return finite(Number(quantity), `Quantity ${material}`) * massFactor;
  }

  const mlFactor = unitToMl(constants, unit);
  if (mlFactor) {
    return (
      finite(Number(quantity), `Quantity ${material}`) *
      mlFactor *
      densityFor(constants.density, material)
    );
  }

  throw new Error(`Unknown mass or volume unit: ${unit}`);
}

export function materialQuantityGrams(
  workspace: Workspace,
  material: string,
  quantity: number,
  unit: string,
): number {
  return quantityToGrams(unwrapConstants(workspace), material, quantity, unit);
}

function unitToG(constants: WorkspaceConstants, unit: string): number {
  return Number(
    constants.units?.[unit.trim()]?.to_g ||
      constants.units?.[String(unit).trim().toLowerCase()]?.to_g ||
      0,
  );
}

function unitToMl(constants: WorkspaceConstants, unit: string): number {
  return Number(
    constants.units?.[unit.trim()]?.to_ml ||
      constants.units?.[String(unit).trim().toLowerCase()]?.to_ml ||
      0,
  );
}

function densityFor(
  densityMap: NumericMap,
  material: string,
  fallback: number | null = null,
): number {
  const key = String(material);
  const density = densityMap[key] ?? densityMap[key.toLowerCase()];
  if (density == null) {
    if (fallback != null) {
      return fallback;
    }
    throw new Error(`No density for ${material}.`);
  }
  return finite(Number(density), `Density ${material}`, Number.MIN_VALUE);
}

function findBatch(workspace: Workspace, batchId: string): Batch {
  const batch = (workspace.batches || []).find((item) => item.id === batchId);
  if (!batch) {
    throw new Error(`Batch not found: ${batchId}`);
  }
  return batch;
}

export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function integrity(workspace: Workspace) {
  return (
    workspace.integrity || {
      appliedReceipts: {},
      finishedPosts: {},
      reviewIssues: [],
      audit: [],
    }
  );
}

function ensureLeaf(workspace: Workspace, batchId: string) {
  if (workspace.batches?.some((b) => b.parent_batch_id === batchId))
    throw new Error(
      'Only leaf batches may record yield or post finished goods.',
    );
}

function consumeWeighedGroup(
  workspace: Workspace,
  batch: Batch,
  group: string[],
  weights: NumericMap,
  at: string,
): Workspace {
  if (
    Object.keys(weights).length !== group.length ||
    Object.keys(weights).some((m) => !group.includes(m))
  )
    throw new Error(
      'Provide the complete weighing group, with no other ingredients.',
    );
  for (const m of group) {
    const grams = finite(weights[m], `Actual ${m}`);
    if (!Number.isSafeInteger(grams))
      throw new Error('Actual amounts must be whole grams.');
    if (batch.formulation!.materials_required_g[m] < 1)
      throw new Error(`${m} requires a finer scale than whole grams.`);
    if (!grams && !productionAdditives(batch.formulation!).includes(m))
      throw new Error(`Actual ${m} must be positive.`);
    if (m in batch.weighing!.actual_g)
      throw new Error('Confirmed actual amounts are locked.');
  }
  const constants = unwrapConstants(workspace);
  const cost = costMaterials(workspace.inventory, weights, constants);
  if (cost.missing_material_costs.length)
    throw new Error(
      `Missing material costs: ${cost.missing_material_costs.join(', ')}`,
    );
  const inventory = cloneInventory(workspace.inventory);
  for (const [m, grams] of Object.entries(weights)) {
    if (!grams) continue;
    const section = resolveInventorySection(inventory, m, '');
    const stock = inventory[section][m];
    if (!stock) throw new Error(`Insufficient inventory: ${m}`);
    const factor = quantityToGrams(constants, m, 1, stock.unit || 'g');
    const remaining = Number(stock.on_hand || 0) * factor - grams;
    if (remaining < -1e-6) throw new Error(`Insufficient inventory: ${m}`);
    inventory[section][m] = {
      ...stock,
      on_hand: round(Math.max(0, remaining) / factor, 8),
    };
  }
  const actual = { ...batch.weighing!.actual_g, ...weights };
  const usage = { ...batch.material_usage_g, ...weights };
  const complete = Object.keys(batch.weighing!.suggested_g).every(
    (m) => m in actual,
  );
  const costs = {
    ...batch.consumption_costs,
    ...Object.fromEntries(group.map((m) => [m, cost.material_costs[m] || 0])),
  };
  const oils = Object.keys(batch.formulation!.oils_g || {});
  return updateBatch({ ...workspace, inventory }, batch.id, (current) => ({
    ...current,
    weighing: { ...current.weighing!, actual_g: actual },
    material_usage_g: usage,
    consumption_costs: costs,
    inventory_deducted: complete,
    ...(complete
      ? {
          inventory_deducted_at: at,
          consumption_fingerprint: stable(usage),
          total_mass_g: sumValues(actual),
        }
      : {}),
    ...(oils.every((m) => m in actual)
      ? { oil_weight_g: oils.reduce((n, m) => n + actual[m], 0) }
      : {}),
    total_cost: round(sumValues(costs), 6),
    costed: false,
  }));
}

function consumeBatch(
  workspace: Workspace,
  batch: Batch,
  at: string,
): Workspace {
  validateWorkspace(workspace);
  const parent = batch.parent_batch_id
    ? findBatch(workspace, String(batch.parent_batch_id))
    : null;
  if (parent && !parent.inventory_deducted)
    throw new Error('Prepare the parent batch before its children.');
  const usage = parent
    ? batch.extra_material_usage_g || {}
    : Object.keys(batch.material_usage_g || {}).length
      ? batch.material_usage_g!
      : materialRequirementsForBatch(workspace, batch);
  if (batch.inventory_deducted)
    throw new Error(
      'Consumption exists without a matching prep event; reconcile history first.',
    );
  const constants = unwrapConstants(workspace);
  const inventory = cloneInventory(workspace.inventory);
  for (const [material, grams] of Object.entries(usage)) {
    if (!grams) continue;
    finite(grams, `Required ${material}`);
    const section = resolveInventorySection(inventory, material, '');
    const record = inventory[section][material];
    if (!record) throw new Error(`Insufficient inventory: ${material}`);
    const factor = quantityToGrams(constants, material, 1, record.unit || 'g');
    const remaining = Number(record.on_hand || 0) * factor - grams;
    if (remaining < -1e-6)
      throw new Error(`Insufficient inventory: ${material}`);
    inventory[section][material] = {
      ...record,
      on_hand: round(Math.max(0, remaining) / factor, 8),
    };
  }
  const cost = costMaterials(workspace.inventory, usage, constants);
  if (cost.missing_material_costs.length)
    throw new Error(
      `Missing material costs: ${cost.missing_material_costs.join(', ')}`,
    );
  const parentRatio = parent
    ? Number(batch.oil_weight_g) / Number(parent.oil_weight_g)
    : 0;
  const allocated = Object.fromEntries(
    Object.entries((parent?.consumption_costs || {}) as NumericMap).map(
      ([k, v]) => [k, v * parentRatio],
    ),
  );
  for (const [material, value] of Object.entries(cost.material_costs))
    allocated[material] = (allocated[material] || 0) + value;
  const childUsage = parent
    ? Object.fromEntries(
        Object.entries(parent.material_usage_g || {}).map(([k, v]) => [
          k,
          v * parentRatio,
        ]),
      )
    : null;
  if (childUsage)
    for (const [material, grams] of Object.entries(usage))
      childUsage[material] = (childUsage[material] || 0) + grams;
  return updateBatch({ ...workspace, inventory }, batch.id, (current) => ({
    ...current,
    material_usage_g: childUsage || usage,
    consumption_costs: allocated,
    consumption_fingerprint: stable(usage),
    inventory_deducted: true,
    inventory_deducted_at: at,
  }));
}

function updateBatch(
  workspace: Workspace,
  batchId: string,
  updater: (batch: Batch) => Batch,
): Workspace {
  return {
    ...workspace,
    batches: (workspace.batches || []).map((batch) => {
      if (batch.id !== batchId) {
        return batch;
      }
      return updater(batch);
    }),
  };
}

function appendEventOnce(
  events: ReadonlyArray<BatchEvent> = [],
  type: string,
  at: string,
): ReadonlyArray<BatchEvent> {
  if (events.some((event) => event.type === type)) {
    return events;
  }
  return [...events, { type, at }];
}

function cloneInventory(inventory: Inventory): MutableInventory {
  return {
    raw_materials: { ...(inventory?.raw_materials || {}) },
    additives: { ...(inventory?.additives || {}) },
    finished_goods: { ...(inventory?.finished_goods || {}) },
  };
}

function sumValues(values: NumericMap): number {
  return Object.values(values || {}).reduce(
    (total, value) => total + Number(value || 0),
    0,
  );
}

function roundMap(values: NumericMap, places: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values || {}).map(([key, value]) => [
      key,
      round(value, places),
    ]),
  );
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumericMap(value: unknown): value is NumericMap {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => typeof item === 'number')
  );
}
