import { html, svg, type TemplateResult } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import { PointerDragController } from './pointer-drag-controller';
import { radarStyles } from './styles/radar.styles.generated';
import { VectorElement } from './vector-component-support';
import { formatNumber, placesForStep } from './vector-formatting';
import {
  angleFor,
  labelOffsetPoint,
  pointForAxis,
  pointsAttr,
  polarPoint,
  regularPoints,
  type Point,
} from './vector-geometry';
import {
  clamp,
  cloneVector,
  emitVectorEvent,
  round,
  roundToStep,
  transactionId,
} from './vector-math';
import { vectorThemeStyles } from './vector-theme';
import type {
  ConstraintHit,
  NamedVector,
  VectorAxis,
  VectorChangeDetail,
  VectorRadarState,
  VectorRange,
} from './vector-types';

interface RadarDragState {
  key: string;
  transactionId: string;
  startValue: NamedVector;
  latest: VectorChangeDetail | null;
}

export class VectorRadarChart extends VectorElement {
  private readonly pointerDrag = new PointerDragController(this);
  @query('svg') private accessor svgElement!: SVGSVGElement;
  static override styles = [vectorThemeStyles, radarStyles];

  @state() private accessor _drag: RadarDragState | null = null;

  @property({ attribute: false }) accessor axes: VectorAxis[];
  @property({ attribute: false }) accessor value: NamedVector;
  @property({ attribute: false }) accessor previewValue: NamedVector | null;
  @property({ attribute: false }) accessor targetValue: NamedVector | null;
  @property({ attribute: false }) accessor reachableRange: VectorRange;
  @property({ attribute: false }) accessor preferredRange: VectorRange;
  @property({ attribute: false }) accessor selectedKey: string;
  @property({ attribute: false }) accessor hits: ConstraintHit[];
  @property({ attribute: false }) accessor disabled: boolean;
  @property({ attribute: false }) accessor precision: number | null;
  @property({ attribute: false }) accessor showValues: boolean;

  constructor() {
    super();
    this.axes = [];
    this.value = {};
    this.previewValue = null;
    this.targetValue = null;
    this.reachableRange = {};
    this.preferredRange = {};
    this.selectedKey = '';
    this.hits = [];
    this.disabled = false;
    this._drag = null;
    this.precision = null;
    this.showValues = false;
    this.theme = {};
  }

  /** @deprecated Prefer the individual reactive properties. */
  set state(value: Partial<VectorRadarState>) {
    this._setRadarState(value ?? {});
  }
  get state(): VectorRadarState {
    return {
      axes: this.axes,
      value: this.value,
      previewValue: this.previewValue,
      targetValue: this.targetValue,
      reachableRange: this.reachableRange,
      preferredRange: this.preferredRange,
      selectedKey: this.selectedKey,
      hits: this.hits,
      disabled: this.disabled,
      precision: this.precision,
      showValues: this.showValues,
      theme: this.theme,
    };
  }

  override render(): TemplateResult {
    const axes = this.axes;
    const hitKeys = new Set(this.hits.map((hit) => hit.key));
    const current = this._pointsFor(this.value, 90);
    const preview = this.previewValue
      ? this._pointsFor(this.previewValue, 90)
      : [];
    const target = this.targetValue
      ? this._pointsFor(this.targetValue, 90)
      : [];
    const displayVector = this.previewValue ?? this.value;
    const displayPoints = this._pointsFor(displayVector, 90);
    const preferredMax = this._pointsForRange('preferredMax', 90);
    const reachableMax = this._pointsForRange('reachableMax', 90);
    const grid = repeat(
      [0.25, 0.5, 0.75, 1],
      (ratio) => ratio,
      (ratio) => svg`
      <polygon class="grid-ring" points=${regularPoints(axes.length, 90 * ratio)}></polygon>
    `,
    );
    const axisLines = repeat(
      axes,
      (axis) => axis.key,
      (axis, index) => {
        const point = polarPoint(angleFor(index, axes.length), 96);
        const labelPoint = polarPoint(angleFor(index, axes.length), 112);
        return svg`
        <line class="axis" x1="0" y1="0" x2="${point.x}" y2="${point.y}"></line>
        <text class=${classMap({ 'axis-label': true, selected: axis.key === this.selectedKey })}
          x=${labelPoint.x} y=${labelPoint.y} text-anchor="middle">${axis.label}</text>
      `;
      },
    );
    const marbles = repeat(
      axes,
      (axis) => axis.key,
      (axis, index) => {
        const point = pointForAxis(
          axis,
          Number(displayVector[axis.key] ?? 0),
          index,
          axes.length,
          90,
        );
        const hit = hitKeys.has(axis.key);
        const valueText = formatNumber(
          displayVector[axis.key] ?? 0,
          this._places(axis),
        );
        return svg`
        <circle class=${classMap({ marble: true, selected: axis.key === this.selectedKey, hit })}
          cx=${point.x} cy=${point.y} r="6" tabindex="0" role="slider"
          aria-label=${`${axis.label} ${valueText}`} data-key=${axis.key}
          @click=${() => this._select(axis.key)}
          @pointerdown=${(event: PointerEvent) => this._startDrag(event, axis.key)}
          @keydown=${(event: KeyboardEvent) => this._keydown(event, axis.key)}>
          <title>${axis.label}: ${valueText}</title>
        </circle>
      `;
      },
    );
    const valueLabels = this.showValues
      ? repeat(
          displayPoints,
          (_, index) => axes[index]?.key || index,
          (point, index) => {
            const axis = axes[index];
            const labelPoint = labelOffsetPoint(point);
            return svg`
        <text class=${classMap({ 'value-label': true, selected: axis.key === this.selectedKey })}
          x=${labelPoint.x} y=${labelPoint.y} text-anchor="middle">
          ${formatNumber(displayVector[axis.key] ?? 0, this._places(axis))}
        </text>
      `;
          },
        )
      : '';
    const targetDots = repeat(
      target,
      (_, index) => axes[index]?.key || index,
      (point, index) => {
        const axis = axes[index];
        return svg`<circle class="target-dot" cx=${point.x} cy=${point.y} r="3.5"><title>${axis.label} target</title></circle>`;
      },
    );

    return html`
      <div class=${classMap({ 'chart-shell': true, disabled: this.disabled })}>
        <svg
          class="radar"
          viewBox="-130 -124 260 248"
          aria-label="Soap quality radar chart"
        >
          ${grid} ${axisLines}
          ${preferredMax.length
            ? svg`<polygon class="preferred" points=${pointsAttr(preferredMax)}><title>Preferred range</title></polygon>`
            : ''}
          ${reachableMax.length
            ? svg`<polygon class="reachable" points=${pointsAttr(reachableMax)}><title>Axis reach</title></polygon>`
            : ''}
          <polygon class="current" points=${pointsAttr(current)}></polygon>
          ${preview.length
            ? svg`<polygon class="preview" points=${pointsAttr(preview)}></polygon>`
            : ''}
          ${targetDots} ${marbles} ${valueLabels}
        </svg>
        <div class="after-chart">
          <slot name="after-chart"></slot>
        </div>
      </div>
    `;
  }

  _patchRadarState(patch: Partial<VectorRadarState>): void {
    Object.assign(this, patch);
  }

  _setRadarState(value: Partial<VectorRadarState>): void {
    const next = {
      axes: value.axes ?? [],
      value: cloneVector(value.value ?? {}),
      previewValue: value.previewValue ? cloneVector(value.previewValue) : null,
      targetValue: value.targetValue ? cloneVector(value.targetValue) : null,
      reachableRange: value.reachableRange ?? {},
      preferredRange: value.preferredRange ?? {},
      selectedKey: value.selectedKey ?? '',
      hits: value.hits ?? [],
      disabled: Boolean(value.disabled),
      precision: value.precision == null ? null : Number(value.precision),
      showValues: Boolean(value.showValues),
      theme: value.theme ?? {},
    };
    this.axes = next.axes;
    this.value = next.value;
    this.previewValue = next.previewValue;
    this.targetValue = next.targetValue;
    this.reachableRange = next.reachableRange;
    this.preferredRange = next.preferredRange;
    this.selectedKey = next.selectedKey;
    this.hits = next.hits;
    this.disabled = next.disabled;
    this.precision = next.precision;
    this.showValues = next.showValues;
    this.theme = next.theme;
  }

  private _select(key: string): void {
    if (this.disabled) {
      return;
    }
    this.selectedKey = key;
    emitVectorEvent(this, 'vector-select', {
      source: 'radar',
      role: 'metric',
      transactionId: transactionId('select'),
      key,
    });
  }

  private _startDrag(event: PointerEvent, key: string): void {
    if (this.disabled || event.button > 0) {
      return;
    }
    event.preventDefault();
    this._select(key);
    this._drag = {
      key,
      transactionId: transactionId('radar'),
      startValue: cloneVector(this.value),
      latest: null,
    };
    this.pointerDrag.start({
      move: (moveEvent) => this._dragMove(moveEvent),
      end: () => this._dragEnd(),
      cancel: () => this._cancelDrag(),
    });
  }

  private _dragMove(event: PointerEvent): void {
    if (!this._drag) {
      return;
    }
    const value = this._valueFromPoint(event, this._drag.key);
    this._previewMetric(value);
  }

  private _dragEnd(): void {
    if (!this._drag) {
      return;
    }
    if (this._drag.latest) {
      emitVectorEvent(this, 'vector-change', this._drag.latest);
    }
    this._drag = null;
  }

  private _cancelDrag(): void {
    if (!this._drag) {
      return;
    }
    emitVectorEvent(this, 'vector-cancel', {
      source: 'radar',
      role: 'metric',
      transactionId: this._drag.transactionId,
      previousValue: this._drag.startValue,
    });
    this._drag = null;
  }

  private _keydown(event: KeyboardEvent, key: string): void {
    const axis = this._axis(key);
    if (!axis) {
      return;
    }
    const step = Number(axis.step ?? 1);
    let target = null;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      target = Number(this.value[key] ?? 0) + step;
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      target = Number(this.value[key] ?? 0) - step;
    } else if (event.key === 'Home') {
      target = Number(axis.min ?? 0);
    } else if (event.key === 'End') {
      target = Number(axis.max ?? 100);
    } else if (event.key === 'Escape') {
      this._cancelDrag();
      emitVectorEvent(this, 'vector-cancel', {
        source: 'radar',
        role: 'metric',
        transactionId: transactionId('radar-cancel'),
        previousValue: this.value,
      });
    }
    if (target == null) {
      return;
    }
    event.preventDefault();
    const detail = this._detailForMetric(
      key,
      target,
      transactionId('radar-key'),
      this.value,
    );
    emitVectorEvent(this, 'vector-preview', detail);
    emitVectorEvent(this, 'vector-change', detail);
  }

  private _previewMetric(target: number): void {
    const drag = this._drag;
    if (!drag) return;
    const detail = this._detailForMetric(
      drag.key,
      target,
      drag.transactionId,
      drag.startValue,
    );
    drag.latest = detail;
    emitVectorEvent(this, 'vector-preview', detail);
  }

  private _detailForMetric(
    key: string,
    target: number,
    id: string,
    previousValue: NamedVector,
  ): VectorChangeDetail {
    const axis = this._axis(key);
    const requested = {
      ...previousValue,
      [key]: roundToStep(
        clamp(target, axis?.min ?? 0, axis?.max ?? 100),
        axis?.step ?? 1,
      ),
    };
    return {
      source: 'radar',
      role: 'metric',
      transactionId: id,
      key,
      previousValue,
      requestedValue: requested,
      proposedValue: requested,
      delta: round(
        Number(requested[key] ?? 0) - Number(previousValue[key] ?? 0),
        4,
      ),
      hits: [],
    };
  }

  private _valueFromPoint(event: PointerEvent, key: string): number {
    const svg = this.svgElement;
    if (!svg) return Number(this.value[key] ?? 0);
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 260 - 130;
    const y = ((event.clientY - rect.top) / rect.height) * 248 - 124;
    const index = this.axes.findIndex((axis) => axis.key === key);
    const axis = this.axes[index];
    const angle = angleFor(index, this.axes.length);
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const distance = clamp((x * ux + y * uy) / 90, 0, 1);
    return (
      Number(axis?.min ?? 0) +
      distance * (Number(axis?.max ?? 100) - Number(axis?.min ?? 0))
    );
  }

  private _axis(key: string): VectorAxis | undefined {
    return this.axes.find((axis) => axis.key === key);
  }

  private _places(axis: VectorAxis): number {
    if (Number.isFinite(this.precision)) {
      return Math.max(0, Number(this.precision));
    }
    return placesForStep(axis.step ?? 1);
  }

  private _pointsFor(vector: NamedVector, radius: number): Point[] {
    return this.axes.map((axis, index) =>
      pointForAxis(
        axis,
        Number(vector[axis.key] ?? 0),
        index,
        this.axes.length,
        radius,
      ),
    );
  }

  private _pointsForRange(
    prop: 'preferredMax' | 'reachableMax',
    radius: number,
  ): Point[] {
    return this.axes
      .map((axis, index) => {
        const range = this.reachableRange[axis.key];
        const value =
          prop === 'reachableMax'
            ? (range?.max ?? axis.reachableMax ?? axis.max)
            : (this.preferredRange[axis.key]?.max ?? axis.preferredMax);
        if (value == null) {
          return null;
        }
        return pointForAxis(
          axis,
          Number(value),
          index,
          this.axes.length,
          radius,
        );
      })
      .filter((point): point is Point => point !== null);
  }
}
