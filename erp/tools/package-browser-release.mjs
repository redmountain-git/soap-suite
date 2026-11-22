import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tag = process.env.RELEASE_TAG;
assert(/^v\d+\.\d+\.\d+$/.test(tag ?? ''), 'Set RELEASE_TAG to vX.Y.Z');
const root = fileURLToPath(new URL('../', import.meta.url));
const browser = join(root, 'dist/apps/operations/browser');
const out = join(root, 'dist/releases');
const index = await readFile(join(browser, 'index.html'), 'utf8');
assert(
  index.includes('<base href="/suite/">') &&
    !index.includes('name="soap-suite-workspace"'),
);
const worker = JSON.parse(await readFile(join(browser, 'ngsw.json'), 'utf8'));
assert.equal(worker.index, '/suite/index.html');
assert(Object.keys(worker.hashTable).every((url) => url.startsWith('/suite/')));
// Angular's asset copier may omit dotfiles. Keep the SPA fallback in this directory only.
await copyFile(
  join(root, 'apps/operations/public/.htaccess'),
  join(browser, '.htaccess'),
);
await copyFile(
  join(browser, '..', '3rdpartylicenses.txt'),
  join(browser, '3rdpartylicenses.txt'),
);
await copyFile(join(root, 'LICENSE'), join(browser, 'LICENSE.txt'));
for (const entry of await readdir(browser, {
  recursive: true,
  withFileTypes: true,
})) {
  assert(
    entry.isDirectory() ||
      (entry.isFile() &&
        /^(?:[\w.-]+\.(?:js|css|svg|ico)|(?:index\.html|manifest\.webmanifest|ngsw\.json|\.htaccess|3rdpartylicenses\.txt|LICENSE\.txt))$/.test(
          entry.name,
        )),
    'Unexpected browser release entry: ' + entry.name,
  );
}
await mkdir(out, { recursive: true });
const name = 'soap-suite-browser-' + tag + '.tar.gz';
const path = join(out, name);
execFileSync('tar', ['-czf', path, '-C', browser, '.']);
const digest = createHash('sha256')
  .update(await readFile(path))
  .digest('hex');
await writeFile(path + '.sha256', digest + '  ' + name + '\n');
console.log(name, digest);
