import { html, nothing, type TemplateResult } from 'lit';
import { query, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { styleVariables } from './style-variables';
import { PointerDragController } from './pointer-drag-controller';
import {
  initializeScalarControl,
  ScalarControlController,
  scalarControlProperties,
  type ScalarControlHost,
  type ScalarHandle,
} from './scalar-control-element';
import { VectorElement } from './vector-component-support';
import { renderThresholdSegments } from './scalar-threshold-template';
import { railStyles } from './styles/rail.styles.generated';
import { LOCK_ICON, UNLOCK_ICON } from './vector-constants';
import { colorForItem } from './vector-formatting';
import {
  clamp,
  createHit,
  emitVectorEvent,
  labelize,
  round,
  roundToStep,
  transactionId,
} from './vector-math';
import { vectorThemeStyles } from './vector-theme';
import type {
  ConstraintHit,
  VectorConstraintRailState,
  VectorEventType,
  VectorRole,
} from './vector-types';

interface RailDragState {
  handle: ScalarHandle;
  transactionId: string;
  startX: number;
  startValue: number;
  latestTarget: number;
}

export class VectorConstraintRail extends VectorElement {
  static override properties = scalarControlProperties;
  override accessor role: VectorRole = 'composition';
  private readonly scalar = new ScalarControlController(this);
  private readonly pointerDrag = new PointerDragController(this);
  @query('[data-rail]') private accessor railElement!: HTMLElement;
  static override styles = [vectorThemeStyles, railStyles];

  @state() private accessor _drag: RailDragState | null = null;

  constructor() {
    super();
    initializeScalarControl(this);
  }

  /** @deprecated Prefer the individual reactive properties. */
  set state(value: Partial<VectorConstraintRailState>) {
    this.scalar.setState(value);
  }
  get state(): VectorConstraintRailState {
    return this.scalar.state;
  }

  override render(): TemplateResult {
    if (!this.item) {
      return html` <div class="empty">Select an item.</div> `;
    }

    const domain = this.scalar.domain();
    const min = this.scalar.min();
    const max = this.scalar.max();
    const value = clamp(this.value, domain.min, domain.max);
    const locked = Boolean(this.constraint.locked);
    const view = this.scalar.viewState();
    const minPct = this.scalar.pct(min);
    const maxPct = this.scalar.pct(max);
    const valuePct = this.scalar.pct(value);
    const unit = view.unit;
    const itemColor = colorForItem(this.item, 0, this.palette);
    const minText = view.minText;
    const maxText = view.maxText;
    const valueText = view.valueText;
    const embedded = this.variant === 'embedded';
    const lockLabel = locked ? 'Unlock value' : 'Lock value';
    const lockButton = () => html`
      <button
        class=${classMap({ 'lock-button': true, locked })}
        data-lock
        type="button"
        aria-pressed=${String(locked)}
        aria-label=${lockLabel}
        title=${lockLabel}
        ?disabled=${this.disabled}
        @click=${() => this._toggleLock()}
      >
        ${locked ? LOCK_ICON : UNLOCK_ICON}
      </button>
    `;

    return html`
      <section
        class=${classMap({
          'rail-control': true,
          embedded,
          disabled: this.disabled,
          dragging: Boolean(this._drag),
        })}
        data-threshold=${view.thresholdKey || ''}
      >
        ${embedded
          ? ''
          : html`<header>
              <span
                class="swatch"
                ${styleVariables({ '--item-color': itemColor })}
              ></span>
              <strong>${this.item.label || labelize(this.item.key)}</strong>
              <output>${valueText}${unit}</output>
              ${lockButton()}
            </header>`}

        <div class="rail-body">
          <div class="rail" data-rail>
            <div class="full-track"></div>
            <div
              class="allowed-track"
              ${styleVariables({
                '--range-start': `${minPct}%`,
                '--range-width': `${Math.max(0, maxPct - minPct)}%`,
              })}
            ></div>
            <div class="threshold-track" aria-hidden="true">
              ${renderThresholdSegments({
                thresholds: this.thresholds,
                value: this.value,
                percent: (value) => this.scalar.pct(value),
                activeThreshold: (value) => this.scalar.thresholdFor(value),
              })}
            </div>
            ${this.defaultValue == null
              ? ''
              : html`<span
                  class="default-marker"
                  ${styleVariables({
                    '--rail-position': `${this.scalar.pct(this.defaultValue)}%`,
                  })}
                  title="Default"
                ></span>`}
            <button
              class=${classMap({
                handle: true,
                min: true,
                hit: Boolean(this.scalar.handleHitClass('min')),
                active: this._drag?.handle === 'min',
              })}
              data-handle="min"
              ${styleVariables({ '--rail-position': `${minPct}%` })}
              type="button"
              aria-label=${`Minimum ${minText}${unit}`}
              ?disabled=${this.disabled}
              @pointerdown=${(event: PointerEvent) =>
                this._startDrag(event, 'min')}
              @keydown=${(event: KeyboardEvent) => this._keydown(event, 'min')}
            >
              <span class="handle-label">min</span>
              <span class="handle-dot"></span>
              <span class="handle-value">${minText}${unit}</span>
            </button>
            <button
              class=${classMap({
                handle: true,
                value: true,
                locked,
                hit: Boolean(this.scalar.handleHitClass('value')),
                active: this._drag?.handle === 'value',
              })}
              data-handle="value"
              ${styleVariables({ '--rail-position': `${valuePct}%` })}
              type="button"
              aria-label=${`Value ${valueText}${unit}`}
              ?disabled=${this.disabled}
              @pointerdown=${(event: PointerEvent) =>
                this._startDrag(event, 'value')}
              @keydown=${(event: KeyboardEvent) =>
                this._keydown(event, 'value')}
            >
              <span class="handle-label">value</span>
              <span class="handle-dot">${locked ? LOCK_ICON : ''}</span>
              <span class="handle-value">${valueText}${unit}</span>
            </button>
            <button
              class=${classMap({
                handle: true,
                max: true,
                hit: Boolean(this.scalar.handleHitClass('max')),
                active: this._drag?.handle === 'max',
              })}
              data-handle="max"
              ${styleVariables({ '--rail-position': `${maxPct}%` })}
              type="button"
              aria-label=${`Maximum ${maxText}${unit}`}
              ?disabled=${this.disabled}
              @pointerdown=${(event: PointerEvent) =>
                this._startDrag(event, 'max')}
              @keydown=${(event: KeyboardEvent) => this._keydown(event, 'max')}
            >
              <span class="handle-label">max</span>
              <span class="handle-dot"></span>
              <span class="handle-value">${maxText}${unit}</span>
            </button>
          </div>
          ${embedded ? lockButton() : ''}
        </div>

        <div class="exact-row">
          <label
            >Min<input
              data-exact="min"
              type="number"
              min=${view.domainMinText}
              max=${view.domainMaxText}
              step=${view.displayStep}
              .value=${minText}
              ?disabled=${this.disabled}
              @change=${(event: Event) =>
                this._emitInputTarget(
                  'min',
                  Number((event.currentTarget as HTMLInputElement).value),
                  'vector-change',
                  transactionId('rail-input'),
                )}
          /></label>
          <label
            >Value<input
              data-exact="value"
              type="number"
              min=${view.domainMinText}
              max=${view.domainMaxText}
              step=${view.displayStep}
              .value=${valueText}
              ?disabled=${locked || this.disabled}
              @change=${(event: Event) =>
                this._emitInputTarget(
                  'value',
                  Number((event.currentTarget as HTMLInputElement).value),
                  'vector-change',
                  transactionId('rail-input'),
                )}
          /></label>
          <label
            >Max<input
              data-exact="max"
              type="number"
              min=${view.domainMinText}
              max=${view.domainMaxText}
              step=${view.displayStep}
              .value=${maxText}
              ?disabled=${this.disabled}
              @change=${(event: Event) =>
                this._emitInputTarget(
                  'max',
                  Number((event.currentTarget as HTMLInputElement).value),
                  'vector-change',
                  transactionId('rail-input'),
                )}
          /></label>
        </div>
        ${this.unitOptions.length > 1
          ? html`
              <label class="unit-row"
                >Unit
                <select
                  data-unit
                  .value=${this.scalar.unitOption()?.key || ''}
                  ?disabled=${this.disabled}
                  @change=${(event: Event) =>
                    this.scalar.changeUnit(
                      (event.currentTarget as HTMLSelectElement).value,
                    )}
                >
                  ${this.unitOptions.map(
                    (option) =>
                      html`<option
                        value=${option.key}
                        ?selected=${option.key ===
                        this.scalar.unitOption()?.key}
                      >
                        ${option.label}
                      </option>`,
                  )}
                </select>
              </label>
            `
          : nothing}
      </section>
    `;
  }

  private _startDrag(event: PointerEvent, handle: ScalarHandle): void {
    if (this.disabled || event.button > 0) {
      return;
    }
    event.preventDefault();
    if (handle === 'value' && this.constraint.locked) {
      this._emitLockedHit();
      return;
    }
    this._drag = {
      handle,
      transactionId: transactionId('rail'),
      startX: event.clientX,
      startValue: this.scalar.handleValue(handle),
      latestTarget: this.scalar.handleValue(handle),
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
    const rail = this.railElement;
    const width = Math.max(1, rail?.getBoundingClientRect?.().width || 1);
    const domain = this.scalar.domain();
    const delta =
      ((event.clientX - this._drag.startX) / width) * (domain.max - domain.min);
    const target = roundToStep(
      this._drag.startValue + delta,
      this.scalar.step(),
    );
    this._drag.latestTarget = target;
    this._emitHandleTarget(
      this._drag.handle,
      target,
      'vector-preview',
      this._drag.transactionId,
    );
  }

  private _dragEnd(): void {
    if (!this._drag) {
      return;
    }
    const handle = this._drag.handle;
    const transaction = this._drag.transactionId;
    const target = this._drag.latestTarget ?? this._drag.startValue;
    this._emitHandleTarget(handle, target, 'vector-change', transaction);
    this._drag = null;
    this.requestUpdate();
  }

  private _cancelDrag(): void {
    if (!this._drag) {
      return;
    }
    emitVectorEvent(this, 'vector-cancel', {
      source: 'constraint',
      role: this.role,
      transactionId: this._drag.transactionId,
      key: this.item?.key,
    });
    this._drag = null;
    this.requestUpdate();
  }

  private _keydown(event: KeyboardEvent, handle: ScalarHandle): void {
    if (this.disabled) {
      return;
    }
    const step = this.scalar.step();
    let target = null;
    if (
      (event.key === ' ' || event.key === 'Enter') &&
      handle === 'value' &&
      this.constraint.locked
    ) {
      event.preventDefault();
      this._toggleLock();
      return;
    }
    if (handle === 'value' && this.constraint.locked) {
      if (
        [
          'ArrowLeft',
          'ArrowDown',
          'ArrowRight',
          'ArrowUp',
          'Home',
          'End',
        ].includes(event.key)
      ) {
        event.preventDefault();
        this._emitLockedHit();
      }
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      target = this.scalar.handleValue(handle) + step;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      target = this.scalar.handleValue(handle) - step;
    } else if (event.key === 'Home') {
      target = this.scalar.domain().min;
    } else if (event.key === 'End') {
      target = this.scalar.domain().max;
    } else if (event.key === 'Escape') {
      this._cancelDrag();
    }
    if (target == null) {
      return;
    }
    event.preventDefault();
    const transaction = transactionId('rail-key');
    this._emitHandleTarget(handle, target, 'vector-preview', transaction);
    this._emitHandleTarget(handle, target, 'vector-change', transaction);
  }

  _emitHandleTarget(
    handle: ScalarHandle,
    rawTarget: number,
    eventName: Extract<VectorEventType, 'vector-preview' | 'vector-change'>,
    id: string,
  ): void {
    if (!this.item?.key) {
      return;
    }
    const unitOption = this.scalar.unitOption();
    if (handle === 'value') {
      if (this.constraint.locked) {
        this._emitLockedHit(id);
        return;
      }
      const target = roundToStep(rawTarget, this.scalar.step());
      const clamped = clamp(target, this.scalar.min(), this.scalar.max());
      const threshold = this.scalar.thresholdFor(clamped);
      const hits: ConstraintHit[] = [];
      if (target < this.scalar.min()) {
        hits.push(
          createHit(
            this.item.key,
            'min',
            `${this.item.label || labelize(this.item.key)} hit minimum ${round(this.scalar.toDisplay(this.scalar.min()), this.scalar.places())}${this.scalar.unit()}.`,
          ),
        );
      }
      if (target > this.scalar.max()) {
        hits.push(
          createHit(
            this.item.key,
            'max',
            `${this.item.label || labelize(this.item.key)} hit maximum ${round(this.scalar.toDisplay(this.scalar.max()), this.scalar.places())}${this.scalar.unit()}.`,
          ),
        );
      }
      const detail = {
        source: 'inspector',
        role: this.role,
        transactionId: id,
        key: this.item.key,
        previousValue: { [this.item.key]: this.value },
        requestedValue: { [this.item.key]: target },
        proposedValue: { [this.item.key]: clamped },
        delta: round(clamped - this.value, 4),
        unitKey: unitOption?.key,
        basis: unitOption?.basis ?? this.basis ?? this.item?.basis,
        measurementScope: unitOption?.scope ?? this.measurementScope,
        measurementMeasure: unitOption?.measure ?? this.measurementMeasure,
        displayValue: this.scalar.toDisplay(clamped),
        canonicalValue: clamped,
        thresholdKey: threshold?.key,
        measurementSystem: this.measurementSystem || unitOption?.system,
        hits,
      };
      emitVectorEvent(this, eventName, detail);
      if (hits.length) {
        emitVectorEvent(this, 'vector-constraint-hit', detail);
      }
      return;
    }

    const domain = this.scalar.domain();
    const target = roundToStep(
      clamp(rawTarget, domain.min, domain.max),
      this.scalar.step(),
    );
    const patch = handle === 'min' ? { min: target } : { max: target };
    emitVectorEvent(this, eventName, {
      source: 'constraint',
      role: 'constraint',
      transactionId: id,
      key: this.item.key,
      constraintRole: this.role,
      constraint: patch,
      unitKey: unitOption?.key,
      basis: unitOption?.basis || this.basis || this.item?.basis,
      measurementScope: unitOption?.scope || this.measurementScope,
      measurementMeasure: unitOption?.measure || this.measurementMeasure,
      displayValue: this.scalar.toDisplay(target),
      canonicalValue: target,
      measurementSystem: this.measurementSystem || unitOption?.system,
    });
  }

  _emitInputTarget(
    handle: ScalarHandle,
    displayTarget: number,
    eventName: Extract<VectorEventType, 'vector-preview' | 'vector-change'>,
    id: string,
  ): void {
    this._emitHandleTarget(
      handle,
      this.scalar.toCanonical(displayTarget),
      eventName,
      id,
    );
  }

  _toggleLock(): void {
    if (this.disabled) {
      return;
    }
    emitVectorEvent(this, 'vector-change', {
      source: 'constraint',
      role: 'constraint',
      transactionId: transactionId('rail-lock'),
      key: this.item?.key,
      constraintRole: this.role,
      constraint: { locked: !this.constraint.locked },
    });
  }

  _emitLockedHit(id = transactionId('rail-locked')): void {
    const hit = createHit(
      this.item?.key ?? 'constraint',
      'locked',
      `${this.item?.label ?? labelize(this.item?.key ?? 'constraint')} is locked.`,
    );
    emitVectorEvent(this, 'vector-constraint-hit', {
      source: 'constraint',
      role: this.role,
      transactionId: id,
      key: this.item?.key,
      unitKey: this.scalar.unitOption()?.key,
      basis: this.scalar.unitOption()?.basis || this.basis || this.item?.basis,
      measurementScope:
        this.scalar.unitOption()?.scope || this.measurementScope,
      measurementMeasure:
        this.scalar.unitOption()?.measure || this.measurementMeasure,
      measurementSystem:
        this.measurementSystem || this.scalar.unitOption()?.system,
      hits: [hit],
    });
  }
}

export interface VectorConstraintRail extends ScalarControlHost {}
