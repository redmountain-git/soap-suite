import { createDemoWorkspace } from '@rmsc/domain-core';
import type { VectorPieChart } from '@rmsc/vector-widgets';
import { RecipeVectorWorkbench } from './recipe-vector-workbench.element';

describe('RecipeVectorWorkbench', () => {
  let element: RecipeVectorWorkbench;

  beforeEach(async () => {
    element = new RecipeVectorWorkbench();
    element.workspace = createDemoWorkspace();
    document.body.append(element);
    await element.updateComplete;
  });

  afterEach(() => element.remove());

  it('renders connected Lit children from canonical properties', () => {
    const pie =
      element.shadowRoot?.querySelector<VectorPieChart>('vector-pie-chart');
    expect(pie?.items.length).toBeGreaterThan(0);
    expect(Object.keys(pie?.value ?? {})).toContain('olive_oil');
    expect(pie?.getAttribute('state')).toBeNull();
  });

  it('batches public property updates and handles composed vector events', async () => {
    element.palette = ['#111111', '#222222'];
    element.theme = { accentStrong: '#123456' };
    const pending = element.updateComplete;
    expect(element.updateComplete).toBe(pending);
    await pending;

    const pie =
      element.shadowRoot?.querySelector<VectorPieChart>('vector-pie-chart');
    pie?.dispatchEvent(
      new CustomEvent('vector-select', {
        detail: {
          source: 'pie',
          role: 'composition',
          transactionId: 'workbench-test',
          key: 'coconut_oil',
        },
        bubbles: true,
        composed: true,
      }),
    );
    await element.updateComplete;

    expect(pie?.palette).toEqual(['#111111', '#222222']);
    expect(pie?.selectedKey).toBe('coconut_oil');
    expect(element.style.getPropertyValue('--vector-accent-strong')).toBe(
      '#123456',
    );
  });

  it('disconnects and reconnects without losing reactive state', async () => {
    element.remove();
    document.body.append(element);
    await element.updateComplete;
    expect(
      element.shadowRoot?.querySelector('vector-radar-chart'),
    ).not.toBeNull();
  });
});
