import {
  Component,
  computed,
  CUSTOM_ELEMENTS_SCHEMA,
  inject,
  signal,
} from '@angular/core';
import { nextEventLabel } from '@rmsc/domain-core';
import type { BatchStatus, DecoratedWorkspace } from '@rmsc/worker-protocol';
import { WorkspaceService } from '../workspace.service';
import './data-recovery.element';
import './production-workbench.element';
import type { WorkerCommandMap } from '@rmsc/worker-protocol';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'rms-flow-page',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <section aria-labelledby="flow-heading">
      <production-workbench
        [workspace]="workspace.workspace()"
        [execute]="workspace.execute"
        [initialRecipeId]="queryParams()?.get('recipe') || ''"
        (workspace-updated)="acceptProductionState($event)"
      ></production-workbench>
      <section class="panel full-width">
        <div class="panel-heading">
          <h2 id="flow-heading">Single-Mold Batches</h2>
          <span class="badge">Lifecycle</span>
        </div>
        <div class="production-list">
          @for (batch of batches(); track batch.id) {
            <article class="production-row">
              <div>
                <strong>{{ batch.id }}</strong>
                <span>{{
                  batch.product_recipe_id ||
                    batch.base_recipe_id ||
                    batch.recipe_id ||
                    ''
                }}</span>
                @if (batch.formulation?.bar_size; as size) {
                  <span
                    >{{
                      workspace.workspace()?.bar_sizes?.[size]?.display_name ||
                        size
                    }}
                    / {{ batch.volume_in3 }} in3 /
                    {{ batch.bars_expected }} expected bars</span
                  >
                }
              </div>
              <span class="badge">{{ batch.status }}</span>
              <button
                class="secondary"
                (click)="productionAction('cost', batch.id)"
              >
                Cost
              </button>
              <button
                class="secondary"
                (click)="productionAction('cut', batch.id)"
                [disabled]="
                  batch.status !== 'unmolded' && batch.status !== 'cut'
                "
              >
                Cut
              </button>
              <button
                class="secondary"
                (click)="productionAction('post', batch.id)"
                [disabled]="
                  batch.status !== 'cured' ||
                  !batch['costed'] ||
                  !!batch['reconciliation_required']
                "
              >
                Post
              </button>
              @if (nextLabel(batch.status); as label) {
                <button
                  class="primary"
                  (click)="productionAction('next', batch.id)"
                  [disabled]="!!batch['reconciliation_required']"
                >
                  {{ label }}
                </button>
              }
              @if (batch.yield_actual) {
                <batch-cure-weights
                  [workspace]="workspace.workspace()"
                  [batchId]="batch.id"
                  [execute]="workspace.execute"
                  (workspace-updated)="acceptProductionState($event)"
                ></batch-cure-weights>
              }
            </article>
          } @empty {
            <div class="result-empty">No production batches yet.</div>
          }
        </div>
        @if (editingYield(); as batchId) {
          <production-yield-form
            [workspace]="workspace.workspace()"
            [batchId]="batchId"
            (yield-confirmed)="recordYield($event)"
            (yield-cancelled)="editingYield.set(null)"
          ></production-yield-form>
        }
      </section>
    </section>
  `,
})
export class FlowPage {
  readonly queryParams = toSignal(inject(ActivatedRoute).queryParamMap);
  readonly workspace = inject(WorkspaceService);
  readonly editingYield = signal<string | null>(null);
  readonly batches = computed(() =>
    [...(this.workspace.workspace()?.batches || [])]
      .filter((b) => !b.production)
      .reverse(),
  );

  acceptProductionState(event: Event) {
    this.workspace.acceptState(
      (event as CustomEvent<DecoratedWorkspace>).detail,
    );
  }

  nextLabel(status: BatchStatus) {
    return nextEventLabel(status);
  }

  productionAction(action: 'cost' | 'cut' | 'post' | 'next', batchId: string) {
    if (
      action === 'cut' ||
      (action === 'next' &&
        this.workspace.workspace()?.batches?.find((b) => b.id === batchId)
          ?.status === 'unmolded')
    ) {
      this.editingYield.set(batchId);
      return;
    }
    void this.workspace.handleProductionAction(action, batchId);
  }
  async recordYield(event: Event) {
    try {
      await this.workspace.recordYield(
        (event as CustomEvent<WorkerCommandMap['recordCutYield']['payload']>)
          .detail,
      );
      this.editingYield.set(null);
    } catch {
      /* Keep entered values for correction. */
    }
  }
}
