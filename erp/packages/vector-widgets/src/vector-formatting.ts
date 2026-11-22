import { DEFAULT_VECTOR_PALETTE } from './vector-constants';
import { round } from './vector-math';
import type {
  ScalarVectorItem,
  ThresholdBand,
  UnitOption,
  VectorItem,
} from './vector-types';

export function defaultColor(
  index: number,
  palette: readonly string[] = DEFAULT_VECTOR_PALETTE,
): string {
  const colors = normalizePalette(palette);
  return colors[index % colors.length];
}

export function colorForItem(
  item: VectorItem | ScalarVectorItem | null | undefined,
  index = 0,
  palette: readonly string[] = DEFAULT_VECTOR_PALETTE,
): string {
  return item?.color ?? defaultColor(index, palette);
}

export function thresholdForValue(
  value: number,
  thresholds: readonly ThresholdBand[] = [],
): ThresholdBand | null {
  return (
    thresholds.find((threshold) => {
      return (
        Number(value) >= Number(threshold.min) &&
        Number(value) <= Number(threshold.max)
      );
    }) || null
  );
}

export function normalizePalette(
  value: readonly string[] | null | undefined,
): readonly string[] {
  return Array.isArray(value) && value.length ? value : DEFAULT_VECTOR_PALETTE;
}

export function sameStateValue(left: unknown, right: unknown): boolean {
  return stableStateString(left) === stableStateString(right);
}

export function stableStateString(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStateString(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${key}:${stableStateString(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function setClass(
  node: Element | null | undefined,
  className: string,
  enabled: boolean,
): void {
  if (!node?.classList) {
    return;
  }
  if (typeof node.classList.toggle === 'function') {
    node.classList.toggle(className, Boolean(enabled));
    return;
  }
  if (enabled && typeof node.classList.add === 'function') {
    node.classList.add(className);
  } else if (!enabled && typeof node.classList.remove === 'function') {
    node.classList.remove(className);
  }
}

export function placesForStep(step = 1): number {
  const normalized = Number(step ?? 1);
  if (!Number.isFinite(normalized) || normalized >= 1) {
    return 0;
  }
  const text = String(normalized);
  if (text.includes('e-')) {
    return Number(text.split('e-')[1] || 0);
  }
  return text.includes('.') ? text.split('.')[1].length : 0;
}

export function formatNumber(value: number, places = 0): string {
  const normalizedPlaces = Math.max(0, Number(places ?? 0));
  return normalizedPlaces > 0
    ? Number(value || 0).toFixed(normalizedPlaces)
    : String(round(value, 0));
}

export function compactUnitLabel(
  option: UnitOption | null | undefined,
  fallback = '',
): string {
  const symbol = String(option?.symbol ?? fallback ?? '').trim();
  return symbol || option?.label || '';
}
