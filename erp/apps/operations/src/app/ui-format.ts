import type {
  BarSize,
  InventoryRecord,
  Workspace,
} from '@rmsc/worker-protocol';

export function money(value: unknown) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function formatGrams(value: unknown) {
  return `${formatNumber(value)} g`;
}

export function formatNumber(value: unknown) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function labelize(value: unknown) {
  return String(value || '').replaceAll('_', ' ');
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function formString(data: FormData, key: string) {
  return String(data.get(key) || '');
}

export function formNumber(data: FormData, key: string) {
  return Number(data.get(key) || 0);
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function recipeOptions(workspace: Workspace | null | undefined) {
  if (!workspace) {
    return [];
  }
  return [
    ...(workspace.product_recipes || []).map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
    })),
    ...(workspace.base_recipes || []).map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
    })),
  ];
}

export function activeBarSizes(
  workspace: Workspace | null | undefined,
): Array<[string, BarSize]> {
  return Object.entries(workspace?.bar_sizes || {}).filter(
    ([, size]) => size.active !== false,
  );
}

export function inventorySections(
  workspace: Workspace | null | undefined,
): Array<[string, Record<string, InventoryRecord>]> {
  return [
    ['Raw materials', workspace?.inventory.raw_materials || {}],
    ['Additives', workspace?.inventory.additives || {}],
    ['Finished goods', workspace?.inventory.finished_goods || {}],
  ];
}
