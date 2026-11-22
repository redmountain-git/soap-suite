import { existsSync, realpathSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { copyWorkspaceDatabase, SqliteWorkspaceStore } from './sqlite-store';
import { workspaceApp } from './server';

function outsideCheckout(path: string) {
  if (!path || !isAbsolute(path))
    throw new Error('Use an absolute database path outside any Git checkout.');
  const real = existsSync(path)
    ? realpathSync(path)
    : join(realpathSync(dirname(path)), basename(path));
  for (let dir = dirname(real); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git')))
      throw new Error('Database files must be outside any Git checkout.');
    if (dir === dirname(dir)) break;
  }
  return real;
}

async function main() {
  const [command, database, argument, extra] = process.argv.slice(2);
  if (
    extra ||
    !['serve', 'init-demo', 'init-from-export', 'snapshot', 'restore'].includes(
      command,
    )
  ) {
    throw new Error(
      'Usage: cli.mjs init-demo DB | init-from-export NEW_DB EXPORT_JSON | serve DB [PORT] | snapshot DB NEW_FILE | restore SNAPSHOT NEW_DB',
    );
  }
  const path = outsideCheckout(database);
  if (command === 'init-from-export' && argument) {
    const store = await SqliteWorkspaceStore.fromBackup(
      path,
      readFileSync(outsideCheckout(argument), 'utf8'),
    );
    await store.close();
    console.log(
      'Created and verified a new SQLite workspace from the portable export.',
    );
    return;
  }
  if (command === 'init-demo' && argument === undefined) {
    const store = await SqliteWorkspaceStore.createDemo(path);
    await store.close();
    console.log('Created a fictional demo workspace.');
    return;
  }
  if (command === 'snapshot' || command === 'restore') {
    await copyWorkspaceDatabase(path, outsideCheckout(argument));
    console.log('New SQLite file verified.');
    return;
  }
  if (command !== 'serve') throw new Error('Unexpected argument.');
  const port = Number(argument ?? 4350);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Port must be an integer from 1024 through 65535.');
  const store = SqliteWorkspaceStore.open(path);
  try {
    const browser = resolve('dist/apps/operations/browser');
    const app = workspaceApp(store, browser);
    const server = app.listen(port, '127.0.0.1', () =>
      console.log(`SQLite workspace: http://127.0.0.1:${port}/`),
    );
    server.once('error', (error) => {
      void store.close();
      console.error(error.message);
      process.exitCode = 1;
    });
    const shutdown = () =>
      server.close(() => {
        void store.close();
      });
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    await store.close();
    throw error;
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Workspace API failed.',
  );
  process.exitCode = 1;
});
