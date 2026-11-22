import { Component, computed, inject } from '@angular/core';
import type { BatchCalculation } from '@rmsc/worker-protocol';
import { WorkspaceService } from '../workspace.service';
import {
  activeBarSizes,
  formatGrams,
  labelize,
  money,
  recipeOptions,
} from '../ui-format';

@Component({
  selector: 'rms-plan-page',
  template: `
    <section aria-labelledby="plan-heading">
      <div class="split">
        <section class="panel tool-panel">
          <div class="panel-heading">
            <h2 id="plan-heading">Batch Calculator</h2>
            <button
              class="primary"
              title="Save planned batch"
              (click)="savePlan()"
            >
              + Plan
            </button>
          </div>

          <form class="form-grid" (submit)="calculate($event)">
            <label>
              Recipe
              <select
                [value]="workspace.selectedRecipeId()"
                (change)="setRecipe($any($event.target).value)"
              >
                @for (recipe of recipes(); track recipe.id) {
                  <option
                    [value]="recipe.id"
                    [selected]="workspace.selectedRecipeId() === recipe.id"
                  >
                    {{ recipe.name }}
                  </option>
                }
              </select>
            </label>
            <label>
              Mold volume
              <input
                type="number"
                min="1"
                step="0.01"
                [value]="workspace.volumeIn3()"
                (input)="setVolume($any($event.target).value)"
              />
            </label>
            <label>
              Bar size
              <select
                [value]="workspace.selectedBarSize()"
                (change)="setBarSize($any($event.target).value)"
              >
                @for (size of barSizes(); track size[0]) {
                  <option
                    [value]="size[0]"
                    [selected]="workspace.selectedBarSize() === size[0]"
                  >
                    {{ size[1].display_name || size[0] }}
                  </option>
                }
              </select>
            </label>
            <label>
              Fragrance %
              <input
                type="number"
                min="0"
                max="6"
                step="0.1"
                [value]="workspace.fragrancePct()"
                (input)="setFragrance($any($event.target).value)"
              />
            </label>
            <button class="primary span-two" type="submit">Calculate</button>
          </form>
        </section>

        <section class="panel result-panel" aria-live="polite">
          <div class="panel-heading">
            <h2>Prep Sheet</h2>
            <span class="badge">{{ calculationBadge() }}</span>
          </div>

          @if (workspace.currentCalculation(); as calc) {
            <div>
              <div class="prep-grid">
                <div class="prep-tile">
                  <span>Total oils</span
                  ><strong>{{ grams(calc.total_oils_g) }}</strong>
                </div>
                <div class="prep-tile">
                  <span>Total mass</span
                  ><strong>{{ grams(calc.total_mass_g) }}</strong>
                </div>
                <div class="prep-tile">
                  <span>Expected bars</span
                  ><strong>{{ calc.bars_expected || 0 }}</strong>
                </div>
                <div class="prep-tile">
                  <span>Lye</span><strong>{{ grams(calc.lye_g) }}</strong>
                </div>
                <div class="prep-tile">
                  <span>Liquid</span><strong>{{ grams(calc.liquid_g) }}</strong>
                </div>
                <div class="prep-tile">
                  <span>Fragrance</span
                  ><strong>{{ grams(calc.fragrance.amount_g) }}</strong>
                </div>
              </div>
              <ul class="material-list">
                @for (material of materialEntries(calc); track material[0]) {
                  <li>
                    <span>{{ label(material[0]) }}</span>
                    <strong>{{ grams(material[1]) }}</strong>
                  </li>
                }
              </ul>
            </div>
          } @else {
            <div class="result-empty">No batch calculated yet.</div>
          }
        </section>
      </div>
    </section>
  `,
})
export class PlanPage {
  readonly workspace = inject(WorkspaceService);
  readonly recipes = computed(() => recipeOptions(this.workspace.workspace()));
  readonly barSizes = computed(() =>
    activeBarSizes(this.workspace.workspace()),
  );
  readonly grams = formatGrams;
  readonly label = labelize;

  setRecipe(value: string) {
    this.workspace.selectedRecipeId.set(value);
  }

  setBarSize(value: string) {
    this.workspace.selectedBarSize.set(value);
  }

  setVolume(value: string) {
    this.workspace.volumeIn3.set(Number(value));
  }

  setFragrance(value: string) {
    this.workspace.fragrancePct.set(Number(value));
  }

  calculate(event: Event) {
    event.preventDefault();
    void this.workspace.calculate();
  }

  savePlan() {
    void this.workspace.savePlan();
  }

  calculationBadge() {
    const calculation = this.workspace.currentCalculation();
    if (!calculation) {
      return 'Demo';
    }
    return calculation.costing.missing_material_costs.length
      ? 'Missing costs'
      : money(calculation.costing.total_material_cost);
  }

  materialEntries(calc: BatchCalculation) {
    return Object.entries(calc.materials_required_g);
  }
}
