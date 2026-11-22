import { html, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { feedbackStyles } from './styles/feedback.styles.generated';
import { VectorElement } from './vector-component-support';
import { emitVectorEvent, transactionId } from './vector-math';
import { vectorThemeStyles } from './vector-theme';
import type { ConstraintHit } from './vector-types';

export class ConstraintFeedbackList extends VectorElement {
  static override styles = [vectorThemeStyles, feedbackStyles];

  @property({ attribute: false }) accessor hits: ConstraintHit[];

  constructor() {
    super();
    this.hits = [];
    this.theme = {};
  }

  override render(): TemplateResult {
    return html`
      <div class="feedback">
        ${this.hits.length
          ? repeat(
              this.hits,
              (hit) => `${hit.key}:${hit.type}:${hit.message}`,
              (hit) => html`
                <button
                  class=${hit.severity || 'hard'}
                  data-key=${hit.key}
                  @click=${() => this._selectHit(hit.key)}
                >
                  ${hit.message}
                </button>
              `,
            )
          : html`<span class="quiet">No active constraints.</span>`}
      </div>
    `;
  }

  private _selectHit(key: string): void {
    emitVectorEvent(this, 'vector-select', {
      source: 'constraint',
      role: 'selection',
      transactionId: transactionId('feedback'),
      key,
    });
  }
}
