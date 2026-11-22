import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const previewRoot = join(repoRoot, 'dist', 'calculator-preview');
const target = join(previewRoot, 'calculator');

await rm(previewRoot, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(join(repoRoot, 'dist', 'apps', 'calculator', 'browser'), target, {
  recursive: true,
});
