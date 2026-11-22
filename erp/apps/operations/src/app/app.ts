import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { WorkspaceService } from './workspace.service';

@Component({
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  selector: 'rms-root',
  templateUrl: './app.html',
})
export class App {
  readonly workspace = inject(WorkspaceService);
  readonly navItems = [
    {
      path: '/production',
      label: 'Production',
      title: 'Batches and production',
    },
    { path: '/recipes', label: 'Recipes', title: 'Recipe library and design' },
    {
      path: '/inventory',
      label: 'Inventory',
      title: 'Materials and finished goods',
    },
    {
      path: '/finances',
      label: 'Finances',
      title: 'Purchases, assets, and costs',
    },
    {
      path: '/settings',
      label: 'Settings & Data',
      title: 'Backups and data review',
    },
  ];

  constructor() {
    void this.workspace.initialize();
  }
}
