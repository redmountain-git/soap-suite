import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  connect,
  flushRenderFrame,
  installDomStub,
} from './vector-test-helpers';
import type { VectorEventBase } from './vector-types';

test('unit toggle, item list, amount list, choice control, and summary meter emit generic events', async () => {
  installDomStub();
  const {
    VectorAmountList,
    VectorChoiceControl,
    VectorIngredientList,
    VectorQuantityInput,
    VectorSummaryMeter,
    VectorUnitToggle,
  } = await import('./vector-components');
  const events: Array<{ type: string; detail: VectorEventBase }> = [];
  const capture = (event: CustomEvent<VectorEventBase>) =>
    events.push({ type: event.type, detail: event.detail });

  const toggle = connect(new VectorUnitToggle());
  toggle.addEventListener('vector-change', capture);
  toggle.state = {
    options: [
      {
        key: 'metric',
        label: 'Metric',
        system: 'metric',
        basis: 'weight',
        symbol: 'g',
      },
      {
        key: 'imperial',
        label: 'Imperial',
        system: 'imperial',
        basis: 'weight',
        symbol: 'oz',
      },
    ],
    unitKey: 'metric',
  };
  await flushRenderFrame();
  toggle
    .shadowRoot!.querySelector<HTMLElement>('button:not(.selected)')
    ?.click();

  const list = connect(new VectorIngredientList());
  list.addEventListener('vector-change', capture);
  list.state = {
    items: [
      {
        key: 'kaolin',
        label: 'Kaolin clay',
        type: 'clay',
        category: 'additive',
        tags: ['clay'],
      },
    ],
    selectedKeys: [],
    listType: 'ingredient',
    activeTags: ['clay'],
  };
  await flushRenderFrame();
  list.shadowRoot!.querySelector<HTMLElement>("[data-key='kaolin']")?.click();

  const amountList = connect(new VectorAmountList());
  amountList.state = {
    items: [
      {
        key: 'kaolin',
        label: 'Kaolin clay',
        defaultValue: 0.6,
        unitOptions: [
          {
            key: 'percent_oils',
            label: '%',
            basis: 'percent_oils',
            symbol: '%',
          },
        ],
      },
    ],
    values: { kaolin: 0.6 },
    constraints: { kaolin: { min: 0, max: 2, step: 0.1 } },
    role: 'additive',
  };
  await flushRenderFrame();
  assert.ok(
    amountList.shadowRoot!.querySelector<HTMLElement>('vector-value-slider'),
  );
  assert.equal(
    amountList.shadowRoot!.querySelector<HTMLElement>('vector-scalar-rail'),
    null,
  );

  const constraintAmountList = connect(new VectorAmountList());
  constraintAmountList.state = {
    items: [
      {
        key: 'kaolin',
        label: 'Kaolin clay',
        defaultValue: 0.6,
        unitOptions: [
          {
            key: 'percent_oils',
            label: '%',
            basis: 'percent_oils',
            symbol: '%',
          },
        ],
      },
    ],
    values: { kaolin: 0.6 },
    constraints: { kaolin: { min: 0, max: 2, step: 0.1 } },
    role: 'additive',
    control: 'constraint',
  };
  await flushRenderFrame();
  assert.ok(
    constraintAmountList.shadowRoot!.querySelector<HTMLElement>(
      'vector-scalar-rail',
    ),
  );

  const quantity = connect(new VectorQuantityInput());
  quantity.addEventListener('vector-change', capture);
  quantity.state = {
    item: {
      key: 'oil_weight_g',
      label: 'Oil weight',
      min: 250,
      max: 10000,
      unitOptions: [
        {
          key: 'g',
          label: 'g',
          system: 'metric',
          basis: 'weight',
          measure: 'weight',
          symbol: ' g',
          precision: 0,
          step: 25,
        },
        {
          key: 'oz',
          label: 'oz',
          system: 'imperial',
          basis: 'weight',
          measure: 'weight',
          symbol: ' oz',
          precision: 1,
          step: 1,
          fromCanonical: (value) => value / 28.3495,
          toCanonical: (value) => value * 28.3495,
        },
      ],
    },
    value: 1800,
    constraint: { min: 250, max: 10000, step: 25 },
    measurementSystem: 'imperial',
    basis: 'weight',
    measurementMeasure: 'weight',
    role: 'formula',
  };
  await flushRenderFrame();
  assert.equal(
    quantity.shadowRoot!.querySelector<HTMLInputElement>('[data-quantity]')
      ?.value,
    '63.5',
  );
  assert.equal(
    quantity.shadowRoot!.querySelector<HTMLElement>('.unit-suffix')
      ?.textContent,
    ' oz',
  );

  const choice = connect(new VectorChoiceControl());
  choice.addEventListener('vector-change', capture);
  choice.state = {
    item: { key: 'lye_type', label: 'Lye type' },
    options: [
      { key: 'naoh', label: 'NaOH' },
      { key: 'koh', label: 'KOH' },
    ],
    value: 'naoh',
    role: 'formula_choice',
  };
  await flushRenderFrame();
  choice
    .shadowRoot!.querySelector<HTMLElement>('button:not(.selected)')
    ?.click();

  const summary = connect(new VectorSummaryMeter());
  summary.addEventListener('vector-select', capture);
  summary.items = [
    {
      key: 'total_additives',
      label: 'Additive load',
      value: 6,
      min: 0,
      max: 10,
      unit: '%',
      precision: 1,
      thresholds: [{ key: 'busy', min: 5, max: 8, severity: 'warn' }],
    },
  ];
  await flushRenderFrame();
  summary
    .shadowRoot!.querySelector<HTMLElement>("[data-key='total_additives']")
    ?.click();

  assert.ok(
    events.some(
      (event) =>
        event.detail.role === 'measurement' &&
        event.detail.measurementSystem === 'imperial',
    ),
  );
  assert.ok(
    events.some(
      (event) =>
        event.detail.role === 'selection' &&
        event.detail.listType === 'ingredient',
    ),
  );
  assert.ok(
    events.some(
      (event) =>
        event.detail.role === 'formula_choice' && event.detail.value === 'koh',
    ),
  );
  assert.ok(
    events.some(
      (event) =>
        event.type === 'vector-select' &&
        event.detail.role === 'summary' &&
        event.detail.thresholdKey === 'busy',
    ),
  );
});
