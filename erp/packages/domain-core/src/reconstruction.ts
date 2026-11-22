import type {
  Batch,
  Inventory,
  ReconstructionInput,
  Workspace,
} from '@rmsc/worker-protocol';
import {
  applyReceiptToInventory,
  importWorkspace,
  materialQuantityGrams,
  postFinishedGoods,
  recordBatchEvent,
  runCosting,
} from './domain';
import { date, finite, validateWorkspace } from './validation';

export function reconstructWorkspace(
  current: Workspace,
  input: ReconstructionInput,
  nowIso: string,
) {
  date(input.openingDate, 'Opening date');
  const source = input.sourceRaw
    ? importWorkspace(input.sourceRaw)
    : structuredClone(current);
  const issues: string[] = [];
  const warnings = [
    'Opening balances are before the first event on the opening date. Same-day order: receipts, adjustments, consumption, finished goods; then identifier.',
  ];
  let candidate: Workspace = {
    ...source,
    assets: structuredClone(current.assets || []),
    version: 2,
    inventory: structuredClone(input.openingInventory),
    integrity: {
      appliedReceipts: {},
      finishedPosts: {},
      reviewIssues: [],
      audit: source.integrity?.audit || [],
    },
    batches: source.batches?.map((b) => ({
      ...b,
      reconciliation_required: false,
      inventory_deducted: false,
      consumption_costs: undefined,
      consumption_fingerprint: undefined,
      costed: false,
    })),
  };
  validateWorkspace(candidate);
  for (const items of Object.values(candidate.inventory))
    for (const [material, record] of Object.entries(items || {}))
      if (
        Number(record.on_hand) > 0 &&
        record.avg_cost_per_unit == null &&
        record.cost_per_unit == null
      )
        issues.push(`Opening cost is missing for ${material}.`);
  type Effect = { date: string; rank: number; id: string; apply: () => void };
  const effects: Effect[] = [];
  for (const receipt of source.receipts || [])
    effects.push({
      date: receipt.date,
      rank: 0,
      id: receipt.id,
      apply() {
        candidate = applyReceiptToInventory(candidate, receipt);
      },
    });
  const adjustmentIds = new Set<string>();
  for (const adjustment of input.adjustments || []) {
    if (!adjustment.id || adjustmentIds.has(adjustment.id))
      throw new Error('Adjustment identifiers must be unique.');
    adjustmentIds.add(adjustment.id);
    effects.push({
      date: adjustment.date,
      rank: 1,
      id: adjustment.id,
      apply() {
        if (!adjustment.reason?.trim())
          throw new Error('Adjustment reason is required.');
        finite(adjustment.quantity, 'Adjustment quantity', -Infinity);
        finite(adjustment.amount_usd, 'Adjustment value', -Infinity);
        const inventory = structuredClone(candidate.inventory) as Record<
          string,
          Record<
            string,
            { unit: string; on_hand: number; avg_cost_per_unit: number }
          >
        >;
        const section =
          Object.keys(inventory).find(
            (key) => inventory[key]?.[adjustment.material],
          ) ||
          (['bar', 'each'].includes(adjustment.unit)
            ? 'finished_goods'
            : 'raw_materials');
        inventory[section] ||= {};
        const existing = inventory[section][adjustment.material] || {
          unit: adjustment.unit,
          on_hand: 0,
          avg_cost_per_unit: 0,
        };
        const delta = ['bar', 'each'].includes(existing.unit)
          ? adjustment.unit === existing.unit
            ? adjustment.quantity
            : NaN
          : (Math.sign(adjustment.quantity) *
              materialQuantityGrams(
                candidate,
                adjustment.material,
                Math.abs(adjustment.quantity),
                adjustment.unit,
              )) /
            materialQuantityGrams(
              candidate,
              adjustment.material,
              1,
              existing.unit,
            );
        const quantity = existing.on_hand + delta;
        const value =
          existing.on_hand * existing.avg_cost_per_unit + adjustment.amount_usd;
        finite(quantity, 'Adjusted balance');
        finite(value, 'Adjusted value');
        if (
          ['bar', 'each'].includes(existing.unit) &&
          !Number.isInteger(quantity)
        )
          throw new Error('Finished stock must have integer counts.');
        if (!quantity && Math.abs(value) > 0.000001)
          throw new Error('Zero stock cannot retain inventory value.');
        inventory[section][adjustment.material] = {
          ...existing,
          on_hand: quantity,
          avg_cost_per_unit: quantity ? value / quantity : 0,
        };
        candidate = { ...candidate, inventory: inventory as Inventory };
      },
    });
  }
  for (const original of source.batches || []) {
    const prepDate =
      original.inventory_deducted_at ||
      original.prepped_at ||
      original.events?.find((e) => e.type === 'prepped')?.at;
    const postDate =
      original.posted_to_inventory_at ||
      original.events?.find((e) => e.type === 'posted_to_inventory')?.at;
    if (original.status !== 'planned' && !prepDate)
      issues.push(`${original.id}: missing consumption date.`);
    if (original.status === 'in_inventory' && !postDate)
      issues.push(`${original.id}: missing finished-goods posting date.`);
    if (prepDate)
      effects.push({
        date: String(prepDate),
        rank: 2,
        id: original.id,
        apply() {
          const usage = original.parent_batch_id
            ? original.extra_material_usage_g
            : original.material_usage_g;
          if (!original.parent_batch_id && !Object.keys(usage || {}).length)
            throw new Error(
              'Confirmed historical material usage is missing; do not infer consumed quantities from a new formula.',
            );
          candidate = replaceBatch(candidate, original.id, (b) => ({
            ...b,
            status: 'planned',
            events: [],
            material_usage_g: original.material_usage_g,
            extra_material_usage_g: original.extra_material_usage_g,
          }));
          candidate = recordBatchEvent(
            candidate,
            {
              batchId: original.id,
              eventType: 'prepped',
              at: String(prepDate),
            },
            String(prepDate),
          );
          candidate = replaceBatch(candidate, original.id, (b) => ({
            ...b,
            status:
              original.status === 'in_inventory' ? 'cured' : original.status,
            events: original.events || b.events,
            prepped_at: String(prepDate),
          }));
        },
      });
    if (postDate)
      effects.push({
        date: String(postDate),
        rank: 3,
        id: original.id,
        apply() {
          const cured =
            original.cure_completed_at ||
            original.events?.find((e) => e.type === 'cure_completed')?.at;
          if (!cured) throw new Error('Confirmed cure date is missing.');
          candidate = replaceBatch(candidate, original.id, (b) => ({
            ...b,
            status: 'cured',
            cure_completed_at: cured,
          }));
          candidate = runCosting(candidate, { batchId: original.id });
          candidate = postFinishedGoods(
            candidate,
            { batchId: original.id, at: String(postDate) },
            String(postDate),
          );
        },
      });
  }
  const dates = new Map<string, number>();
  for (const effect of effects) {
    date(effect.date);
    dates.set(effect.date, (dates.get(effect.date) || 0) + 1);
  }
  for (const [day, count] of dates)
    if (count > 1)
      warnings.push(
        `${day}: ${count} events use the stated same-day ordering.`,
      );
  effects.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.rank - b.rank ||
      a.id.localeCompare(b.id),
  );
  for (const effect of effects) {
    if (effect.date < input.openingDate) {
      warnings.push(
        `${effect.id} predates opening balances and is not replayed.`,
      );
      continue;
    }
    const before = candidate;
    try {
      effect.apply();
      validateWorkspace(candidate);
    } catch (error) {
      candidate = before;
      issues.push(
        `${effect.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  candidate = {
    ...candidate,
    reconstruction: structuredClone(input),
    integrity: {
      ...candidate.integrity!,
      audit: [
        ...candidate.integrity!.audit,
        { at: nowIso, action: 'Reviewed historical reconstruction' },
      ],
    },
  };
  return { workspace: candidate, issues, warnings };
}

function replaceBatch(
  workspace: Workspace,
  id: string,
  apply: (batch: Batch) => Batch,
): Workspace {
  return {
    ...workspace,
    batches: workspace.batches?.map((b) => (b.id === id ? apply(b) : b)),
  };
}
