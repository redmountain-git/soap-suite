import { DEFAULT_VECTOR_THEME } from './vector-constants';
export { vectorThemeStyles } from './vector-theme.styles.generated';
import type { VectorTheme } from './vector-types';

export function normalizeTheme(
  value: VectorTheme = {},
): typeof DEFAULT_VECTOR_THEME & VectorTheme {
  return { ...DEFAULT_VECTOR_THEME, ...value };
}

export function cssToken(value: string): string {
  return String(value ?? '').replace(/[<>"'&;]/g, '');
}

export function applyTheme(
  element: HTMLElement,
  theme: Record<string, string> = {},
  previous: Record<string, string> = {},
): void {
  for (const key of Object.keys(previous)) {
    if (key in theme) continue;
    const token = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    element.style.removeProperty(`--vector-${token}`);
  }
  for (const [key, value] of Object.entries(theme ?? {})) {
    const token = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    element.style.setProperty(`--vector-${token}`, cssToken(value));
  }
}
