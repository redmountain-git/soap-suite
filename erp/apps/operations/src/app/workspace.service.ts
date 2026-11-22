import { computed, effect, inject, Injectable, signal } from '@angular/core';
import type {
  AssetInput,
  BatchCalculationInput,
  CapacityAudit,
  DecoratedWorkspace,
  ReceiptInput,
  WorkerCommandMap,
  WorkerCommandName,
  WorkerRequest,
  Workspace,
} from '@rmsc/worker-protocol';
import { activeBarSizes, errorMessage, recipeOptions } from './ui-format';
import { isWorkspaceMutation } from '@rmsc/worker-protocol';
import {
  WORKSPACE_DATA_PROVIDER,
  UnconfirmedCommand,
} from './workspace-provider';

type EmptyWorkerCommand = 'seedWorkspace' | 'getWorkspace' | 'exportBackup';
type PayloadWorkerCommand = Exclude<WorkerCommandName, EmptyWorkerCommand>;

@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  readonly provider = inject(WORKSPACE_DATA_PROVIDER);
  readonly retryRequest = signal<WorkerRequest<WorkerCommandName> | null>(null);
  private saving = false;
  readonly state = signal<DecoratedWorkspace | null>(null);
  readonly currentCalculation = signal<
    WorkerCommandMap['calculateBatch']['result'] | null
  >(null);
  readonly statusMessage = signal('Starting local workspace...');
  readonly statusIsError = signal(false);
  readonly backupPreview = signal('');
  readonly selectedRecipeId = signal('');
  readonly selectedBarSize = signal('');
  readonly volumeIn3 = signal(57.62);
  readonly fragrancePct = signal(4);

  readonly workspace = computed(() => this.state()?.workspace ?? null);
  readonly reports = computed(() => this.state()?.reports ?? null);

  private bootstrapped = false;
  private nextId = 1;
  private readonly clientId = crypto.randomUUID();
  private calculationGeneration = 0;
  private readonly channel =
    typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(this.provider.channelName);
  constructor() {
    effect(() => {
      this.selectedRecipeId();
      this.selectedBarSize();
      this.volumeIn3();
      this.fragrancePct();
      this.state()?.workspace.revision;
      this.currentCalculation.set(null);
    });
    if (this.channel)
      this.channel.onmessage = (
        event: MessageEvent<{ clientId?: string; revision: number }>,
      ) => {
        if (
          event.data.clientId !== this.clientId &&
          event.data.revision > Number(this.workspace()?.revision || 0)
        )
          void this.refresh('getWorkspace');
      };
  }

  async initialize() {
    if (this.bootstrapped) {
      return;
    }
    this.bootstrapped = true;
    await this.refresh('seedWorkspace');
  }

  async refresh(commandName: 'seedWorkspace' | 'getWorkspace') {
    try {
      const result = await this.command(commandName);
      this.applyState(result, this.provider.label + ' ready.');
      await this.calculate();
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  }

  async calculate(input: Partial<BatchCalculationInput> = {}) {
    const generation = ++this.calculationGeneration;
    const revision = this.workspace()?.revision;
    this.currentCalculation.set(null);
    try {
      const payload: BatchCalculationInput = {
        recipeId: input.recipeId ?? this.selectedRecipeId(),
        volumeIn3: Number(input.volumeIn3 ?? this.volumeIn3()),
        barSize: input.barSize ?? this.selectedBarSize(),
        fragrancePct: Number(input.fragrancePct ?? this.fragrancePct()),
      };
      const key = JSON.stringify(this.batchInput());
      const result = await this.command('calculateBatch', payload);
      if (
        generation !== this.calculationGeneration ||
        revision !== this.workspace()?.revision ||
        key !== JSON.stringify(this.batchInput())
      )
        return;
      this.currentCalculation.set(result);
      this.setStatus('Batch calculated.');
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  }

  async savePlan() {
    try {
      this.applyState(
        await this.command('savePlannedBatch', { input: this.batchInput() }),
        'Planned batch saved.',
      );
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  }

  async runAudit() {
    try {
      const audit = await this.command('runCapacityAudit', this.batchInput());
      const shortageNames = Object.keys((audit as CapacityAudit).shortages);
      this.setStatus(
        shortageNames.length
          ? `Short on ${shortageNames.join(', ')}.`
          : 'Inventory covers the selected batch.',
        shortageNames.length > 0,
      );
      this.backupPreview.set(JSON.stringify(audit, null, 2));
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  }

  async recordReceipt(payload: ReceiptInput) {
    try {
      this.applyState(
        await this.command('recordReceipt', payload),
        'Receipt applied to inventory.',
      );
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  }

  async recordAsset(payload: AssetInput) {
    try {
      this.applyState(
        await this.command('recordAsset', payload),
        'Asset recorded.',
      );
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  }

  async handleProductionAction(
    action: 'cost' | 'cut' | 'post' | 'next',
    batchId: string,
  ) {
    try {
      let result: DecoratedWorkspace | null = null;
      if (action === 'next') {
        result = await this.command('recordNextBatchEvent', { batchId });
      } else if (action === 'cost') {
        result = await this.command('runCosting', { batchId });
      } else if (action === 'cut') {
        throw new Error('Enter actual cut yield before continuing.');
      } else {
        result = await this.command('postFinishedGoods', { batchId });
      }

      if (result) {
        this.applyState(result, 'Production updated.');
      }
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  }

  async exportBackup() {
    try {
      const raw = await this.command('exportBackup');
      const blob = new Blob([raw], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `red-mountain-soap-operations-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      this.backupPreview.set(raw);
      this.setStatus('Backup exported.');
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  }

  async importBackup(raw: string) {
    try {
      this.applyState(await this.confirmImport(raw), 'Backup imported.');
      this.backupPreview.set(raw);
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  }

  async resetDemo() {
    if (
      !window.confirm(
        'Replace this workspace with demo data? A recovery snapshot will be retained.',
      )
    )
      return;
    try {
      this.currentCalculation.set(null);
      const result = await this.command('resetDemo', { confirmed: true });
      this.applyState(result, 'Demo workspace reset.');
      await this.calculate();
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  }

  setStatus(message: string, isError = false) {
    this.statusMessage.set(message);
    this.statusIsError.set(isError);
  }

  private batchInput(): BatchCalculationInput {
    return {
      recipeId: this.selectedRecipeId(),
      volumeIn3: Number(this.volumeIn3()),
      barSize: this.selectedBarSize(),
      fragrancePct: Number(this.fragrancePct()),
    };
  }

  private applyState(result: DecoratedWorkspace, message: string) {
    if (
      Number(result.workspace.revision || 0) <
      Number(this.workspace()?.revision || 0)
    )
      return;
    this.currentCalculation.set(null);
    this.state.set(result);
    this.syncSelections(result.workspace);
    this.backupPreview.set(
      JSON.stringify(
        {
          workspace: result.workspace,
          reports: result.reports,
        },
        null,
        2,
      ),
    );
    this.setStatus(message);
  }

  private syncSelections(workspace: Workspace) {
    const recipes = recipeOptions(workspace);
    if (!recipes.some((recipe) => recipe.id === this.selectedRecipeId())) {
      this.selectedRecipeId.set(recipes[0]?.id || '');
    }

    const sizes = activeBarSizes(workspace);
    const sizeIds = new Set(sizes.map(([id]) => id));
    if (!sizeIds.has(this.selectedBarSize())) {
      this.selectedBarSize.set(
        sizeIds.has('bar_5_2_oz') ? 'bar_5_2_oz' : sizes[0]?.[0] || '',
      );
    }
  }

  private command<K extends EmptyWorkerCommand>(
    command: K,
  ): Promise<WorkerCommandMap[K]['result']>;
  private command<K extends PayloadWorkerCommand>(
    command: K,
    payload: WorkerCommandMap[K]['payload'],
  ): Promise<WorkerCommandMap[K]['result']>;
  private command<K extends WorkerCommandName>(
    command: K,
    payload?: WorkerCommandMap[K]['payload'],
  ): Promise<WorkerCommandMap[K]['result']> {
    const request: WorkerRequest<K> = {
      id: this.nextId++,
      command,
      payload: payload ?? ({} as WorkerCommandMap[K]['payload']),
      clientId: this.clientId,
      mutationId: crypto.randomUUID(),
    };
    if (!isWorkspaceMutation(command)) return this.provider.send(request);
    if (this.retryRequest())
      throw new Error(
        'Resolve the unconfirmed save before making another change.',
      );
    return this.saveRequest(request);
  }

  private async saveRequest<K extends WorkerCommandName>(
    request: WorkerRequest<K>,
  ) {
    if (this.saving) throw new Error('A save is already in progress.');
    this.saving = true;
    try {
      const result = await this.provider.send(request);
      this.retryRequest.set(null);
      return result;
    } catch (error) {
      this.retryRequest.set(
        error instanceof UnconfirmedCommand ? request : null,
      );
      throw error;
    } finally {
      this.saving = false;
    }
  }

  async retrySave() {
    const request = this.retryRequest();
    if (!request) return;
    try {
      await this.saveRequest(request);
      await this.refresh('getWorkspace');
      if (!this.statusIsError()) this.setStatus('Save confirmed.');
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    }
  }

  async recordYield(payload: WorkerCommandMap['recordCutYield']['payload']) {
    try {
      this.applyState(
        await this.command('recordCutYield', payload),
        'Cut yield recorded.',
      );
    } catch (error) {
      this.setStatus(errorMessage(error), true);
      throw error;
    }
  }
  readonly execute = <K extends WorkerCommandName>(
    name: K,
    payload: WorkerCommandMap[K]['payload'],
  ) =>
    this.command(name as PayloadWorkerCommand, payload as never) as Promise<
      WorkerCommandMap[K]['result']
    >;
  acceptState(result: DecoratedWorkspace) {
    this.applyState(result, 'Workspace updated.');
  }
  private async confirmImport(raw: string) {
    const preview = await this.command('previewImport', { raw });
    if (
      !window.confirm(
        `Replace workspace after reviewing ${preview.differences.length} inventory balances? A recovery snapshot will be retained.`,
      )
    )
      throw new Error('Import cancelled.');
    return this.command('commitImport', { token: preview.token });
  }
}
