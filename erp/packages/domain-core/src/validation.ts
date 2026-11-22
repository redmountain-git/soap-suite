import type { Workspace } from '@rmsc/worker-protocol';
import {
  estimatedTrim,
  calendarDate,
  wholeGramTargets,
  weighingGroup,
  productionAdditives,
  validateProductionLog,
} from './production';
import type { BatchCalculation } from '@rmsc/worker-protocol';
import { validateCureWeights, validateYieldWeights } from './yield-weights';

type JsonObject = Record<string, unknown> &
  Partial<
    Record<
      | 'id'
      | 'name'
      | 'version'
      | 'inventory'
      | 'constants'
      | 'units'
      | 'density'
      | 'sap_values'
      | 'unit'
      | 'on_hand'
      | 'avg_cost_per_unit'
      | 'cost_per_unit'
      | 'base_recipes'
      | 'product_recipes'
      | 'base_recipe_id'
      | 'product_recipe_id'
      | 'recipe_id'
      | 'oils_pct'
      | 'bar_sizes'
      | 'approx_volume_in3'
      | 'assets'
      | 'purchased_at'
      | 'amount_usd'
      | 'useful_life_months'
      | 'receipts'
      | 'date'
      | 'vendor'
      | 'payment_method'
      | 'items'
      | 'account'
      | 'total'
      | 'material'
      | 'quantity'
      | 'batches'
      | 'status'
      | 'events'
      | 'type'
      | 'at'
      | 'yield_actual'
      | 'size_counts'
      | 'parent_batch_id'
      | 'oil_weight_g'
      | 'revision'
      | 'integrity'
      | 'appliedReceipts'
      | 'finishedPosts'
      | 'reviewIssues'
      | 'audit',
      unknown
    >
  >;

export function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function finite(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum)
    throw new Error(`${label} must be a finite number >= ${minimum}.`);
  return value;
}

export function date(value: unknown, label = 'Date'): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  return value;
}

function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${label} is required.`);
}

function rows(value: unknown, label: string): JsonObject[] {
  if (!Array.isArray(value))
    throw new Error(`${label} must be an array of records.`);
  const records = value as unknown[];
  if (records.some((v) => !object(v)))
    throw new Error(`${label} must be an array of records.`);
  const ids = new Set<string>();
  for (const row of records as JsonObject[]) {
    text(row.id, `${label} id`);
    if (ids.has(row.id)) throw new Error(`Duplicate ${label} id: ${row.id}`);
    ids.add(row.id);
  }
  return records as JsonObject[];
}

function numericMap(value: unknown, label: string) {
  if (!object(value)) throw new Error(`${label} must be a numeric map.`);
  for (const [key, n] of Object.entries(value)) finite(n, `${label}.${key}`);
}

export function validateWorkspace(value: unknown): asserts value is Workspace {
  if (!object(value) || ![1, 2, '1', '2'].includes(value.version as number))
    throw new Error('Unsupported workspace version.');
  if (!object(value.inventory)) throw new Error('Inventory is required.');
  if (
    !object(value.constants) ||
    !object(value.constants.units) ||
    !object(value.constants.density) ||
    !object(value.constants.sap_values)
  )
    throw new Error('Workspace constants are required.');
  numericMap(value.constants.density, 'Density');
  for (const [material, density] of Object.entries(value.constants.density))
    finite(density, `Density ${material}`, Number.MIN_VALUE);
  for (const [key, sap] of Object.entries(value.constants.sap_values)) {
    if (object(sap)) {
      for (const [oil, n] of Object.entries(sap))
        finite(n, `SAP ${key}.${oil}`, Number.MIN_VALUE);
    } else finite(sap, `SAP ${key}`, Number.MIN_VALUE);
  }
  for (const [name, spec] of Object.entries(value.constants.units)) {
    if (
      !object(spec) ||
      !['to_g', 'to_ml', 'to_each'].some(
        (k) => typeof spec[k] === 'number' && (spec[k] as number) > 0,
      )
    )
      throw new Error(`Invalid unit: ${name}`);
    for (const k of ['to_g', 'to_ml', 'to_each'])
      if (spec[k] !== undefined)
        finite(spec[k], `${name}.${k}`, Number.MIN_VALUE);
  }
  for (const [section, stock] of Object.entries(value.inventory)) {
    if (!object(stock))
      throw new Error(`Invalid inventory section: ${section}`);
    for (const [material, record] of Object.entries(stock)) {
      if (!object(record)) throw new Error(`Invalid stock: ${material}`);
      text(record.unit, `${material} unit`);
      if (
        !object(value.constants.units[record.unit]) &&
        !['bar', 'each'].includes(record.unit)
      )
        throw new Error(`Unknown unit: ${record.unit}`);
      finite(record.on_hand, `${material} on hand`);
      const spec = value.constants.units[record.unit];
      if (object(spec) && spec['to_ml'])
        finite(
          value.constants.density[material],
          `Density ${material}`,
          Number.MIN_VALUE,
        );
      if (
        ['bar', 'each'].includes(record.unit) &&
        !Number.isInteger(record.on_hand)
      )
        throw new Error('Count inventory must contain whole units.');
      if (record.avg_cost_per_unit !== undefined)
        finite(record.avg_cost_per_unit, `${material} cost`);
      if (record.cost_per_unit !== undefined)
        finite(record.cost_per_unit, `${material} cost`);
    }
  }
  const bases = rows(value.base_recipes, 'Base recipes');
  const products = rows(value.product_recipes, 'Product recipes');
  const baseIds = new Set(bases.map((b) => b.id));
  for (const b of bases) {
    text(b.name, 'Recipe name');
    if (
      b['status'] !== undefined &&
      !['draft', 'ready'].includes(String(b['status']))
    )
      throw new Error('Invalid recipe status.');
    if (
      b['review_required'] !== undefined &&
      (!Array.isArray(b['review_required']) ||
        b['review_required'].some(
          (issue) => typeof issue !== 'string' || !issue.trim(),
        ))
    )
      throw new Error('Invalid recipe review requirements.');
    if (
      b['status'] === 'draft' &&
      (!Array.isArray(b['review_required']) || !b['review_required'].length)
    )
      throw new Error('Draft recipes require review requirements.');
    numericMap(b.oils_pct, 'Oil percentages');
    const sum = Object.values(b.oils_pct as Record<string, number>).reduce(
      (a, n) => a + n,
      0,
    );
    if (Math.abs(sum - 100) > 1e-6)
      throw new Error('Oil percentages must sum to 100.');
    if (b['lye'] !== undefined) {
      if (!object(b['lye'])) throw new Error('Invalid lye settings.');
      const purity = b['lye']['purity_percent'];
      if (
        purity !== undefined &&
        finite(purity, 'Lye purity', Number.MIN_VALUE) > 100
      )
        throw new Error('Lye purity exceeds 100%.');
      const sf = b['lye']['default_superfat_pct'];
      if (sf !== undefined && finite(sf, 'Superfat') >= 100)
        throw new Error('Superfat must be less than 100%.');
      if (b['lye']['type'] !== undefined) text(b['lye']['type'], 'Lye type');
    }
    if (b['liquid'] !== undefined && !object(b['liquid']))
      throw new Error('Invalid liquid settings.');
    if (b['additives_pct'] !== undefined)
      numericMap(b['additives_pct'], 'Additive percentages');
  }
  for (const p of products) {
    text(p.name, 'Product name');
    if (!baseIds.has(p.base_recipe_id))
      throw new Error(`Unknown base recipe for ${p.id}`);
    if (p['fragrance'] !== undefined) {
      if (!object(p['fragrance']))
        throw new Error('Invalid fragrance settings.');
      if (p['fragrance']['type'] !== undefined)
        text(p['fragrance']['type'], 'Fragrance type');
      for (const key of ['default_percent', 'max_percent'])
        if (p['fragrance'][key] !== undefined)
          finite(p['fragrance'][key], `Fragrance ${key}`);
    }
  }
  if (!object(value.bar_sizes)) throw new Error('Bar sizes are required.');
  for (const [key, size] of Object.entries(value.bar_sizes)) {
    if (!object(size)) throw new Error(`Invalid bar size: ${key}`);
    finite(size.approx_volume_in3, `Bar volume ${key}`, Number.MIN_VALUE);
  }
  for (const asset of rows(value.assets, 'Assets')) {
    text(asset.name, 'Asset name');
    date(asset.purchased_at);
    finite(asset.amount_usd, 'Asset amount');
    const months = finite(asset.useful_life_months, 'Useful life', 1);
    if (!Number.isInteger(months))
      throw new Error('Useful life must be whole months.');
  }
  for (const receipt of rows(value.receipts, 'Receipts')) {
    date(receipt.date);
    text(receipt.vendor, 'Vendor');
    text(receipt.payment_method, 'Payment method');
    if (!Array.isArray(receipt.items) || !receipt.items.length)
      throw new Error('Receipt lines are required.');
    for (const line of receipt.items) {
      if (!object(line)) throw new Error('Invalid receipt line.');
      text(line.name, 'Line name');
      text(line.account, 'Line account');
      finite(line.total ?? line.amount_usd, 'Line amount');
      if (
        line.total !== undefined &&
        line.amount_usd !== undefined &&
        Math.abs(Number(line.total) - Number(line.amount_usd)) > 0.000001
      )
        throw new Error('Conflicting receipt amounts.');
      if (line.material) {
        text(line.material, 'Material');
        finite(line.quantity, 'Quantity', Number.MIN_VALUE);
        text(line.unit, 'Unit');
        if (!value.constants.units[line.unit])
          throw new Error(`Unknown unit: ${line.unit}`);
      }
    }
  }
  const batches = rows(value.batches, 'Batches');
  const byId = new Map(batches.map((b) => [b.id, b]));
  const recipeIds = new Set([...baseIds, ...products.map((p) => p.id)]);
  for (const b of batches) {
    if (
      ![
        'planned',
        'prepped',
        'poured',
        'unmolded',
        'cut',
        'curing',
        'cured',
        'shredded',
        'in_inventory',
      ].includes(String(b.status))
    )
      throw new Error(`Unknown batch status: ${b.status}`);
    if (
      ![b.recipe_id, b.base_recipe_id, b.product_recipe_id].some((id) =>
        recipeIds.has(id),
      )
    )
      throw new Error(`Unknown recipe for ${b.id}`);
    if (b.date !== undefined) date(b.date);
    if (b.base_recipe_id != null && !baseIds.has(b.base_recipe_id))
      throw new Error(`Unknown base recipe for ${b.id}`);
    if (
      b.product_recipe_id != null &&
      !products.some((p) => p.id === b.product_recipe_id)
    )
      throw new Error(`Unknown product recipe for ${b.id}`);
    if (b.recipe_id != null && !recipeIds.has(b.recipe_id))
      throw new Error(`Unknown recipe for ${b.id}`);
    if (
      b.product_recipe_id &&
      b.base_recipe_id &&
      !products.some(
        (p) =>
          p.id === b.product_recipe_id && p.base_recipe_id === b.base_recipe_id,
      )
    )
      throw new Error('Batch recipe references disagree.');
    for (const key of [
      'prepped_at',
      'poured_at',
      'unmolded_at',
      'cut_at',
      'cure_started_at',
      'cure_completed_at',
      'posted_to_inventory_at',
      'inventory_deducted_at',
    ])
      if (b[key] != null) date(b[key], key);
    for (const key of [
      'oil_weight_g',
      'total_mass_g',
      'total_cost',
      'cost_per_bar',
      'bars_expected',
      'bars_actual',
    ])
      if (b[key] != null) finite(b[key], `${b.id}.${key}`);
    for (const key of ['bars_expected', 'bars_actual'])
      if (b[key] !== undefined && !Number.isInteger(b[key]))
        throw new Error('Bar counts must be integers.');
    if (b['formulation'] !== undefined) validateCalculation(b['formulation']);
    if (b['weighing'] !== undefined) {
      const weighing = b['weighing'];
      if (
        !object(weighing) ||
        weighing['resolution_g'] !== 1 ||
        !object(weighing['suggested_g']) ||
        !object(weighing['actual_g']) ||
        !object(b['formulation']) ||
        !object(b['production'])
      )
        throw new Error('Invalid batch weighing record.');
      const calc = b['formulation'] as unknown as BatchCalculation;
      const expected = wholeGramTargets(calc);
      const suggested = weighing['suggested_g'];
      const actual = weighing['actual_g'];
      if (
        Object.keys(suggested).length !== Object.keys(expected).length ||
        Object.entries(expected).some(([m, n]) => suggested[m] !== n)
      )
        throw new Error(
          'Suggested whole-gram weights disagree with the formulation.',
        );
      for (const [m, n] of Object.entries(actual)) {
        finite(n, `Actual ${m}`);
        if (!Number.isSafeInteger(n))
          throw new Error('Actual amounts must be whole grams.');
        if (!(m in expected)) throw new Error('Unknown weighed ingredient.');
        if (
          !object(b['material_usage_g']) ||
          b['material_usage_g'][m] !== n ||
          !object(b['consumption_costs']) ||
          !(m in b['consumption_costs'])
        )
          throw new Error(
            'Actual weights disagree with consumed materials and cost basis.',
          );
      }
      const complete = Object.keys(expected).every((m) => m in actual);
      const usage = b['material_usage_g'];
      const costs = b['consumption_costs'];
      if (
        !object(usage) ||
        Object.keys(usage).length !== Object.keys(expected).length ||
        Object.keys(expected).some(
          (m) => usage[m] !== (actual[m] ?? expected[m]),
        )
      )
        throw new Error(
          'Weighing usage disagrees with the recipe targets and actual amounts.',
        );
      if (
        costs !== undefined &&
        (!object(costs) ||
          Object.keys(costs).length !== Object.keys(actual).length ||
          Object.keys(costs).some((m) => !(m in actual)))
      )
        throw new Error(
          'Frozen costs disagree with actual weighed ingredients.',
        );
      if (Boolean(b['inventory_deducted']) !== complete)
        throw new Error(
          'Weighing completion disagrees with inventory consumption.',
        );
      const log = b['production'];
      const confirmed = new Set<string>();
      for (const step of ['oils_ready', 'lye_ready'])
        if (log[step])
          for (const m of weighingGroup(calc, step)) confirmed.add(m);
      if (object(log['additives']))
        for (const m of Object.keys(log['additives'])) confirmed.add(m);
      if (
        Object.keys(actual).some((m) => !confirmed.has(m)) ||
        [...confirmed].some((m) => !(m in actual))
      )
        throw new Error(
          'Weighed ingredients disagree with confirmation timestamps.',
        );
    }
    if (b['production'] !== undefined) {
      validateProductionLog(
        b['production'],
        object(b['weighing']) && object(b['weighing']['actual_g'])
          ? Object.entries(b['weighing']['actual_g'])
              .filter(([, g]) => g === 0)
              .map(([m]) => m)
          : [],
      );
      if (!object(b['formulation']))
        throw new Error('Production requires a formulation snapshot.');
      const calc = b['formulation'] as unknown as BatchCalculation;
      const allowed = productionAdditives(calc);
      const log = b['production'];
      if (!calc.molds?.length)
        throw new Error('Timed production requires mold allocations.');
      if (
        calc.molds.some(
          (m) => !(m.barSize in (value.bar_sizes as Record<string, unknown>)),
        )
      )
        throw new Error('Unknown mold bar size.');
      if (
        b.status === 'planned' &&
        (Object.keys(log).length > 1 || Object.keys(log.additives).length)
      )
        throw new Error('Unprepared batch contains production timestamps.');
      if (
        b.status !== 'planned' &&
        !(b.status === 'prepped' && b['weighing']) &&
        b['inventory_deducted'] !== true
      )
        throw new Error('Production requires recorded ingredient consumption.');
      if (
        Object.values(log.additives).some(
          (at) =>
            calendarDate(
              at,
              typeof value['timeZone'] === 'string'
                ? value['timeZone']
                : undefined,
            ) < String(b['prepped_at'] || b.date || ''),
        )
      )
        throw new Error('Additive timestamp precedes preparation.');
      if (Object.keys(log.additives).some((m) => !allowed.includes(m)))
        throw new Error('Unknown production additive.');
      if (log.pour_finished && allowed.some((m) => !log.additives[m]))
        throw new Error('Completed pour is missing additive timestamps.');
      if (
        !['planned', 'prepped'].includes(String(b.status)) &&
        !b['production'].pour_finished
      )
        throw new Error('Poured batch requires production timestamps.');
    }
    for (const key of [
      'material_usage_g',
      'extra_material_usage_g',
      'consumption_costs',
      'cost_per_bar_by_size',
    ])
      if (b[key] !== undefined) numericMap(b[key], key);
    if (b.events !== undefined) {
      if (!Array.isArray(b.events)) throw new Error('Invalid events.');
      for (const e of b.events) {
        if (!object(e)) throw new Error('Invalid event.');
        text(e.type, 'Event type');
        date(e.at);
      }
    }
    if (b.yield_actual != null) {
      if (!object(b.yield_actual)) throw new Error('Invalid yield.');
      numericMap(b.yield_actual.size_counts, 'Yield');
      if (b.yield_actual['weight_g_by_size'] !== undefined)
        validateYieldWeights(
          b.yield_actual.size_counts as Record<string, number>,
          b.yield_actual['weight_g_by_size'],
        );
      for (const size of Object.keys(
        b.yield_actual.size_counts as Record<string, number>,
      ))
        if (!(size in value.bar_sizes))
          throw new Error(`Unknown yield bar size: ${size}`);
      for (const key of ['scrap_g', 'shredded_g'])
        if (b.yield_actual[key] !== undefined) finite(b.yield_actual[key], key);
      if (b.yield_actual['recorded_at'] !== undefined)
        date(b.yield_actual['recorded_at']);
      for (const count of Object.values(
        b.yield_actual.size_counts as Record<string, number>,
      ))
        if (!Number.isInteger(count))
          throw new Error('Yield must contain integer counts.');
      if (b['formulation']) {
        const expected = estimatedTrim(
          b['formulation'] as unknown as BatchCalculation,
          b.yield_actual.size_counts as Record<string, number>,
        );
        for (const key of [
          'estimated_trim_in3',
          'estimated_trim_pct',
        ] as const) {
          if (
            b.yield_actual[key] !== undefined &&
            (!expected ||
              Math.abs(finite(b.yield_actual[key], key) - expected[key]) > 1e-6)
          )
            throw new Error(
              'Yield trim estimate disagrees with the recorded counts.',
            );
        }
      }
    }
    const readings = b['cure_weigh_ins'];
    if (readings !== undefined) {
      if (
        !Array.isArray(readings) ||
        !object(b.yield_actual) ||
        !object(b.yield_actual.size_counts)
      )
        throw new Error('Cure weights require recorded cut yield.');
      const cutAt = date(
        b['cut_at'] || b.yield_actual['recorded_at'],
        'Cut date',
      );
      if (
        readings.length &&
        !['curing', 'cured', 'in_inventory', 'shredded'].includes(
          String(b.status),
        )
      )
        throw new Error(
          'Cure weights do not belong to the recorded batch stage.',
        );
      let previousAt = '';
      for (const reading of readings) {
        if (!object(reading)) throw new Error('Invalid cure weigh-in.');
        const at = date(reading.at, 'Weigh-in date');
        if (at < cutAt || at <= previousAt)
          throw new Error(
            'Cure weigh-ins must have distinct dates in chronological order after cutting.',
          );
        previousAt = at;
        numericMap(reading.size_counts, 'Weigh-in counts');
        validateCureWeights(
          b.yield_actual.size_counts as Record<string, number>,
          reading.size_counts as Record<string, number>,
          reading['weight_g_by_size'],
        );
      }
    }
    const visited = new Set<unknown>([b.id]);
    let parent = b.parent_batch_id;
    while (parent != null) {
      if (visited.has(parent)) throw new Error('Batch lineage cycle.');
      visited.add(parent);
      const record = byId.get(parent);
      if (!record) throw new Error('Missing parent batch.');
      parent = record.parent_batch_id;
    }
    const children = batches.filter((c) => c.parent_batch_id === b.id);
    if (
      children.length &&
      children.reduce((a, c) => a + Number(c.oil_weight_g || 0), 0) >
        Number(b.oil_weight_g || 0) + 1e-6
    )
      throw new Error(`Excessive child allocation: ${b.id}`);
  }
  if (value.revision !== undefined) {
    finite(value.revision, 'Revision');
    if (!Number.isInteger(value.revision))
      throw new Error('Revision must be an integer.');
  }
  if (value.integrity !== undefined) {
    if (
      !object(value.integrity) ||
      !object(value.integrity.appliedReceipts) ||
      !object(value.integrity.finishedPosts) ||
      !Array.isArray(value.integrity.reviewIssues) ||
      !Array.isArray(value.integrity.audit)
    )
      throw new Error('Invalid integrity metadata.');
    for (const map of [
      value.integrity.appliedReceipts,
      value.integrity.finishedPosts,
    ])
      for (const fingerprint of Object.values(map))
        text(fingerprint, 'Application fingerprint');
    if (
      value.integrity.reviewIssues.some(
        (issue: unknown) => typeof issue !== 'string',
      )
    )
      throw new Error('Invalid review issues.');
  }
}

function validateCalculation(value: unknown) {
  if (
    !object(value) ||
    !object(value['inputs']) ||
    !object(value['fragrance']) ||
    !object(value['costing'])
  )
    throw new Error('Invalid formulation snapshot.');
  text(value['recipe_id'], 'Snapshot recipe');
  text(value['inputs']['recipeId'], 'Snapshot input recipe');
  finite(
    value['inputs']['volumeIn3'],
    'Snapshot mold volume',
    Number.MIN_VALUE,
  );
  finite(value['total_oils_g'], 'Snapshot oil weight', Number.MIN_VALUE);
  finite(value['total_mass_g'], 'Snapshot mass', Number.MIN_VALUE);
  numericMap(value['materials_required_g'], 'Snapshot materials');
  finite(value['fragrance']['amount_g'], 'Snapshot fragrance');
  numericMap(value['costing']['material_costs'], 'Snapshot costs');
  finite(value['costing']['total_material_cost'], 'Snapshot cost');
  if (!Array.isArray(value['costing']['missing_material_costs']))
    throw new Error('Invalid snapshot missing costs.');
  if (value['molds'] !== undefined) {
    const molds = rows(value['molds'], 'Molds');
    if (!molds.length) throw new Error('At least one mold is required.');
    for (const m of molds) {
      text(m['label'], 'Mold label');
      text(m['barSize'], 'Mold bar size');
      finite(m['volumeIn3'], 'Mold volume', Number.MIN_VALUE);
      finite(m['bar_volume_in3'], 'Mold bar volume', Number.MIN_VALUE);
      const expected = Math.floor(
        (Number(m['volumeIn3']) + 1e-8) / Number(m['bar_volume_in3']),
      );
      if (m['bars_expected'] !== expected)
        throw new Error('Invalid mold expected yield.');
    }
    if (
      Math.abs(
        molds.reduce((n, m) => n + Number(m['volumeIn3']), 0) -
          Number(value['volume_in3']),
      ) > 0.011
    )
      throw new Error('Snapshot mold volume disagrees with batch volume.');
  }
}

export function migrateWorkspace(value: unknown): Workspace {
  validateWorkspace(value);
  const original = structuredClone(value);
  if (Number(value.version) === 2) return original;
  return {
    ...original,
    version: 2,
    revision: original.revision || 0,
    integrity: {
      appliedReceipts: {},
      finishedPosts: {},
      reviewIssues: [
        'Historical balances require reviewed reconstruction before applying historical records.',
      ],
      audit: [],
    },
    batches: original.batches?.map((b) => ({
      ...b,
      reconciliation_required: b.status !== 'planned',
    })),
  };
}
