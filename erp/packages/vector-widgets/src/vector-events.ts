import type { VectorEventDetailMap, VectorEventType } from './vector-types';

export const VECTOR_EVENT_NAMES = [
  'vector-select',
  'vector-preview',
  'vector-change',
  'vector-cancel',
  'vector-constraint-hit',
] as const satisfies readonly VectorEventType[];

export function emitVectorEvent<TName extends VectorEventType>(
  target: EventTarget,
  name: TName,
  detail: VectorEventDetailMap[TName],
): void {
  target.dispatchEvent(
    new CustomEvent(name, { bubbles: true, composed: true, detail }),
  );
}
