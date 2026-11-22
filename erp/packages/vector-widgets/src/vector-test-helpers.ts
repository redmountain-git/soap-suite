import type { LitElement } from 'lit';
import assert from 'node:assert/strict';
import type { VectorConstraint } from './vector-types';

export function defaultTestConstraints(
  keys: string[] = [],
): Record<string, VectorConstraint> {
  const defaults: Record<string, VectorConstraint> = {
    olive_oil: { min: 10, max: 70, step: 1 },
    coconut_oil: { min: 5, max: 30, step: 1 },
    lard: { min: 10, max: 60, step: 1 },
    castor_oil: { min: 5, max: 10, step: 1 },
  };
  return Object.fromEntries(
    keys.map((key) => [
      key,
      { ...(defaults[key] ?? { min: 0, max: 100, step: 1 }) },
    ]),
  );
}

export function connect<T extends LitElement>(element: T): T {
  document.body.append(element);
  return element;
}

export function installDomStub(): void {
  assert.ok(globalThis.HTMLElement);
  assert.ok(globalThis.customElements);
}

export async function flushRenderFrame(): Promise<void> {
  await Promise.all(
    [...document.body.querySelectorAll<LitElement>('*')]
      .map((element) => element.updateComplete)
      .filter(Boolean),
  );
  await new Promise((resolve) => {
    const schedule = globalThis.requestAnimationFrame;
    if (typeof schedule === 'function') {
      schedule(() => resolve(undefined));
    } else {
      resolve(undefined);
    }
  });
}

export interface FakeDecorator {
  dataset: DOMStringMap;
  hidden: boolean;
  style: {
    props: Record<string, string>;
    setProperty(name: string, value: string): void;
  };
}

export function fakeDecorator(
  key: string,
  dataset: Record<string, string> = {},
): FakeDecorator {
  const props: Record<string, string> = {};
  return {
    dataset: { key, ...dataset } as DOMStringMap,
    hidden: false,
    style: {
      props,
      setProperty(name, value) {
        props[name] = value;
      },
    },
  };
}
