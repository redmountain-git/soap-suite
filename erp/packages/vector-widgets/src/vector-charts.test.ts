import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  connect,
  defaultTestConstraints,
  fakeDecorator,
  flushRenderFrame,
  installDomStub,
} from './vector-test-helpers';
import type { VectorChangeDetail } from './vector-types';

test('custom elements can be constructed and emit basic vector events', async () => {
  installDomStub();
  const components = await import('./vector-components');
  const pie = connect(new components.VectorPieChart());
  let change: VectorChangeDetail | null = null;
  pie.addEventListener('vector-change', (event) => {
    change = event.detail;
  });
  pie.items = [
    { key: 'olive_oil', label: 'Olive oil' },
    { key: 'coconut_oil', label: 'Coconut oil' },
  ];
  pie.value = { olive_oil: 70, coconut_oil: 30 };
  pie.centerValue = 145;
  pie.centerLabel = 'INS';
  pie.centerPrecision = 0;
  pie.constraints = defaultTestConstraints(['olive_oil', 'coconut_oil']);
  pie._wheel(new WheelEvent('wheel', { deltaY: 1 }), 'coconut_oil');
  await flushRenderFrame();

  const radar = connect(new components.VectorRadarChart());
  radar.axes = [{ key: 'bubbly', label: 'Bubbly', min: 0, max: 70, step: 1 }];
  radar.value = { bubbly: 20 };
  radar.previewValue = { bubbly: 25 };
  radar.targetValue = { bubbly: 30 };

  const control = connect(new components.VectorConstraintControl());
  control.item = { key: 'coconut_oil', label: 'Coconut oil' };
  control.value = 30;
  control.constraint = { min: 5, max: 30, step: 0.1 };

  const rail = connect(new components.VectorConstraintRail());
  rail.item = { key: 'coconut_oil', label: 'Coconut oil' };
  rail.value = 22;
  rail.constraint = { min: 5, max: 30, step: 0.1 };
  rail.role = 'composition';
  rail.precision = 1;
  await flushRenderFrame();

  const changeDetail = change as VectorChangeDetail | null;
  assert.ok(changeDetail);
  assert.equal(changeDetail.source, 'pie');
  assert.equal(changeDetail.role, 'composition');
  assert.ok(customElements.get('vector-pie-chart'));
  assert.ok(customElements.get('vector-radar-chart'));
  assert.ok(customElements.get('vector-constraint-control'));
  assert.ok(customElements.get('vector-constraint-rail'));
  assert.equal(
    pie.shadowRoot!.querySelector<HTMLElement>('.center')?.textContent?.trim(),
    '145',
  );
  assert.equal(
    pie
      .shadowRoot!.querySelector<HTMLElement>('.center-label')
      ?.textContent?.trim(),
    'INS',
  );
  assert.equal(
    rail.shadowRoot!.querySelector<HTMLElement>(
      '[data-handle="value"] .handle-value',
    )?.textContent,
    '22.0%',
  );
});

test('pie renders slots, positions decorators, and radar renders value labels', async () => {
  installDomStub();
  const { VectorPieChart, VectorRadarChart } = await import(
    './vector-components'
  );
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const pie = connect(new VectorPieChart());
  pie.theme = { accent: '#123456' };
  pie.items = [
    { key: 'olive_oil', label: 'Olive oil' },
    { key: 'coconut_oil', label: 'Coconut oil' },
  ];
  pie.value = { olive_oil: 70, coconut_oil: 30 };
  pie.constraints = {
    olive_oil: { min: 0, max: 100, step: 1, locked: true },
    coconut_oil: { min: 0, max: 100, step: 1 },
  };
  pie.precision = 0;
  await flushRenderFrame();

  const wedges = [...pie.shadowRoot!.querySelectorAll('path.slice')];
  assert.equal(wedges.length, 2);
  wedges.forEach((wedge) => {
    assert.equal(wedge.namespaceURI, svgNamespace);
    assert.match(wedge.getAttribute('d') || '', /^M /);
    assert.doesNotMatch(wedge.getAttribute('d') || '', /NaN|Infinity/);
  });
  assert.ok(
    pie.shadowRoot!.querySelector<HTMLElement>('slot[name="slice-decorator"]'),
  );
  assert.ok(
    pie.shadowRoot!.querySelector<HTMLElement>('slot[name="after-legend"]'),
  );
  assert.equal(pie.style.getPropertyValue('--vector-accent'), '#123456');
  assert.equal(pie._decoratorPositions.has('olive_oil'), true);

  const knownDecorator = fakeDecorator('olive_oil', { lockBadge: '' });
  const limitDecorator = fakeDecorator('olive_oil', {
    limitBadge: '',
    limitType: 'min',
  });
  const unknownDecorator = fakeDecorator('unknown_oil');
  const shadow = pie.shadowRoot as unknown as {
    querySelector(selector: string): { assignedElements(): Element[] } | null;
  };
  shadow.querySelector = (selector: string) =>
    selector === 'slot[name="slice-decorator"]'
      ? {
          assignedElements: () =>
            [
              limitDecorator,
              knownDecorator,
              unknownDecorator,
            ] as unknown as Element[],
        }
      : null;
  pie.positionDecorators();

  assert.equal(knownDecorator.hidden, false);
  assert.match(knownDecorator.style.props['--decorator-x'], /%$/);
  assert.match(knownDecorator.style.props['--decorator-y'], /%$/);
  assert.equal(knownDecorator.style.props['--decorator-offset-x'], '-9px');
  assert.equal(limitDecorator.style.props['--decorator-offset-x'], '9px');
  assert.equal(unknownDecorator.hidden, true);

  const radar = connect(new VectorRadarChart());
  radar.axes = [
    { key: 'bubbly', label: 'Bubbly', min: 0, max: 70, step: 1 },
    { key: 'hardness', label: 'Hardness', min: 0, max: 80, step: 1 },
    { key: 'conditioning', label: 'Conditioning', min: 0, max: 90, step: 1 },
  ];
  radar.value = { bubbly: 20, hardness: 40, conditioning: 60 };
  radar.previewValue = { bubbly: 25, hardness: 45, conditioning: 65 };
  radar.targetValue = { bubbly: 30, hardness: 50, conditioning: 70 };
  radar.selectedKey = 'bubbly';
  radar.showValues = true;
  radar.precision = 1;
  await flushRenderFrame();

  const axisLines = [...radar.shadowRoot!.querySelectorAll('line.axis')];
  const nodes = [...radar.shadowRoot!.querySelectorAll('circle.marble')];
  assert.equal(axisLines.length, radar.axes.length);
  assert.equal(nodes.length, radar.axes.length);
  [...axisLines, ...nodes].forEach((element) => {
    assert.equal(element.namespaceURI, svgNamespace);
  });
  axisLines.forEach((line) => {
    assert.equal(Number.isFinite(Number(line.getAttribute('x2'))), true);
    assert.equal(Number.isFinite(Number(line.getAttribute('y2'))), true);
  });
  const currentPoints =
    radar
      .shadowRoot!.querySelector<HTMLElement>('polygon.current')
      ?.getAttribute('points') || '';
  assert.equal(currentPoints.trim().split(/\s+/).length, radar.axes.length);
  assert.doesNotMatch(currentPoints, /NaN|Infinity/);
  assert.ok(
    radar.shadowRoot!.querySelector<HTMLElement>('slot[name="after-chart"]'),
  );
  assert.ok(
    radar.shadowRoot!.querySelector<HTMLElement>('.axis-label.selected'),
  );
  assert.ok(radar.shadowRoot!.querySelector<HTMLElement>('.value-label'));
  assert.equal(
    radar
      .shadowRoot!.querySelector<HTMLElement>('.value-label')
      ?.textContent?.trim(),
    '25.0',
  );
  assert.ok(radar.shadowRoot!.querySelector<HTMLElement>('.target-dot'));
});
