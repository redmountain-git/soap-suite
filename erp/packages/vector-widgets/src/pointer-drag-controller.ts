import type { ReactiveController, ReactiveControllerHost } from 'lit';

export interface PointerDragHandlers {
  move(event: PointerEvent): void;
  end(event: PointerEvent): void;
  cancel(): void;
}

export class PointerDragController implements ReactiveController {
  private abortController: AbortController | null = null;

  constructor(private readonly host: ReactiveControllerHost) {
    host.addController(this);
  }

  get active(): boolean {
    return this.abortController !== null;
  }

  hostDisconnected(): void {
    this.cancel();
  }

  start(handlers: PointerDragHandlers): void {
    this.cancel();
    const abortController = new AbortController();
    this.abortController = abortController;
    const options = { signal: abortController.signal };
    document.addEventListener('pointermove', handlers.move, options);
    document.addEventListener(
      'pointerup',
      (event) => {
        this.cancel();
        handlers.end(event);
      },
      options,
    );
    document.addEventListener(
      'pointercancel',
      () => {
        this.cancel();
        handlers.cancel();
      },
      options,
    );
  }

  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
}
