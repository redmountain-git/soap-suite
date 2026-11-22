import { closeSync, openSync, unlinkSync } from 'node:fs';
import { backup, DatabaseSync } from 'node:sqlite';
import {
  buildReports,
  migrateWorkspace,
  validateWorkspace,
} from '@rmsc/domain-core';
import type { AnyWorkerRequest, Workspace } from '@rmsc/worker-protocol';
import {
  executeWorkspaceCommand,
  workspaceStores,
  type WorkspaceRecords,
  type WorkspaceStoreName,
  type WorkspaceTransaction,
} from '../../../packages/local-store/src/commands';

function reserveNewFile(path: string) {
  closeSync(openSync(path, 'wx', 0o600));
}

function decode<T>(row: Record<string, unknown> | undefined): T | undefined {
  return row ? (JSON.parse(String(row['value'])) as T) : undefined;
}

function verifyDatabase(db: DatabaseSync, full = false) {
  if (db.prepare('PRAGMA user_version').get()?.['user_version'] !== 1)
    throw new Error('Not a supported Soap Suite SQLite database.');
  if (
    full &&
    db
      .prepare('PRAGMA integrity_check')
      .all()
      .some((row) => row['integrity_check'] !== 'ok')
  )
    throw new Error('SQLite integrity check failed.');
  for (const name of workspaceStores)
    db.prepare(`SELECT key, value FROM ${name} LIMIT 0`).all();
  const workspace = decode<Workspace>(
    db.prepare("SELECT value FROM documents WHERE key = 'workspace'").get(),
  );
  if (!workspace) throw new Error('SQLite workspace is not initialized.');
  validateWorkspace(workspace);
}

export class SqliteWorkspaceStore {
  private tail: Promise<unknown> = Promise.resolve();
  private constructor(private readonly db: DatabaseSync) {}

  static async createDemo(path: string) {
    return this.create(path);
  }

  static async fromBackup(path: string, raw: string) {
    const envelope = JSON.parse(raw);
    if (envelope?.app !== 'red-mountain-soap-suite' || !envelope.workspace)
      throw new Error('Expected a Soap Suite portable workspace export.');
    const workspace = migrateWorkspace(envelope.workspace);
    buildReports(workspace);
    return this.create(
      path,
      workspace,
      Number(envelope.workspace.version) === 1 ? envelope.workspace : undefined,
    );
  }

  private static async create(
    path: string,
    workspace?: Workspace,
    original?: Workspace,
  ) {
    reserveNewFile(path);
    const db = new DatabaseSync(path);
    try {
      db.exec('BEGIN IMMEDIATE');
      for (const name of workspaceStores)
        db.exec(
          `CREATE TABLE ${name} (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) STRICT`,
        );
      db.exec('PRAGMA user_version = 1');
      const adapter = new SqliteWorkspaceStore(db);
      const tx = adapter.transaction();
      if (workspace) {
        if (original) {
          const id = crypto.randomUUID();
          await tx
            .objectStore('recovery')
            .put(
              {
                id,
                at: new Date().toISOString(),
                reason: 'Before version-2 migration',
                workspace: original,
              },
              id,
            );
        }
        await tx.objectStore('documents').put(workspace, 'workspace');
      } else
        await executeWorkspaceCommand(tx, {
          id: 0,
          command: 'seedWorkspace',
          payload: {},
        });
      verifyDatabase(db, true);
      db.exec('COMMIT');
      return adapter;
    } catch (error) {
      db.close();
      unlinkSync(path);
      throw error;
    }
  }

  static open(path: string) {
    // Do not implicitly create or seed a missing database.
    const readOnly = new DatabaseSync(path, { readOnly: true });
    try {
      verifyDatabase(readOnly);
    } finally {
      readOnly.close();
    }
    const db = new DatabaseSync(path);
    try {
      db.exec('PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000');
      return new SqliteWorkspaceStore(db);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  execute(request: AnyWorkerRequest) {
    return this.enqueue(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const outcome = await executeWorkspaceCommand(
          this.transaction(),
          request,
        );
        this.db.exec('COMMIT');
        return outcome;
      } catch (error) {
        if (this.db.isTransaction) this.db.exec('ROLLBACK');
        throw error;
      }
    });
  }

  close() {
    return this.enqueue(() => this.db.close());
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const settled = this.tail.then(operation);
    this.tail = settled.catch(() => undefined);
    return settled;
  }

  private transaction(): WorkspaceTransaction {
    return {
      objectStore: <K extends WorkspaceStoreName>(name: K) => ({
        get: async (key: string) =>
          decode<WorkspaceRecords[K]>(
            this.db.prepare(`SELECT value FROM ${name} WHERE key = ?`).get(key),
          ),
        getAll: async () =>
          this.db
            .prepare(`SELECT value FROM ${name}`)
            .all()
            .map((row) => decode<WorkspaceRecords[K]>(row)!),
        put: async (value: WorkspaceRecords[K], key: string) => {
          this.db
            .prepare(
              `INSERT INTO ${name} (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            )
            .run(key, JSON.stringify(value));
        },
        delete: async (key: string) => {
          this.db.prepare(`DELETE FROM ${name} WHERE key = ?`).run(key);
        },
      }),
    };
  }
}

/** Create or restore a full snapshot without modifying the source or replacing a file. */
export async function copyWorkspaceDatabase(
  source: string,
  destination: string,
) {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    verifyDatabase(db);
    reserveNewFile(destination);
    await backup(db, destination);
  } finally {
    db.close();
  }
  const restored = new DatabaseSync(destination, { readOnly: true });
  try {
    verifyDatabase(restored, true);
  } finally {
    restored.close();
  }
}
