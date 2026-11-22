import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageDirectory = process.argv[2];
if (
  !['calculator-core', 'calculator-workbench', 'vector-widgets'].includes(
    packageDirectory,
  )
) {
  throw new Error('Usage: node tools/clean-package.mjs <package-directory>');
}
await Promise.all([
  rm(join(repoRoot, 'dist', 'build', packageDirectory), {
    recursive: true,
    force: true,
  }),
  rm(join(repoRoot, 'dist', 'packages', packageDirectory), {
    recursive: true,
    force: true,
  }),
]);
