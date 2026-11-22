import { clamp, round } from './vector-math';
import type { VectorAxis } from './vector-types';

export interface Point {
  x: number;
  y: number;
}
export interface DecoratorElement extends HTMLElement {
  dataset: DOMStringMap;
}

export function pointForAxis(
  axis: VectorAxis,
  value: number,
  index: number,
  count: number,
  radius: number,
): Point {
  const min = Number(axis.min ?? 0);
  const max = Number(axis.max ?? 100);
  const ratio =
    max === min ? 0 : clamp((Number(value || 0) - min) / (max - min), 0, 1);
  return polarPoint(angleFor(index, count), radius * ratio);
}

export function angleFor(index: number, count: number): number {
  return -Math.PI / 2 + index * ((Math.PI * 2) / Math.max(1, count));
}

export function polarPoint(angle: number, radius: number): Point {
  return {
    x: round(Math.cos(angle) * radius, 2),
    y: round(Math.sin(angle) * radius, 2),
  };
}

export function labelOffsetPoint(point: Point): Point {
  const length = Math.max(1, Math.hypot(point.x, point.y));
  return {
    x: round(point.x + (point.x / length) * 15, 2),
    y: round(point.y + (point.y / length) * 15 + 3, 2),
  };
}

export function regularPoints(count: number, radius: number): string {
  return pointsAttr(
    Array.from({ length: count }, (_, index) =>
      polarPoint(angleFor(index, count), radius),
    ),
  );
}

export function compareDecorators(
  a: DecoratorElement,
  b: DecoratorElement,
): number {
  return decoratorRank(a) - decoratorRank(b);
}

export function decoratorRank(decorator: DecoratorElement): number {
  const dataset = decorator.dataset || {};
  if ('lockBadge' in dataset) {
    return 0;
  }
  if (dataset['limitType'] === 'min') {
    return 1;
  }
  if (dataset['limitType'] === 'max') {
    return 2;
  }
  return 3;
}

export function pointsAttr(points: readonly (Point | null)[]): string {
  return points
    .filter((point): point is Point => point !== null)
    .map((point) => `${point.x},${point.y}`)
    .join(' ');
}

export function describeWedge(
  startAngle: number,
  endAngle: number,
  radius: number,
): string {
  if (Math.abs(endAngle - startAngle) >= 359.99) {
    return [
      `M 0 0`,
      `m ${-radius}, 0`,
      `a ${radius},${radius} 0 1,0 ${radius * 2},0`,
      `a ${radius},${radius} 0 1,0 ${-radius * 2},0`,
      'Z',
    ].join(' ');
  }
  const start = anglePoint(startAngle, radius);
  const end = anglePoint(endAngle, radius);
  const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  return `M 0 0 L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

export function anglePoint(angle: number, radius: number): Point {
  const radians = toRadians(angle);
  return {
    x: round(Math.cos(radians) * radius, 2),
    y: round(Math.sin(radians) * radius, 2),
  };
}

export function toRadians(angle: number): number {
  return (angle * Math.PI) / 180;
}
