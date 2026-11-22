import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  connect,
  flushRenderFrame,
  installDomStub,
} from './vector-test-helpers';
import type { VectorEventBase } from './vector-types';

test('constraint rail emits value, min/max, lock, and locked-hit events', async () => {
  installDomStub();
  const { VectorConstraintRail } = await import('./vector-components');
  const rail = connect(new VectorConstraintRail());
  rail.item = { key: 'coconut_oil', label: 'Coconut oil' };
  rail.value = 22;
  rail.constraint = { min: 5, max: 30, step: 0.1 };
  rail.role = 'composition';
  const events: Array<{ type: string; detail: VectorEventBase }> = [];
  rail.addEventListener('vector-change', (event) =>
    events.push({ type: event.type, detail: event.detail }),
  );
  rail.addEventListener('vector-preview', (event) =>
    events.push({ type: event.type, detail: event.detail }),
  );
  rail.addEventListener('vector-constraint-hit', (event) =>
    events.push({ type: event.type, detail: event.detail }),
  );

  rail._emitHandleTarget('value', 24, 'vector-preview', 'value-preview');
  rail._emitHandleTarget('min', 8, 'vector-preview', 'min-preview');
  rail._emitHandleTarget('min', 8, 'vector-change', 'min-change');
  rail._emitHandleTarget('max', 28, 'vector-change', 'max-change');
  rail._toggleLock();
  rail.constraint = { min: 5, max: 30, step: 0.1, locked: true };
  rail._emitHandleTarget('value', 25, 'vector-change', 'locked-change');

  assert.equal(events[0].type, 'vector-preview');
  assert.equal(events[0].detail.role, 'composition');
  assert.deepEqual(events[0].detail.proposedValue, { coconut_oil: 24 });
  assert.deepEqual(events[1].detail.constraint, { min: 8 });
  assert.equal(events[1].type, 'vector-preview');
  assert.deepEqual(events[2].detail.constraint, { min: 8 });
  assert.deepEqual(events[3].detail.constraint, { max: 28 });
  assert.deepEqual(events[4].detail.constraint, { locked: true });
  const lockedHit = events.find(
    (event) => event.type === 'vector-constraint-hit',
  );
  assert.ok(lockedHit?.detail.hits?.[0]);
  assert.equal(lockedHit.detail.hits[0].type, 'locked');
  assert.equal(
    events.some(
      (event) =>
        event.detail?.transactionId === 'locked-change' &&
        event.type === 'vector-change',
    ),
    false,
  );
});

test('constraint rail state batches renders and skips unchanged state', async () => {
  installDomStub();
  const { VectorConstraintRail } = await import('./vector-components');
  const rail = connect(new VectorConstraintRail());
  await rail.updateComplete;

  let renderCount = 0;
  const render = rail.render.bind(rail);
  rail.render = () => {
    renderCount += 1;
    return render();
  };
  const state = {
    item: { key: 'coconut_oil', label: 'Coconut oil' },
    value: 22,
    constraint: { min: 5, max: 30, step: 1 },
    role: 'composition',
    hits: [],
    rangeMin: 0,
    rangeMax: 100,
    precision: 0,
  };

  rail.state = state;
  rail.value = 23;
  rail.state = { ...state, value: 23 };

  assert.equal(renderCount, 0);
  await rail.updateComplete;
  assert.equal(renderCount, 1);

  rail.value = 23;
  await rail.updateComplete;
  assert.equal(renderCount, 1);
});

test('constraint rail updates canonically through Lit while a drag is active', async () => {
  installDomStub();
  const { VectorConstraintRail } = await import('./vector-components');
  const rail = connect(new VectorConstraintRail());
  await rail.updateComplete;
  let renderCount = 0;
  const render = rail.render.bind(rail);
  rail.render = () => {
    renderCount += 1;
    return render();
  };
  rail.item = { key: 'coconut_oil', label: 'Coconut oil' };
  rail.value = 22;
  rail.constraint = { min: 5, max: 30, step: 1 };
  rail.role = 'composition';
  rail.hits = [];
  rail.rangeMin = 0;
  rail.rangeMax = 100;
  rail.precision = 0;
  rail.state = {
    ...rail.state,
    value: 24,
    constraint: { min: 10, max: 30, step: 1 },
    hits: [
      { key: 'coconut_oil', type: 'min', severity: 'hard', message: 'minimum' },
    ],
  };

  await rail.updateComplete;
  assert.equal(renderCount, 1);
  assert.equal(
    rail
      .shadowRoot!.querySelector<HTMLElement>('.allowed-track')
      ?.style.getPropertyValue('--range-start'),
    '10%',
  );
  assert.equal(
    rail
      .shadowRoot!.querySelector<HTMLElement>('[data-handle="value"]')
      ?.style.getPropertyValue('--rail-position'),
    '24%',
  );
  assert.equal(
    rail.shadowRoot!.querySelector<HTMLElement>('output')?.textContent,
    '24%',
  );
  assert.equal(
    rail
      .shadowRoot!.querySelector<HTMLElement>('[data-handle="min"]')
      ?.classList.contains('hit'),
    true,
  );
});

test('embedded constraint rail is compact and uses icon-only lock control', async () => {
  installDomStub();
  const { VectorConstraintRail } = await import('./vector-components');
  const rail = connect(new VectorConstraintRail());
  rail.state = {
    item: { key: 'coconut_oil', label: 'Coconut oil' },
    value: 22,
    constraint: { min: 5, max: 30, step: 1 },
    role: 'composition',
    rangeMin: 0,
    rangeMax: 100,
    precision: 0,
    variant: 'embedded',
  };
  await flushRenderFrame();

  assert.ok(
    rail.shadowRoot!.querySelector<HTMLElement>('.rail-control.embedded'),
  );
  assert.equal(rail.shadowRoot!.querySelector<HTMLElement>('strong'), null);
  const lockButton = rail.shadowRoot!.querySelector<HTMLElement>('[data-lock]');
  assert.equal(lockButton?.getAttribute('aria-label'), 'Lock value');
  assert.equal(lockButton?.textContent?.trim(), String.fromCodePoint(0x1f513));
  assert.ok(rail.shadowRoot!.querySelector<HTMLElement>('[data-exact="min"]'));
});
