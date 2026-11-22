import { css, html } from 'lit';
import { calendarDate } from '@rmsc/domain-core';
import type { Batch, Workspace } from '@rmsc/worker-protocol';

export const weightFormStyles = css`
  :host {
    display: block;
    min-width: 0;
    color: inherit;
    font: inherit;
  }
  * {
    box-sizing: border-box;
  }
  h3 {
    margin: 0;
    font-size: 1rem;
  }
  p {
    margin: 0.5rem 0;
  }
  form,
  .groups {
    display: grid;
    gap: 0.75rem;
  }
  form {
    padding: 0.85rem 0;
  }
  .group {
    min-width: 0;
    margin: 0;
    border: 1px solid #c7d1cb;
    border-radius: 4px;
    padding: 0.6rem;
  }
  legend {
    padding: 0 0.25rem;
    font-weight: 600;
  }
  .pair {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  label {
    display: grid;
    min-width: 0;
    gap: 0.25rem;
    font-size: 0.875rem;
  }
  input,
  button {
    font: inherit;
    color: inherit;
    background: #fff;
    border: 1px solid #a9bab0;
    border-radius: 4px;
    padding: 0.45rem 0.55rem;
    min-height: 2.5rem;
  }
  input {
    width: 100%;
    min-width: 0;
  }
  button {
    cursor: pointer;
  }
  button.primary {
    background: #245548;
    color: #fff;
  }
  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  summary {
    cursor: pointer;
    padding: 0.35rem 0;
  }
  .error {
    color: #a32e25;
  }
  .muted {
    color: #52635b;
    font-size: 0.875rem;
  }
  .history {
    list-style: none;
    margin: 0.35rem 0;
    padding: 0;
  }
  .history li {
    border-top: 1px solid #d7dfda;
    padding: 0.45rem 0;
  }
  .reading {
    display: block;
  }
  @media (min-width: 620px) {
    .groups {
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
    }
  }
`;

export function workspaceDay(workspace: Workspace | null) {
  const timeZone = workspace?.['timeZone'];
  return calendarDate(
    new Date(),
    typeof timeZone === 'string' ? timeZone : undefined,
  );
}

export function sizeLabel(workspace: Workspace | null, size: string) {
  return workspace?.bar_sizes?.[size]?.display_name || size;
}

export function groupTitle(
  workspace: Workspace | null,
  batch: Batch | undefined,
  size: string,
) {
  const label = sizeLabel(workspace, size);
  const labelForMold = batch?.formulation?.molds?.find(
    (mold) => mold.barSize === size,
  )?.label;
  return labelForMold ? `${labelForMold} (${label})` : label;
}

export function barWeightRow(
  size: string,
  title: string,
  label: string,
  count: number,
  weight?: number,
) {
  return html`<fieldset class="group">
    <legend>${title}</legend>
    <div class="pair">
      <label
        >Count<input
          aria-label=${label}
          name=${`size-${size}`}
          type="number"
          min="0"
          step="1"
          value=${count}
          required
      /></label>
      <label
        >Total (g)<input
          aria-label=${`Total weight for ${label}`}
          name=${`weight-${size}`}
          type="number"
          min="0.1"
          step="any"
          inputmode="decimal"
          value=${weight ?? ''}
      /></label>
    </div>
  </fieldset>`;
}

export function readBarWeights(data: FormData) {
  const weightGBySize: Record<string, number> = {};
  const sizeCounts: Record<string, number> = {};
  for (const [key, value] of data) {
    if (key.startsWith('weight-') && value !== '')
      weightGBySize[key.slice(7)] = Number(value);
    if (key.startsWith('size-')) sizeCounts[key.slice(5)] = Number(value);
  }
  return { sizeCounts, weightGBySize };
}

export function grams(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
    value,
  );
}
