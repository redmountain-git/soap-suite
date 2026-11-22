import type { Route } from '@angular/router';
import { DesignPage } from './features/design.page';
import { FilesPage } from './features/files.page';
import { PlanPage } from './features/plan.page';
import { StockPage } from './features/stock.page';
import { RecipesPage } from './features/recipes.page';

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'production' },
  { path: 'recipes', component: RecipesPage },
  { path: 'recipes/calculator', component: PlanPage },
  { path: 'recipes/design', component: DesignPage },
  { path: 'inventory', component: StockPage, data: { view: 'inventory' } },
  { path: 'finances', component: StockPage, data: { view: 'finances' } },
  {
    path: 'production',
    loadComponent: () => import('./features/flow.page').then((m) => m.FlowPage),
  },
  { path: 'settings', component: FilesPage },
  { path: 'plan', redirectTo: 'recipes/calculator' },
  { path: 'design', redirectTo: 'recipes/design' },
  { path: 'stock', redirectTo: 'inventory' },
  { path: 'flow', redirectTo: 'production' },
  { path: 'files', redirectTo: 'settings' },
  { path: '**', redirectTo: 'production' },
];
