import { html, svg, type TemplateResult } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleVariables } from './style-variables';
import { PointerDragController } from './pointer-drag-controller';
import { pieStyles } from './styles/pie.styles.generated';
import { VectorElement } from './vector-component-support';
import { DEFAULT_VECTOR_PALETTE, LOCK_ICON } from './vector-constants';
import {
  colorForItem,
  defaultColor,
  formatNumber,
  normalizePalette,
  placesForStep,
} from './vector-formatting';
import {
  anglePoint,
  compareDecorators,
  describeWedge,
  toRadians,
  type DecoratorElement,
  type Point,
} from './vector-geometry';
import {
  cloneVector,
  emitVectorEvent,
  labelize,
  redistributeComposition,
  round,
  roundToStep,
  transactionId,
} from './vector-math';
import { vectorThemeStyles } from './vector-theme';
import type {
  ConstraintHit,
  NamedVector,
  VectorChangeDetail,
  VectorConstraint,
  VectorItem,
  VectorPieState,
} from './vector-types';

interface PieDragState {
  key: string;
  transactionId: string;
  startX: number;
  startY: number;
  startValue: NamedVector;
  latest: VectorChangeDetail | null;
}

interface DecoratorGroup {
  point: Point;
  decorators: DecoratorElement[];
}

export class VectorPieChart extends VectorElement {
  private readonly pointerDrag = new PointerDragController(this);
  @query('slot[name="slice-decorator"]')
  private accessor decoratorSlot!: HTMLSlotElement;
  @query('.chart-shell') private accessor chartShell!: HTMLElement;
  static override styles = [vectorThemeStyles, pieStyles];

  @state() private accessor _drag: PieDragState | null;
  _decoratorPositions: Map<string, Point>;

  @property({ attribute: false }) accessor items: VectorItem[];
  @property({ attribute: false }) accessor value: NamedVector;
  @property({ attribute: false }) accessor constraints: Record<
    string,
    VectorConstraint
  >;
  @property({ attribute: false }) accessor total: number;
  @property({ attribute: false }) accessor selectedKey: string;
  @property({ attribute: false }) accessor hits: ConstraintHit[];
  @property({ attribute: false }) accessor disabled: boolean;
  @property({ attribute: false }) accessor precision: number | null;
  @property({ attribute: false }) accessor centerValue: number | string | null;
  @property({ attribute: false }) accessor centerLabel: string;
  @property({ attribute: false }) accessor centerPrecision: number | null;
  @property({ attribute: false }) accessor palette: readonly string[];

  constructor() {
    super();
    this.items = [];
    this.value = {};
    this.constraints = {};
    this.total = 100;
    this.selectedKey = '';
    this.hits = [];
    this.disabled = false;
    this._drag = null;
    this.precision = null;
    this.centerValue = null;
    this.centerLabel = '';
    this.centerPrecision = null;
    this.theme = {};
    this.palette = DEFAULT_VECTOR_PALETTE;
    this._decoratorPositions = new Map();
  }

  /** @deprecated Prefer the individual reactive properties. */
  set state(value: Partial<VectorPieState>) {
    this._setPieState(value ?? {});
  }
  get state(): VectorPieState {
    return {
      items: this.items,
      value: this.value,
      constraints: this.constraints,
      total: this.total,
      selectedKey: this.selectedKey,
      hits: this.hits,
      disabled: this.disabled,
      precision: this.precision,
      centerValue: this.centerValue,
      centerLabel: this.centerLabel,
      centerPrecision: this.centerPrecision,
      theme: this.theme,
      palette: this.palette,
    };
  }

  override render(): TemplateResult {
    const entries = this._orderedEntries();
    const total =
      entries.reduce((sum, [, value]) => sum + Number(value ?? 0), 0) ||
      this.total;
    const hitKeys = new Set(this.hits.map((hit) => hit.key));
    const places = this._places();
    const hasCenterValue = this.centerValue != null;
    const centerValue = hasCenterValue ? this.centerValue : total;
    const centerPlaces =
      this.centerPrecision == null ? places : Number(this.centerPrecision || 0);
    const centerText = hasCenterValue
      ? typeof centerValue === 'number'
        ? formatNumber(centerValue, centerPlaces)
        : String(centerValue)
      : `${formatNumber(total, places)}%`;
    const centerLabel = this.centerLabel || 'total';
    let angle = -90;
    const decoratorPositions = new Map<string, Point>();
    const paths = repeat(
      entries,
      ([key]) => key,
      ([key, value], index) => {
        const item = this._itemFor(key, index);
        const itemColor = colorForItem(item, index, this.palette);
        const locked = Boolean((this.constraints[key] ?? {}).locked);
        const sweep = (Number(value ?? 0) / total) * 360;
        const start = angle;
        const end = angle + sweep;
        angle = end;
        const selected = key === this.selectedKey;
        const hit = hitKeys.has(key);
        const mid = (start + end) / 2;
        const lift = selected || hit ? 5 : 0;
        const dx = Math.cos(toRadians(mid)) * lift;
        const dy = Math.sin(toRadians(mid)) * lift;
        const status = locked ? ' locked' : '';
        const valueText = formatNumber(value, places);
        const decoratorPoint = anglePoint(mid, 61.5);
        decoratorPositions.set(key, {
          x: round(((decoratorPoint.x + dx + 104) / 208) * 100, 4),
          y: round(((decoratorPoint.y + dy + 104) / 208) * 100, 4),
        });
        return svg`
        <g class="slice-wrap" transform="translate(${round(dx, 2)} ${round(dy, 2)})">
          <path
            class=${classMap({ slice: true, selected, hit })}
            d="${describeWedge(start, end, 82)}"
            fill=${itemColor}
            tabindex="0"
            role="button"
            aria-label=${`${item.label} ${valueText} percent${status}`}
            data-key=${key}
            @click=${() => this._select(key)}
            @keydown=${(event: KeyboardEvent) => this._keydown(event, key)}
            @wheel=${(event: WheelEvent) => this._wheel(event, key)}
            @pointerdown=${(event: PointerEvent) => this._startDrag(event, key)}
          >
            <title>${item.label}: ${valueText}%${status}</title>
          </path>
        </g>
      `;
      },
    );
    this._decoratorPositions = decoratorPositions;
    const legend = repeat(
      entries,
      ([key]) => key,
      ([key, value], index) => {
        const item = this._itemFor(key, index);
        const locked = Boolean((this.constraints[key] || {}).locked);
        return html`
          <button
            class=${classMap({
              'legend-item': true,
              selected: key === this.selectedKey,
            })}
            data-key=${key}
            @click=${() => this._select(key)}
          >
            <span
              class="swatch"
              ${styleVariables({
                '--item-color': colorForItem(item, index, this.palette),
              })}
            ></span>
            <span>${item.label}</span>
            <strong
              >${locked ? `${LOCK_ICON} ` : ''}${formatNumber(
                value,
                places,
              )}%</strong
            >
          </button>
        `;
      },
    );

    return html`
      <div class=${classMap({ 'chart-shell': true, disabled: this.disabled })}>
        <div class="pie-frame">
          <svg
            class="pie"
            viewBox="-104 -104 208 208"
            aria-label="Oil percentage pie chart"
          >
            <circle class="base" cx="0" cy="0" r="82"></circle>
            ${paths}
            <circle class="hole" cx="0" cy="0" r="32"></circle>
            <text class="center" x="0" y="-3" text-anchor="middle">
              ${centerText}
            </text>
            <text class="center-label" x="0" y="13" text-anchor="middle">
              ${centerLabel}
            </text>
          </svg>
          <div class="decorator-layer">
            <slot
              name="slice-decorator"
              @slotchange=${() => this._positionDecorators()}
            ></slot>
          </div>
        </div>
        <div class="legend">${legend}</div>
        <div class="after-legend">
          <slot name="after-legend"></slot>
        </div>
      </div>
    `;
  }

  protected override updated(): void {
    this._positionDecorators();
  }

  _patchPieState(patch: Partial<VectorPieState>): void {
    Object.assign(this, patch);
  }

  _setPieState(value: Partial<VectorPieState>): void {
    const next = {
      items: value.items ?? [],
      value: cloneVector(value.value ?? {}),
      constraints: value.constraints ?? {},
      total: Number(value.total ?? 100),
      selectedKey: value.selectedKey ?? '',
      hits: value.hits ?? [],
      disabled: Boolean(value.disabled),
      precision: value.precision == null ? null : Number(value.precision),
      centerValue: value.centerValue ?? null,
      centerLabel: value.centerLabel ?? '',
      centerPrecision:
        value.centerPrecision == null ? null : Number(value.centerPrecision),
      theme: value.theme ?? {},
      palette: normalizePalette(value.palette),
    };
    this.items = next.items;
    this.value = next.value;
    this.constraints = next.constraints;
    this.total = next.total;
    this.selectedKey = next.selectedKey;
    this.hits = next.hits;
    this.disabled = next.disabled;
    this.precision = next.precision;
    this.centerValue = next.centerValue;
    this.centerLabel = next.centerLabel;
    this.centerPrecision = next.centerPrecision;
    this.theme = next.theme;
    this.palette = next.palette;
  }

  positionDecorators(): void {
    this._positionDecorators();
  }

  private _positionDecorators(): void {
    const decorators = (this.decoratorSlot?.assignedElements({
      flatten: true,
    }) ?? []) as DecoratorElement[];
    const groups = new Map<string, DecoratorGroup>();
    decorators.forEach((decorator) => {
      const key = decorator.dataset['key'];
      const point = key ? this._decoratorPositions.get(key) : undefined;
      if (!key || !point) {
        decorator.hidden = true;
        return;
      }
      if (!groups.has(key)) {
        groups.set(key, { point, decorators: [] });
      }
      groups.get(key)?.decorators.push(decorator);
    });

    groups.forEach(({ point, decorators: keyedDecorators }) => {
      keyedDecorators.sort(compareDecorators);
      keyedDecorators.forEach((decorator, index) => {
        const offset = (index - (keyedDecorators.length - 1) / 2) * 18;
        decorator.hidden = false;
        decorator.style?.setProperty?.('--decorator-x', `${point.x}%`);
        decorator.style?.setProperty?.('--decorator-y', `${point.y}%`);
        decorator.style?.setProperty?.(
          '--decorator-offset-x',
          `${round(offset, 2)}px`,
        );
        decorator.style?.setProperty?.('--decorator-offset-y', '0px');
      });
    });
  }

  private _select(key: string): void {
    if (this.disabled) {
      return;
    }
    this.selectedKey = key;
    emitVectorEvent(this, 'vector-select', {
      source: 'pie',
      role: 'composition',
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
      transactionId: transactionId('pie'),
      startX: event.clientX,
      startY: event.clientY,
      startValue: cloneVector(this.value),
      latest: null,
    };
    this.pointerDrag.start({
      move: (moveEvent) => this._dragMove(moveEvent),
      end: (upEvent) => this._dragEnd(upEvent),
      cancel: () => this._cancelDrag(),
    });
  }

  private _dragMove(event: PointerEvent): void {
    if (!this._drag) {
      return;
    }
    const constraint = this.constraints[this._drag.key] ?? {};
    const step = Number(constraint.step ?? 1);
    const pixels =
      this._drag.startY - event.clientY + (event.clientX - this._drag.startX);
    const delta = roundToStep(pixels / 10, step);
    const target = Number(this._drag.startValue[this._drag.key] ?? 0) + delta;
    this._previewTarget(target);
  }

  private _dragEnd(event: PointerEvent): void {
    if (!this._drag) {
      return;
    }
    const rect = this.chartShell?.getBoundingClientRect();
    const outside = rect
      ? event.clientX < rect.left - 20 ||
        event.clientX > rect.right + 20 ||
        event.clientY < rect.top - 20 ||
        event.clientY > rect.bottom + 20
      : false;
    if (outside) {
      this._cancelDrag();
      return;
    }
    const latest = this._drag.latest;
    if (latest) {
      emitVectorEvent(this, 'vector-change', latest);
    }
    this._drag = null;
  }

  private _cancelDrag(): void {
    if (!this._drag) {
      return;
    }
    emitVectorEvent(this, 'vector-cancel', {
      source: 'pie',
      role: 'composition',
      transactionId: this._drag.transactionId,
      previousValue: this._drag.startValue,
    });
    this._drag = null;
  }

  _wheel(event: WheelEvent, key: string): void {
    if (this.disabled) {
      return;
    }
    event.preventDefault();
    const constraint = this.constraints[key] ?? {};
    const step = Number(constraint.step ?? 1);
    const direction = event.deltaY < 0 ? 1 : -1;
    const target = Number(this.value[key] ?? 0) + direction * step;
    const transaction = transactionId('pie-wheel');
    const detail = this._detailForTarget(key, target, transaction, this.value);
    emitVectorEvent(this, 'vector-preview', detail);
    emitVectorEvent(this, 'vector-change', detail);
  }

  private _keydown(event: KeyboardEvent, key: string): void {
    const constraint = this.constraints[key] ?? {};
    const step = Number(constraint.step ?? 1);
    let target = null;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      target = Number(this.value[key] ?? 0) + step;
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      target = Number(this.value[key] ?? 0) - step;
    } else if (event.key === 'Home') {
      target = Number(constraint.min ?? 0);
    } else if (event.key === 'End') {
      target = Number(constraint.max ?? this.total);
    } else if (event.key === 'Escape') {
      this._cancelDrag();
      emitVectorEvent(this, 'vector-cancel', {
        source: 'pie',
        role: 'composition',
        transactionId: transactionId('pie-cancel'),
        previousValue: this.value,
      });
    }
    if (target == null) {
      return;
    }
    event.preventDefault();
    const detail = this._detailForTarget(
      key,
      target,
      transactionId('pie-key'),
      this.value,
    );
    emitVectorEvent(this, 'vector-preview', detail);
    emitVectorEvent(this, 'vector-change', detail);
  }

  private _previewTarget(target: number): void {
    const drag = this._drag;
    if (!drag) return;
    const detail = this._detailForTarget(
      drag.key,
      target,
      drag.transactionId,
      drag.startValue,
    );
    drag.latest = detail;
    emitVectorEvent(this, 'vector-preview', detail);
    if (detail.hits?.length) {
      emitVectorEvent(this, 'vector-constraint-hit', detail);
    }
  }

  private _detailForTarget(
    key: string,
    target: number,
    id: string,
    previousValue: NamedVector,
  ): VectorChangeDetail & { hits: ConstraintHit[] } {
    const result = redistributeComposition({
      value: previousValue,
      key,
      target,
      constraints: this.constraints,
      items: this.items,
      total: this.total,
    });
    return {
      source: 'pie',
      role: 'composition',
      transactionId: id,
      key,
      previousValue,
      requestedValue: { ...previousValue, [key]: target },
      proposedValue: result.vector,
      delta: result.delta,
      hits: result.hits,
    };
  }

  private _orderedEntries(): Array<[string, number]> {
    const itemKeys = this.items.map((item) => item.key);
    const keys = [...new Set([...itemKeys, ...Object.keys(this.value || {})])]
      .filter((key) => key in this.value)
      .sort((a, b) => {
        const aItem = this.items.find((item) => item.key === a);
        const bItem = this.items.find((item) => item.key === b);
        return Number(aItem?.order || 0) - Number(bItem?.order || 0);
      });
    return keys.map((key) => [key, Number(this.value[key] ?? 0)]);
  }

  private _itemFor(key: string, index: number): VectorItem {
    return (
      this.items.find((item) => item.key === key) ?? {
        key,
        label: labelize(key),
        color: defaultColor(index, this.palette),
      }
    );
  }

  private _places(): number {
    if (Number.isFinite(this.precision)) {
      return Math.max(0, Number(this.precision));
    }
    const steps = Object.values(this.constraints || {})
      .map((constraint) => Number(constraint?.step))
      .filter((step) => Number.isFinite(step) && step > 0);
    return steps.length
      ? Math.max(...steps.map((step) => placesForStep(step)))
      : 1;
  }
}
