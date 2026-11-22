import type {
  BatchCalculation,
  CapacityAudit,
  TransitionContext,
  WorkerCommandMap,
  Workspace,
} from '@rmsc/worker-protocol';
import {
  applyReceiptToInventory,
  calculateBatch,
  exportWorkspace,
  importWorkspace,
  postFinishedGoods,
  recordAsset,
  recordBatchEvent,
  recordCutYield,
  recordCureWeighIn,
  recordNextBatchEvent,
  recordReceipt,
  recordProductionStep,
  enableBatchWeighing,
  correctAdditiveTimestamp,
  correctAdditiveOmission,
  correctPourEndTimestamp,
  addBaseRecipe,
  runCapacityAudit,
  runCosting,
  savePlannedBatch,
} from './domain';

export interface DomainTransitionMap {
  readonly addBaseRecipe: {
    readonly payload: WorkerCommandMap['addBaseRecipe']['payload'];
    readonly result: Workspace;
  };
  readonly correctPourEndTimestamp: {
    readonly payload: WorkerCommandMap['correctPourEndTimestamp']['payload'];
    readonly result: Workspace;
  };
  readonly correctAdditiveTimestamp: {
    readonly payload: WorkerCommandMap['correctAdditiveTimestamp']['payload'];
    readonly result: Workspace;
  };
  readonly correctAdditiveOmission: {
    readonly payload: WorkerCommandMap['correctAdditiveOmission']['payload'];
    readonly result: Workspace;
  };
  readonly enableBatchWeighing: {
    readonly payload: WorkerCommandMap['enableBatchWeighing']['payload'];
    readonly result: Workspace;
  };
  readonly recordProductionStep: {
    readonly payload: WorkerCommandMap['recordProductionStep']['payload'];
    readonly result: Workspace;
  };
  readonly calculateBatch: {
    readonly payload: WorkerCommandMap['calculateBatch']['payload'];
    readonly result: BatchCalculation;
  };
  readonly savePlannedBatch: {
    readonly payload: WorkerCommandMap['savePlannedBatch']['payload'];
    readonly result: Workspace;
  };
  readonly recordReceipt: {
    readonly payload: WorkerCommandMap['recordReceipt']['payload'];
    readonly result: Workspace;
  };
  readonly applyReceiptToInventory: {
    readonly payload: WorkerCommandMap['applyReceiptToInventory']['payload'];
    readonly result: Workspace;
  };
  readonly recordAsset: {
    readonly payload: WorkerCommandMap['recordAsset']['payload'];
    readonly result: Workspace;
  };
  readonly recordBatchEvent: {
    readonly payload: WorkerCommandMap['recordBatchEvent']['payload'];
    readonly result: Workspace;
  };
  readonly recordNextBatchEvent: {
    readonly payload: WorkerCommandMap['recordNextBatchEvent']['payload'];
    readonly result: Workspace;
  };
  readonly recordCutYield: {
    readonly payload: WorkerCommandMap['recordCutYield']['payload'];
    readonly result: Workspace;
  };
  readonly recordCureWeighIn: {
    readonly payload: WorkerCommandMap['recordCureWeighIn']['payload'];
    readonly result: Workspace;
  };
  readonly postFinishedGoods: {
    readonly payload: WorkerCommandMap['postFinishedGoods']['payload'];
    readonly result: Workspace;
  };
  readonly runCosting: {
    readonly payload: WorkerCommandMap['runCosting']['payload'];
    readonly result: Workspace;
  };
  readonly runCapacityAudit: {
    readonly payload: WorkerCommandMap['runCapacityAudit']['payload'];
    readonly result: CapacityAudit;
  };
  readonly exportBackup: {
    readonly payload: WorkerCommandMap['exportBackup']['payload'];
    readonly result: string;
  };
  readonly importBackup: {
    readonly payload: WorkerCommandMap['importBackup']['payload'];
    readonly result: Workspace;
  };
}

export type DomainCommandName = keyof DomainTransitionMap;
export type DomainCommand = {
  readonly [K in DomainCommandName]: {
    readonly name: K;
    readonly payload: DomainTransitionMap[K]['payload'];
  };
}[DomainCommandName];

export function transition<K extends DomainCommandName>(
  workspace: Workspace,
  command: Extract<DomainCommand, { readonly name: K }>,
  context: TransitionContext,
): DomainTransitionMap[K]['result'];
export function transition(
  workspace: Workspace,
  command: DomainCommand,
  context: TransitionContext,
): DomainTransitionMap[DomainCommandName]['result'] {
  switch (command.name) {
    case 'addBaseRecipe':
      return addBaseRecipe(workspace, command.payload.raw, context.nowIso);
    case 'correctPourEndTimestamp':
      return correctPourEndTimestamp(
        workspace,
        command.payload,
        context.nowIso,
      );
    case 'correctAdditiveTimestamp':
      return correctAdditiveTimestamp(
        workspace,
        command.payload,
        context.nowIso,
      );
    case 'correctAdditiveOmission':
      return correctAdditiveOmission(
        workspace,
        command.payload,
        context.nowIso,
      );
    case 'enableBatchWeighing':
      return enableBatchWeighing(workspace, command.payload.batchId);
    case 'recordProductionStep':
      return recordProductionStep(workspace, command.payload, context.nowIso);
    case 'calculateBatch':
      return calculateBatch(workspace, command.payload);
    case 'savePlannedBatch': {
      if (!command.payload.input && !command.payload.calculation?.inputs)
        throw new Error('Current calculation inputs are required.');
      const replacing = command.payload.replaceBatchIds || [];
      if (new Set(replacing).size !== replacing.length)
        throw new Error('Duplicate replacement batch.');
      if (
        replacing.length &&
        command.payload.expectedRevision !== Number(workspace.revision || 0)
      )
        throw new Error('Workspace changed. Review the batch plans again.');
      for (const id of replacing) {
        const batch = workspace.batches?.find((b) => b.id === id);
        if (
          !batch ||
          batch.status !== 'planned' ||
          batch.inventory_deducted ||
          batch.events?.length ||
          Object.keys(batch.production?.additives || {}).length ||
          workspace.batches?.some((b) => b.parent_batch_id === id)
        )
          throw new Error('Only unstarted, unallocated plans can be replaced.');
      }
      const calculation = calculateBatch(
        workspace,
        (command.payload.input || command.payload.calculation!.inputs)!,
      );
      const candidate = replacing.length
        ? {
            ...workspace,
            batches: workspace.batches?.filter(
              (b) => !replacing.includes(b.id),
            ),
            integrity: {
              appliedReceipts: {},
              finishedPosts: {},
              reviewIssues: [],
              ...workspace.integrity,
              audit: [
                ...(workspace.integrity?.audit || []),
                {
                  at: context.nowIso,
                  action: `Replaced unstarted batch plans: ${replacing.join(', ')}`,
                },
              ],
            },
          }
        : workspace;
      return savePlannedBatch(
        candidate,
        calculation,
        context.today,
        context.nextId('B-LOCAL'),
      );
    }
    case 'recordReceipt':
      return recordReceipt(
        workspace,
        command.payload,
        context.today,
        context.nextId('R-LOCAL'),
      );
    case 'applyReceiptToInventory':
      return applyReceiptToInventory(workspace, command.payload.receipt);
    case 'recordAsset':
      return recordAsset(
        workspace,
        command.payload,
        context.today,
        context.nextId('A-LOCAL'),
      );
    case 'recordBatchEvent':
      return recordBatchEvent(workspace, command.payload, context.today);
    case 'recordNextBatchEvent':
      return recordNextBatchEvent(
        workspace,
        command.payload.batchId,
        context.today,
      );
    case 'recordCutYield':
      return recordCutYield(workspace, command.payload, context.today);
    case 'recordCureWeighIn':
      return recordCureWeighIn(workspace, command.payload, context.today);
    case 'postFinishedGoods':
      return postFinishedGoods(workspace, command.payload, context.today);
    case 'runCosting':
      return runCosting(workspace, command.payload);
    case 'runCapacityAudit':
      return runCapacityAudit(workspace, command.payload);
    case 'exportBackup':
      return exportWorkspace(workspace, context.nowIso);
    case 'importBackup':
      return importWorkspace(command.payload.raw);
  }
}
