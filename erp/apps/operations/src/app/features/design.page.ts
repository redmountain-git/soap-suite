import { Component, CUSTOM_ELEMENTS_SCHEMA, inject } from '@angular/core';
import { WorkspaceService } from '../workspace.service';
import './recipe-vector-workbench.element';

@Component({
  selector: 'rms-design-page',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <section aria-label="Recipe designer">
      <recipe-vector-workbench
        [workspace]="workspace.workspace()"
      ></recipe-vector-workbench>
    </section>
  `,
})
export class DesignPage {
  readonly workspace = inject(WorkspaceService);
}
