// Compare the actual command API export, without printing business records on mismatch.
import { readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

const [sourcePath, address, destination, extra] = process.argv.slice(2);
if (!sourcePath || !address || extra)
  throw new Error(
    'Usage: verify-served-copy SOURCE_JSON LOOPBACK_ORIGIN [NEW_EXPORT_JSON]',
  );
const url = new URL(address);
if (
  url.protocol !== 'http:' ||
  url.hostname !== '127.0.0.1' ||
  url.href !== url.origin + '/'
)
  throw new Error('Verification is limited to a local loopback workspace.');
const source = JSON.parse(await readFile(sourcePath, 'utf8'));
if (source.app !== 'red-mountain-soap-suite' || !source.workspace)
  throw new Error('Invalid source export.');
const response = await fetch(new URL('/api/v1/commands', url), {
  method: 'POST',
  headers: { origin: url.origin, 'content-type': 'application/json' },
  body: JSON.stringify({ id: 1, command: 'exportBackup', payload: {} }),
  redirect: 'error',
  signal: AbortSignal.timeout(15000),
});
const reply = await response.json();
if (!response.ok || reply.id !== 1 || !reply.ok)
  throw new Error('Could not export the local workspace.');
const copy = JSON.parse(reply.result);
if (
  copy.app !== source.app ||
  !isDeepStrictEqual(copy.workspace, source.workspace)
)
  throw new Error('Workspace mismatch. Do not switch providers.');
if (destination)
  await writeFile(destination, reply.result, { flag: 'wx', mode: 0o600 });
console.log(
  'Complete workspace matches, including metadata and audit history. Revision:',
  copy.workspace.revision,
);
