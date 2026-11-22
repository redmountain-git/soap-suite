import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { validateWorkspace } from '@rmsc/domain-core';
import type {
  AnyWorkerRequest,
  WorkerCommandMap,
  WorkerCommandName,
  WorkerRequest,
  Workspace,
} from '@rmsc/worker-protocol';
import {
  executeWorkspaceCommand,
  workspaceStores,
  type WorkspaceRecords,
  type WorkspaceTransaction,
} from './commands';

type SoapSuiteDatabase = DBSchema & {
  [K in keyof WorkspaceRecords]: { key: string; value: WorkspaceRecords[K] };
};
let dbPromise: Promise<IDBPDatabase<SoapSuiteDatabase>> | null = null;

export function openDatabase() {
  if (!dbPromise)
    dbPromise = openDB<SoapSuiteDatabase>('red-mountain-soap-suite', 2, {
      upgrade(db) {
        for (const name of workspaceStores)
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      },
      blocking() {
        void dbPromise?.then((db) => db.close());
        dbPromise = null;
      },
      terminated() {
        dbPromise = null;
      },
    });
  return dbPromise;
}

export async function readWorkspace() {
  return (await (await openDatabase()).get('documents', 'workspace')) || null;
}

// Bootstrap/test helper; application mutations use executeCommand exclusively.
export async function writeWorkspace(workspace: Workspace) {
  validateWorkspace(workspace);
  await (
    await openDatabase()
  ).put('documents', structuredClone(workspace), 'workspace');
  return structuredClone(workspace);
}

export async function executeCommand<K extends WorkerCommandName>(
  request: WorkerRequest<K>,
): Promise<WorkerCommandMap[K]['result']>;
export async function executeCommand(
  request: AnyWorkerRequest,
): Promise<unknown> {
  const tx = (await openDatabase()).transaction(workspaceStores, 'readwrite');
  void tx.done.catch(() => undefined);
  let outcome;
  try {
    // idb widens indexed value types; the schema above matches the command stores.
    const transaction = tx as unknown as WorkspaceTransaction;
    outcome = await executeWorkspaceCommand(transaction, request);
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Transaction may already have aborted. */
    }
    await tx.done.catch(() => undefined);
    throw error;
  }
  if (
    outcome.revision !== undefined &&
    typeof BroadcastChannel !== 'undefined'
  ) {
    const channel = new BroadcastChannel('soap-suite-workspace');
    channel.postMessage({
      revision: outcome.revision,
      clientId: request.clientId,
    });
    channel.close();
  }
  return outcome.result;
}
