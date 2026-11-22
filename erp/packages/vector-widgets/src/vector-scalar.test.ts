import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  connect,
  flushRenderFrame,
  installDomStub,
} from './vector-test-helpers';
import type { VectorChangeDetail } from './vector-types';

test('value slider renders thresholds and emits canonical values with unit metadata', async () => {
  installDomStub();
  const { VectorValueSlider } = await import('./vector-components');
  const rail = connect(new VectorValueSlider());
  const events: VectorChangeDetail[] = [];
  rail.addEventListener('vector-change', (event) => events.push(event.detail));
  rail.state = {
    item: {
      key: 'fragrance',
      label: 'Fragrance',
      summary: 'Scent load for the finished bar.',
      defaultValue: 3.1,
      unitOptions: [
        {
          key: 'percent_oils',
          label: '% oils',
          basis: 'percent_oils',
          symbol: '%',
          precision: 1,
          step: 0.1,
        },
        {
          key: 'g_per_kg',
          label: 'g/kg',
          system: 'metric',
          basis: 'weight',
          symbol: ' g/kg',
          precision: 0,
          step: 1,
          fromCanonical: (value) => value * 10,
          toCanonical: (value) => value / 10,
        },
      ],
      thresholds: [
        { key: 'ok', min: 0, max: 4, severity: 'ok' },
        { key: 'high', min: 4.1, max: 6, severity: 'warn' },
      ],
    },
    value: 3.1,
    defaultValue: 3.1,
    constraint: { min: 0, max: 6, step: 0.1 },
    unitKey: 'g_per_kg',
    role: 'additive',
    rangeMin: 0,
    rangeMax: 6,
  };
  await flushRenderFrame();

  assert.equal(rail.shadowRoot!.querySelectorAll('.threshold-band').length, 2);
  assert.equal(
    rail.shadowRoot!.querySelector<HTMLElement>('[data-lock]'),
    null,
  );
  assert.equal(
    rail.shadowRoot!.querySelector<HTMLElement>('[data-exact]'),
    null,
  );
  assert.equal(
    rail.shadowRoot!.querySelector<HTMLElement>('select[data-unit]'),
    null,
  );
  assert.equal(
    rail.shadowRoot!.querySelector<HTMLInputElement>('[data-slider]')?.value,
    '31',
  );
  assert.equal(
    rail
      .shadowRoot!.querySelector<HTMLElement>('[data-unit]')
      ?.getAttribute('data-unit-key'),
    'g_per_kg',
  );
  assert.equal(
    rail
      .shadowRoot!.querySelector<HTMLElement>('.value-slider')
      ?.classList.contains('active'),
    true,
  );
  assert.equal(
    rail.shadowRoot!.querySelector<HTMLElement>('small')?.textContent,
    'Scent load for the finished bar.',
  );

  rail.state = {
    ...rail.state,
    unitDisplay: 'text',
    activeEmphasis: false,
  };
  await flushRenderFrame();

  assert.equal(
    rail
      .shadowRoot!.querySelector<HTMLElement>('.value-slider')
      ?.classList.contains('active'),
    false,
  );
  assert.equal(
    rail
      .shadowRoot!.querySelector<HTMLElement>('.unit-text')
      ?.getAttribute('data-unit-key'),
    'g_per_kg',
  );
  assert.equal(rail.shadowRoot!.querySelector<HTMLElement>('.unit-pill'), null);

  rail._emitSliderValue(42, 'vector-change', 'scalar-unit');

  assert.equal(events[0].role, 'additive');
  assert.equal(events[0].unitKey, 'g_per_kg');
  assert.equal(events[0].basis, 'weight');
  assert.equal(events[0].canonicalValue, 4.2);
  assert.equal(events[0].displayValue, 42);
  assert.equal(events[0].thresholdKey, 'high');
  assert.deepEqual(events[0].proposedValue, { fragrance: 4.2 });
});

test('value slider unit pill changes the displayed unit', async () => {
  installDomStub();
  const { VectorValueSlider } = await import('./vector-components');
  const rail = connect(new VectorValueSlider());
  const events: VectorChangeDetail[] = [];
  rail.addEventListener('vector-change', (event) => events.push(event.detail));
  rail.state = {
    item: {
      key: 'fragrance',
      label: 'Fragrance',
      defaultUnitKey: 'g_per_kg',
      unitOptions: [
        {
          key: 'g_per_kg',
          label: 'g/kg oils',
          system: 'metric',
          basis: 'weight',
          scope: 'oils',
          measure: 'weight',
          symbol: ' g/kg',
          precision: 0,
          step: 1,
          fromCanonical: (value) => value * 10,
          toCanonical: (value) => value / 10,
        },
        {
          key: 'g_batch',
          label: 'g',
          system: 'metric',
          basis: 'weight',
          scope: 'batch',
          measure: 'weight',
          symbol: ' g',
          precision: 1,
          step: 1,
          fromCanonical: (value) => value * 18,
          toCanonical: (value) => value / 18,
        },
      ],
    },
    value: 3,
    constraint: { min: 0, max: 6, step: 0.1 },
    unitKey: 'g_per_kg',
    measurementSystem: 'metric',
    basis: 'weight',
    measurementScope: 'oils',
    measurementMeasure: 'weight',
    role: 'additive',
  };
  await flushRenderFrame();

  assert.equal(
    rail
      .shadowRoot!.querySelector<HTMLElement>('[data-unit]')
      ?.getAttribute('data-unit-key'),
    'g_per_kg',
  );
  assert.match(
    rail.shadowRoot!.querySelector<HTMLElement>('.slider-value')?.textContent ||
      '',
    /30\s*g\/kg/,
  );

  rail
    .shadowRoot!.querySelector<HTMLElement>("[data-unit-option='g_batch']")
    ?.click();

  assert.equal(events[0].role, 'measurement');
  assert.equal(events[0].key, 'fragrance');
  assert.equal(events[0].unitKey, 'g_batch');
  await flushRenderFrame();
  assert.equal(
    rail
      .shadowRoot!.querySelector<HTMLElement>('[data-unit]')
      ?.getAttribute('data-unit-key'),
    'g_batch',
  );
});
