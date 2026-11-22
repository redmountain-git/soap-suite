import assert from 'node:assert/strict';
import { test } from 'vitest';
import { PointerDragController } from './pointer-drag-controller';

function createController(): PointerDragController {
  let controller: PointerDragController | null = null;
  const host = {
    addController(value: PointerDragController) {
      controller = value;
    },
    removeController() {},
    requestUpdate() {},
    updateComplete: Promise.resolve(true),
  };
  new PointerDragController(host);
  assert.ok(controller);
  return controller;
}

test('removes document listeners when its host disconnects', () => {
  const controller = createController();
  const moves: PointerEvent[] = [];
  controller.start({
    move: (event) => moves.push(event),
    end() {},
    cancel() {},
  });
  controller.hostDisconnected();
  document.dispatchEvent(new PointerEvent('pointermove'));
  assert.equal(moves.length, 0);
});

test('cancels and can reconnect cleanly', () => {
  const controller = createController();
  let cancellations = 0;
  const handlers = {
    move() {},
    end() {},
    cancel() {
      cancellations += 1;
    },
  };
  controller.start(handlers);
  assert.equal(controller.active, true);
  document.dispatchEvent(new PointerEvent('pointercancel'));
  assert.equal(cancellations, 1);
  assert.equal(controller.active, false);
  controller.start(handlers);
  controller.hostDisconnected();
  assert.equal(controller.active, false);
});
