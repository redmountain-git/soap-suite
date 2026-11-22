import { executeCommand } from '@rmsc/local-store';
import type { AnyWorkerRequest } from '@rmsc/worker-protocol';
self.onmessage = async (event: MessageEvent<AnyWorkerRequest>) => {
  const request = event.data;
  try {
    self.postMessage({
      id: request.id,
      ok: true,
      result: await executeCommand(request),
    });
  } catch (error) {
    self.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
