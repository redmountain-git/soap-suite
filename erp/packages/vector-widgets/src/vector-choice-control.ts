import { html, nothing, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import { choiceStyles } from './styles/choice.styles.generated';
import { VectorElement } from './vector-component-support';
import { emitVectorEvent, labelize, transactionId } from './vector-math';
import { vectorThemeStyles } from './vector-theme';
import type {
  ChoiceOption,
  ChoiceVectorItem,
  VectorChoiceState,
  VectorRole,
} from './vector-types';

export class VectorChoiceControl extends VectorElement {
  static override styles = [vectorThemeStyles, choiceStyles];

  @property({ attribute: false }) accessor item: ChoiceVectorItem | null;
  @property({ attribute: false }) accessor options: ChoiceOption[];
  @property({ attribute: false }) accessor value: string | number | boolean;
  @property({ attribute: false }) override accessor role: VectorRole;
  @property({ attribute: false }) accessor disabled: boolean;

  constructor() {
    super();
    this.item = null;
    this.options = [];
    this.value = '';
    this.role = 'choice';
    this.disabled = false;
    this.theme = {};
  }

  /** @deprecated Prefer individual reactive properties. */
  set state(value: Partial<VectorChoiceState>) {
    const state = value ?? {};
    this.item = state.item ?? null;
    this.options = state.options ?? state.item?.options ?? [];
    this.value = state.value ?? '';
    this.role = state.role ?? 'choice';
    this.disabled = state.disabled ?? false;
    this.theme = state.theme ?? {};
  }

  override render(): TemplateResult {
    return html`
      <div class="choice-control">
        ${this.item
          ? html`<strong>${this.item.label || labelize(this.item.key)}</strong>`
          : nothing}
        <div
          class="choices"
          role="group"
          aria-label=${this.item?.label || 'Choice'}
        >
          ${repeat(
            this.options,
            (option) => option.key ?? option.value ?? '',
            (option) => {
              const value = option.value ?? option.key ?? '';
              const selected = value === this.value;
              return html`
                <button
                  type="button"
                  class=${classMap({ selected })}
                  ?disabled=${this.disabled}
                  aria-pressed=${String(Boolean(selected))}
                  @click=${() => this._select(value, option)}
                >
                  ${option.label ?? labelize(String(value))}
                </button>
              `;
            },
          )}
        </div>
      </div>
    `;
  }

  private _select(
    value: string | number | boolean,
    option: ChoiceOption,
  ): void {
    emitVectorEvent(this, 'vector-change', {
      source: 'inspector',
      role: this.role,
      transactionId: transactionId('choice'),
      key: this.item?.key,
      value,
      option,
    });
  }
}
