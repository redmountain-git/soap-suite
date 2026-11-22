import { html } from 'lit';
import { property } from 'lit/decorators.js';
import { VectorElement } from './vector-component-support';
import type { VectorConstraintRailState } from './vector-types';
import { vectorScalarRailStyles } from './vector-scalar-rail.styles.generated';

/** Compatibility wrapper for the legacy vector-scalar-rail tag. */
export class VectorScalarRail extends VectorElement {
  static override styles = vectorScalarRailStyles;

  @property({ attribute: false })
  accessor state: Partial<VectorConstraintRailState> = {};

  override render() {
    return html`<vector-constraint-rail
      .item=${this.state.item ?? null}
      .value=${this.state.value ?? 0}
      .constraint=${this.state.constraint ?? {}}
      .role=${this.state.role ?? 'composition'}
      .hits=${this.state.hits ?? []}
      .rangeMin=${this.state.rangeMin ?? 0}
      .rangeMax=${this.state.rangeMax ?? 100}
      .precision=${this.state.precision ?? null}
      .defaultValue=${this.state.defaultValue ?? null}
      .thresholds=${this.state.thresholds ?? []}
      .unitOptions=${this.state.unitOptions ?? []}
      .unitKey=${this.state.unitKey ?? ''}
      .measurementSystem=${this.state.measurementSystem ?? ''}
      .basis=${this.state.basis ?? ''}
      .measurementScope=${this.state.measurementScope ?? ''}
      .measurementMeasure=${this.state.measurementMeasure ?? ''}
      .context=${this.state.context ?? null}
      .disabled=${this.state.disabled ?? false}
      .palette=${this.state.palette}
      .variant=${this.state.variant ?? 'default'}
      .unitDisplay=${this.state.unitDisplay ?? 'picker'}
      .activeEmphasis=${this.state.activeEmphasis ?? true}
    ></vector-constraint-rail>`;
  }
}
