import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { WorkspaceService } from '../workspace.service';
import { recipeOptions } from '../ui-format';

@Component({
  selector: 'rms-recipes-page',
  imports: [RouterLink],
  template: ` <section aria-labelledby="recipes-heading">
    <div class="panel-heading">
      <h2 id="recipes-heading">Recipes</h2>
      <div class="top-actions">
        <a routerLink="/recipes/calculator">Batch calculator</a>
        <a routerLink="/recipes/design">Recipe designer</a>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Recipe</th>
            <th>Identifier</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (recipe of recipes(); track recipe.id) {
            <tr>
              <td>{{ recipe.name }}</td>
              <td>{{ recipe.id }}</td>
              <td>{{ recipe.draft ? 'Draft' : 'Available' }}</td>
              <td>
                <button type="button" (click)="plan(recipe.id)">
                  Plan batch
                </button>
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="4">No recipes yet.</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  </section>`,
})
export class RecipesPage {
  readonly workspace = inject(WorkspaceService);
  private readonly router = inject(Router);
  readonly recipes = computed(() => {
    const workspace = this.workspace.workspace();
    return recipeOptions(workspace).map((recipe) => {
      const product = workspace?.product_recipes?.find(
        (p) => p.id === recipe.id,
      );
      const baseId = product?.base_recipe_id || recipe.id;
      return {
        ...recipe,
        draft:
          workspace?.base_recipes?.find((b) => b.id === baseId)?.['status'] ===
          'draft',
      };
    });
  });
  plan(id: string) {
    void this.router.navigate(['/production'], { queryParams: { recipe: id } });
  }
}
