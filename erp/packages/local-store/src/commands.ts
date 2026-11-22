import {
  buildReports,
  calendarDate,
  createDemoWorkspace,
  importWorkspace,
  migrateWorkspace,
  reconstructWorkspace,
  transition,
  validateWorkspace,
} from '@rmsc/domain-core';
import type { DomainCommand } from '@rmsc/domain-core';
import { isWorkspaceMutation } from '@rmsc/worker-protocol';
import type {
  AnyWorkerRequest,
  DecoratedWorkspace,
  ReplacementPreview,
  RecoverySummary,
  Workspace,
} from '@rmsc/worker-protocol';

interface Snapshot extends RecoverySummary {
  workspace: Workspace;
}
interface Preview extends ReplacementPreview {
  workspace: Workspace;
}
interface Mutation {
  fingerprint: string;
  result: unknown;
}
export interface WorkspaceRecords {
  documents: Workspace;
  recovery: Snapshot;
  previews: Preview;
  mutations: Mutation;
}

export const workspaceStores = [
  'documents',
  'recovery',
  'previews',
  'mutations',
] as const;
export type WorkspaceStoreName = keyof WorkspaceRecords;

export interface WorkspaceTransaction {
  objectStore<K extends WorkspaceStoreName>(
    name: K,
  ): {
    get(key: string): Promise<WorkspaceRecords[K] | undefined>;
    getAll(): Promise<WorkspaceRecords[K][]>;
    put(value: WorkspaceRecords[K], key: string): Promise<unknown>;
    delete(key: string): Promise<unknown>;
  };
}
function decorate(workspace: Workspace): DecoratedWorkspace {
  return { workspace, reports: buildReports(workspace) };
}

export { isWorkspaceMutation } from '@rmsc/worker-protocol';

// The adapter owns the transaction and must not return a result until it commits.
export async function executeWorkspaceCommand(
  tx: WorkspaceTransaction,
  request: AnyWorkerRequest,
): Promise<{ result: unknown; revision?: number }> {
  let changed = false;
  const original = await tx.objectStore('documents').get('workspace');
  let workspace = original
    ? migrateWorkspace(original)
    : migrateWorkspace(createDemoWorkspace());
  const snapshot = async (reason: string) => {
    if (!original) return;
    const id = crypto.randomUUID();
    await tx
      .objectStore('recovery')
      .put(
        { id, at: new Date().toISOString(), reason, workspace: original },
        id,
      );
  };
  if (!original || Number(original.version) !== 2) {
    await snapshot('Before version-2 migration');
    await tx.objectStore('documents').put(workspace, 'workspace');
    changed = true;
  }
  const fingerprint = JSON.stringify({
    command: request.command,
    payload: request.payload,
  });
  const mutationId = isWorkspaceMutation(request.command)
    ? request.mutationId
    : undefined;
  if (mutationId) {
    const previous = await tx.objectStore('mutations').get(mutationId);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new Error('Mutation identifier reused with different contents.');
      return { result: previous.result };
    }
  }
  const revision = Number(workspace.revision || 0);
  const context = {
    today: calendarDate(
      new Date(),
      typeof workspace['timeZone'] === 'string'
        ? workspace['timeZone']
        : undefined,
    ),
    nowIso: new Date().toISOString(),
    nextId: (prefix: string) => `${prefix}-${crypto.randomUUID()}`,
  };
  let result: unknown;
  const preview = async (
    candidate: Workspace,
    kind: Preview['kind'],
    issues: string[] = [],
    warnings: string[] = [],
  ) => {
    const token = crypto.randomUUID();
    const before = stockValues(workspace);
    const after = stockValues(candidate);
    const differences = [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ]
      .sort()
      .map((material) => ({
        material,
        before: before[material]?.quantity || 0,
        after: after[material]?.quantity || 0,
        beforeValue: before[material]?.value || 0,
        afterValue: after[material]?.value || 0,
      }));
    const record: Preview = {
      summary: {
        before: recordCounts(workspace),
        after: recordCounts(candidate),
      },
      token,
      revision: revision + (changed ? 1 : 0),
      kind,
      issues,
      warnings,
      differences,
      workspace: candidate,
    };
    await tx.objectStore('previews').put(record, token);
    const { workspace: _candidate, ...summary } = record;
    return summary;
  };
  switch (request.command) {
    case 'seedWorkspace':
    case 'getWorkspace':
      result = decorate(workspace);
      break;
    case 'exportBackup':
      result = JSON.stringify(
        {
          app: 'red-mountain-soap-suite',
          exportedAt: context.nowIso,
          workspace,
        },
        null,
        2,
      );
      break;
    case 'listRecovery':
      result = (await tx.objectStore('recovery').getAll())
        .map(({ workspace: _w, ...summary }) => summary)
        .sort((a, b) => b.at.localeCompare(a.at));
      break;
    case 'previewImport':
      result = await preview(importWorkspace(request.payload.raw), 'import');
      break;
    case 'previewRecovery': {
      const recovery = await tx
        .objectStore('recovery')
        .get(request.payload.recoveryId);
      if (!recovery) throw new Error('Recovery snapshot not found.');
      result = await preview(migrateWorkspace(recovery.workspace), 'recovery');
      break;
    }
    case 'importBackup':
      throw new Error('Import requires preview and confirmation.');
    case 'previewReconstruction': {
      const proposal = reconstructWorkspace(
        workspace,
        request.payload,
        context.nowIso,
      );
      result = await preview(
        proposal.workspace,
        'reconstruction',
        proposal.issues,
        proposal.warnings,
      );
      break;
    }
    case 'commitImport':
    case 'commitReconstruction': {
      const proposal = await tx
        .objectStore('previews')
        .get(request.payload.token);
      if (!proposal) throw new Error('Preview expired or already committed.');
      if (proposal.revision !== revision)
        throw new Error(
          'Workspace changed after preview. Review a new preview.',
        );
      if (proposal.issues.length)
        throw new Error('Resolve reconstruction issues before committing.');
      if (
        (request.command === 'commitReconstruction') !==
        (proposal.kind === 'reconstruction')
      )
        throw new Error('Wrong confirmation operation.');
      validateWorkspace(proposal.workspace);
      buildReports(proposal.workspace);
      await snapshot(`Before ${proposal.kind}`);
      workspace = proposal.workspace;
      await tx.objectStore('previews').delete(proposal.token);
      changed = true;
      result = null;
      break;
    }
    case 'resetDemo':
      if (
        !('confirmed' in request.payload) ||
        request.payload.confirmed !== true
      )
        throw new Error('Reset requires confirmation.');
      await snapshot('Before demo reset');
      workspace = migrateWorkspace(createDemoWorkspace());
      changed = true;
      result = null;
      break;
    case 'calculateBatch':
    case 'runCapacityAudit':
      result = transition(
        workspace,
        { name: request.command, payload: request.payload } as DomainCommand,
        context,
      );
      break;
    default:
      if (request.command === 'addBaseRecipe')
        await snapshot('Before adding a base recipe');
      if (request.command === 'enableBatchWeighing')
        await snapshot('Before enabling actual batch weighing');
      if (request.command === 'correctAdditiveOmission')
        await snapshot('Before correcting additive consumption');
      if (
        request.command === 'savePlannedBatch' &&
        request.payload.replaceBatchIds?.length
      )
        await snapshot('Before replacing unstarted batch plans');
      workspace = transition(
        workspace,
        { name: request.command, payload: request.payload } as DomainCommand,
        context,
      ) as Workspace;
      changed = true;
      result = null;
  }
  if (changed) {
    workspace = {
      ...workspace,
      version: 2,
      revision: revision + 1,
      updatedAt: context.today,
    };
    validateWorkspace(workspace);
    buildReports(workspace);
    await tx.objectStore('documents').put(workspace, 'workspace');
    if (
      result === null ||
      request.command === 'seedWorkspace' ||
      request.command === 'getWorkspace'
    )
      result = decorate(workspace);
  }
  if (mutationId)
    await tx.objectStore('mutations').put({ fingerprint, result }, mutationId);
  return { result, revision: changed ? workspace.revision : undefined };
}
function stockValues(workspace: Workspace) {
  const records: Record<string, { quantity: number; value: number }> = {};
  for (const [section, items] of Object.entries(workspace.inventory))
    for (const [material, item] of Object.entries(items || {}))
      records[`${section}.${material} (${item.unit})`] = {
        quantity: Number(item.on_hand || 0),
        value:
          Number(item.on_hand || 0) *
          Number(item.avg_cost_per_unit ?? item.cost_per_unit ?? 0),
      };
  return records;
}
function recordCounts(workspace: Workspace) {
  return {
    recipes:
      (workspace.base_recipes?.length || 0) +
      (workspace.product_recipes?.length || 0),
    receipts: workspace.receipts?.length || 0,
    batches: workspace.batches?.length || 0,
    assets: workspace.assets?.length || 0,
  };
}
