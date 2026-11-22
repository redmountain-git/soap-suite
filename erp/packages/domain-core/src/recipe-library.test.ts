import { describe, expect, it } from 'vitest';
import {
  addBaseRecipe,
  calculateBatch,
  createDemoWorkspace,
  importWorkspace,
} from './index';

describe('recipe-only additions', () => {
  const recipe = {
    id: 'BSR-905',
    name: 'Powdered milk draft',
    status: 'draft',
    oils_pct: { olive_oil: 100 },
    liquid: { default_type: 'distilled_water', default_ratio: (0.33 * 8) / 9 },
    additives_pct: { goat_milk_powder: 33 / 9 },
    review_required: ['Choose a milk powder before sizing.'],
  };
  const raw = JSON.stringify({
    app: 'red-mountain-soap-recipe',
    version: 1,
    recipe,
  });
  it('adds only a recipe, preserves history and balances, and rejects conflicting replacements', () => {
    const source = createDemoWorkspace();
    const next = addBaseRecipe(source, raw, '2026-11-16T20:00:00.000Z');
    expect(next.base_recipes!.at(-1)).toEqual(recipe);
    expect(next.inventory).toEqual(source.inventory);
    expect(next.batches).toEqual(source.batches);
    expect(addBaseRecipe(next, raw, '2026-11-16T20:00:01.000Z')).toBe(next);
    expect(() =>
      addBaseRecipe(
        next,
        raw.replace('Powdered milk draft', 'Conflicting name'),
        '2026-11-16T20:00:01.000Z',
      ),
    ).toThrow(/not overwritten/i);
    expect(importWorkspace(JSON.stringify(next)).base_recipes!.at(-1)).toEqual(
      recipe,
    );
  });
  it('keeps unreviewed draft recipes out of batch calculations', () => {
    const w = addBaseRecipe(
      createDemoWorkspace(),
      raw,
      '2026-11-16T20:00:00.000Z',
    );
    expect(() =>
      calculateBatch(w, { recipeId: recipe.id, volumeIn3: 100 }),
    ).toThrow(/draft.*Choose a milk powder/i);
    expect(() => addBaseRecipe(w, '{', '2026-11-16T20:00:00.000Z')).toThrow();
  });
});
