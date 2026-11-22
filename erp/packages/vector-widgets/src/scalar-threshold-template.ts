import { html } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleVariables } from './style-variables';
import type { ThresholdBand } from './vector-types';

export interface ThresholdTemplateHost {
  thresholds: ThresholdBand[];
  value: number;
  percent(value: number): number;
  activeThreshold(value: number): ThresholdBand | null;
}

export function renderThresholdSegments(host: ThresholdTemplateHost) {
  return repeat(
    host.thresholds,
    (threshold) => threshold.key,
    (threshold) => {
      const minPct = host.percent(threshold.min);
      const maxPct = host.percent(threshold.max);
      const active = host.activeThreshold(host.value)?.key === threshold.key;
      return html`
        <span
          class=${classMap({
            'threshold-band': true,
            [threshold.severity ?? 'ok']: true,
            active,
          })}
          ${styleVariables({
            '--threshold-start': `${minPct}%`,
            '--threshold-width': `${Math.max(0, maxPct - minPct)}%`,
            '--threshold-color': threshold.color ?? null,
          })}
          title=${threshold.label ?? threshold.key}
        ></span>
      `;
    },
  );
}
