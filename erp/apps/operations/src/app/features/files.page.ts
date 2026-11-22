import { Component, CUSTOM_ELEMENTS_SCHEMA, inject } from '@angular/core';
import { WorkspaceService } from '../workspace.service';
import './data-recovery.element';
import type { DecoratedWorkspace } from '@rmsc/worker-protocol';

@Component({
  selector: 'rms-files-page',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <section aria-labelledby="backup-heading">
      <section class="panel full-width">
        <div class="panel-heading">
          <h2 id="backup-heading">Backup</h2>
          <span class="badge">JSON</span>
        </div>
        <div class="backup-grid">
          <button
            class="primary"
            title="Export JSON backup"
            (click)="exportBackup()"
          >
            Export
          </button>
          <button
            class="secondary"
            title="Reset demo workspace"
            (click)="resetDemo()"
          >
            Reset demo
          </button>
        </div>
        @if (workspace.backupPreview()) {
          <details>
            <summary>Backup preview</summary>
            <pre class="backup-preview">{{ workspace.backupPreview() }}</pre>
          </details>
        }
      </section>
      <workspace-data-review
        [workspace]="workspace.workspace()"
        [execute]="workspace.execute"
        (workspace-updated)="updated($event)"
      ></workspace-data-review>
    </section>
  `,
})
export class FilesPage {
  readonly workspace = inject(WorkspaceService);
  updated(event: Event) {
    this.workspace.acceptState(
      (event as CustomEvent<DecoratedWorkspace>).detail,
    );
  }

  exportBackup() {
    void this.workspace.exportBackup();
  }

  resetDemo() {
    void this.workspace.resetDemo();
  }

  async importBackup(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    await this.workspace.importBackup(await file.text());
    input.value = '';
  }
}
