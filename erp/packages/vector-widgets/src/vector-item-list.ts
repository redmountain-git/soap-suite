import { html, nothing, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleVariables } from './style-variables';
import { listStyles } from './styles/list.styles.generated';
import { VectorElement } from './vector-component-support';
import { DEFAULT_VECTOR_PALETTE } from './vector-constants';
import { colorForItem } from './vector-formatting';
import { emitVectorEvent, transactionId } from './vector-math';
import { vectorThemeStyles } from './vector-theme';
import type { VectorItem, VectorItemListState } from './vector-types';

export class VectorItemList extends VectorElement {
  static override styles = [vectorThemeStyles, listStyles];

  @property({ attribute: false }) accessor items: VectorItem[];
  @property({ attribute: false }) accessor selectedKeys: string[];
  @property({ attribute: false }) accessor query: string;
  @property({ attribute: false }) accessor activeTags: string[];
  @property({ attribute: false }) accessor itemTypes: string[];
  @property({ attribute: false }) accessor listType: string;
  @property({ attribute: false }) accessor searchPlaceholder: string;
  @property({ attribute: false }) accessor palette: readonly string[];

  constructor() {
    super();
    this.items = [];
    this.selectedKeys = [];
    this.query = '';
    this.activeTags = [];
    this.itemTypes = [];
    this.listType = 'item';
    this.searchPlaceholder = 'Search items';
    this.theme = {};
    this.palette = DEFAULT_VECTOR_PALETTE;
  }

  /** @deprecated Prefer individual reactive properties. */
  set state(value: Partial<VectorItemListState>) {
    this.items = value?.items ?? [];
    this.selectedKeys = value?.selectedKeys ?? [];
    this.query = value?.query ?? '';
    this.activeTags = value?.activeTags ?? [];
    this.itemTypes = value?.itemTypes ?? [];
    this.listType = value?.listType ?? 'item';
    this.searchPlaceholder = value?.searchPlaceholder ?? 'Search items';
    this.theme = value?.theme ?? {};
    this.palette = value?.palette ?? DEFAULT_VECTOR_PALETTE;
  }

  override render(): TemplateResult {
    const selected = new Set(this.selectedKeys);
    const query = this.query.toLowerCase();
    const items = this.items.filter((item) => {
      const matchesQuery =
        !query ||
        item.label.toLowerCase().includes(query) ||
        item.key.toLowerCase().includes(query);
      const matchesTags =
        !this.activeTags.length ||
        this.activeTags.every((tag) => item.tags?.includes(tag));
      const itemType = item.type || item.category || '';
      const matchesType =
        !this.itemTypes.length || this.itemTypes.includes(itemType);
      return matchesQuery && matchesTags && matchesType;
    });
    return html`
      <div class="search-list">
        <input
          class="search"
          type="search"
          placeholder=${this.searchPlaceholder}
          .value=${this.query}
          @input=${this._queryChanged}
        />
        <div class="items">
          ${repeat(
            items,
            (item) => item.key,
            (item, index) => html`
              <button
                class=${classMap({
                  'oil-row': true,
                  selected: selected.has(item.key),
                })}
                data-key=${item.key}
                @click=${() => this._toggle(item.key)}
              >
                <span
                  class="swatch"
                  ${styleVariables({
                    '--item-color': colorForItem(item, index, this.palette),
                  })}
                ></span>
                <span
                  ><span class="item-label">${item.label}</span
                  >${item.category || item.type
                    ? html`<small>${item.category || item.type}</small>`
                    : nothing}</span
                >
                <strong>${selected.has(item.key) ? 'Remove' : 'Add'}</strong>
              </button>
            `,
          )}
        </div>
      </div>
    `;
  }

  private _queryChanged = (event: Event): void => {
    this.query = (event.currentTarget as HTMLInputElement).value;
  };

  private _toggle(key: string): void {
    const selected = new Set(this.selectedKeys);
    const action = selected.has(key) ? 'remove' : 'add';
    if (selected.has(key)) {
      selected.delete(key);
    } else {
      selected.add(key);
    }
    emitVectorEvent(this, 'vector-change', {
      source: 'list',
      role: 'selection',
      transactionId: transactionId('list'),
      key,
      selection: [...selected],
      action,
      listType: this.listType,
      itemType:
        this.items.find((item) => item.key === key)?.type ??
        this.items.find((item) => item.key === key)?.category,
    });
  }
}
