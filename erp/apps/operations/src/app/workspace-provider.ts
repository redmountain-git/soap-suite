import { InjectionToken } from '@angular/core';
import type {
  WorkerCommandMap,
  WorkerCommandName,
  WorkerRequest,
  WorkerResponse,
} from '@rmsc/worker-protocol';

export interface WorkspaceDataProvider {
  readonly mode: 'browser' | 'sqlite' | 'endpoint' | 'invalid';
  readonly label: string;
  readonly channelName: string;
  send<K extends WorkerCommandName>(
    request: WorkerRequest<K>,
  ): Promise<WorkerCommandMap[K]['result']>;
}

export class UnconfirmedCommand extends Error {}

class BrowserProvider implements WorkspaceDataProvider {
  readonly mode = 'browser';
  readonly label = 'Browser workspace';
  readonly channelName = 'soap-suite-workspace';
  private worker?: Worker;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();

  async send<K extends WorkerCommandName>(
    req: WorkerRequest<K>,
  ): Promise<WorkerCommandMap[K]['result']> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./workspace.worker', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
        const callbacks = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.ok) callbacks?.resolve(data.result);
        else callbacks?.reject(new Error(data.error));
      };
      this.worker.onerror = this.worker.onmessageerror = () => {
        this.worker?.terminate();
        this.worker = undefined;
        for (const cb of this.pending.values())
          cb.reject(
            new UnconfirmedCommand(
              'Browser worker stopped. The operation was not confirmed.',
            ),
          );
        this.pending.clear();
      };
    }
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      try {
        this.worker!.postMessage(req);
      } catch (e) {
        this.pending.delete(req.id);
        reject(e);
      }
    });
  }
}

class EndpointProvider implements WorkspaceDataProvider {
  readonly label: string;
  readonly channelName: string;
  private channel?: BroadcastChannel;
  constructor(
    readonly mode: 'sqlite' | 'endpoint',
    private url: URL,
  ) {
    this.label = mode === 'sqlite' ? 'SQLite workspace' : 'Hosted workspace';
    this.channelName = 'soap-suite:' + url.href;
    if (typeof BroadcastChannel !== 'undefined')
      this.channel = new BroadcastChannel(this.channelName);
  }
  async send<K extends WorkerCommandName>(
    req: WorkerRequest<K>,
  ): Promise<WorkerCommandMap[K]['result']> {
    let body;
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        cache: 'no-store',
        redirect: 'error',
        credentials: 'same-origin',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(15000),
      });
      body = await response.json();
      if (
        body?.id !== req.id ||
        (body.ok !== false &&
          !(response.ok && body.ok === true && 'result' in body))
      )
        throw new Error();
    } catch {
      throw new UnconfirmedCommand(
        this.label +
          ' is unavailable or returned an invalid reply. The operation was not confirmed.',
      );
    }
    if (!body.ok)
      throw new Error(
        'Request rejected: ' +
          (typeof body.error === 'string' ? body.error : 'Invalid command.'),
      );
    if (Number.isSafeInteger(body.revision))
      this.channel?.postMessage({
        revision: body.revision,
        clientId: req.clientId,
      });
    return body.result;
  }
}

export function configuredWorkspace(doc: Document): WorkspaceDataProvider {
  const tags = doc.querySelectorAll<HTMLMetaElement>(
    'meta[name="soap-suite-workspace"]',
  );
  if (!tags.length) return new BrowserProvider();
  const { content, dataset } = tags[0];
  if (tags.length === 1) {
    if (
      content === 'sqlite' &&
      !('endpoint' in dataset) &&
      doc.location.hostname === '127.0.0.1'
    )
      return new EndpointProvider(
        'sqlite',
        new URL('/api/v1/commands', doc.location.origin),
      );
    if (content === 'endpoint' && dataset['endpoint']) {
      try {
        const url = new URL(dataset['endpoint']);
        if (
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        )
          return new EndpointProvider('endpoint', url);
      } catch {
        /* Invalid deployments must not open the browser database. */
      }
    }
  }
  return {
    mode: 'invalid',
    label: 'Invalid workspace configuration',
    channelName: 'soap-suite-invalid',
    async send() {
      throw new Error(
        'Invalid workspace configuration. No data store was opened.',
      );
    },
  };
}

export const WORKSPACE_DATA_PROVIDER =
  new InjectionToken<WorkspaceDataProvider>('WorkspaceDataProvider', {
    providedIn: 'root',
    factory: () => configuredWorkspace(document),
  });
