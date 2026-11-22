const DEFAULT_STEP = 0.1;
const DEFAULT_PLACES = 4;

export function transactionId(prefix = 'tx'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function round(value: number, places = DEFAULT_PLACES): number {
  const factor = 10 ** places;
  return Math.round((Number(value ?? 0) + Number.EPSILON) * factor) / factor;
}

export function roundToStep(value: number, step = DEFAULT_STEP): number {
  const normalizedStep = Number(step ?? DEFAULT_STEP);
  return round(
    Math.round(value / normalizedStep) * normalizedStep,
    decimalsForStep(normalizedStep),
  );
}

export function clamp(value: number, min = -Infinity, max = Infinity): number {
  return Math.min(max, Math.max(min, Number(value ?? 0)));
}

export function labelize(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function decimalsForStep(step: number): number {
  const text = String(step);
  return text.includes('.') ? text.split('.')[1].length : 0;
}
