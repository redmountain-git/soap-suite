import assert from 'node:assert/strict';
import { test } from 'vitest';
import { installDomStub } from './vector-test-helpers';

test('component registration is explicit and idempotent', async () => {
  installDomStub();
  const { defineVectorComponents } = await import('./define-vector-components');
  defineVectorComponents();
  const pieDefinition = customElements.get('vector-pie-chart');
  defineVectorComponents();
  assert.equal(customElements.get('vector-pie-chart'), pieDefinition);
});

test('public theme tokens inherit while the legacy theme adapter remains supported', async () => {
  installDomStub();
  const { VectorPieChart } = await import('./vector-components');
  const parent = document.createElement('div');
  parent.style.setProperty('--vector-accent', '#123456');
  const pie = new VectorPieChart();
  parent.append(pie);
  document.body.append(parent);
  await pie.updateComplete;
  assert.equal(parent.style.getPropertyValue('--vector-accent'), '#123456');
  assert.equal(pie.style.getPropertyValue('--vector-accent'), '');
  pie.remove();
  pie.theme = { accent: '#654321' };
  assert.equal(
    pie.getAttribute('style'),
    null,
    'disconnected custom elements must not gain constructor-time attributes',
  );
  parent.append(pie);
  assert.equal(pie.style.getPropertyValue('--vector-accent'), '#654321');
});
