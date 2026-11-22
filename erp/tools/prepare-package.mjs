import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageDirectory = process.argv[2];

if (
  !['calculator-core', 'calculator-workbench', 'vector-widgets'].includes(
    packageDirectory,
  )
) {
  throw new Error('Usage: node tools/prepare-package.mjs <package-directory>');
}

const sourceRoot = join(repoRoot, 'packages', packageDirectory);
const outputRoot = join(repoRoot, 'dist', 'packages', packageDirectory);
const compiledSource =
  packageDirectory !== 'calculator-workbench'
    ? join(repoRoot, 'dist', 'build', packageDirectory, 'src')
    : join(
        repoRoot,
        'dist',
        'build',
        packageDirectory,
        'packages',
        packageDirectory,
        'src',
      );
await mkdir(outputRoot, { recursive: true });
await cp(compiledSource, join(outputRoot, 'src'), { recursive: true });

const manifest = JSON.parse(
  await readFile(join(sourceRoot, 'package.json'), 'utf8'),
);
await writeFile(
  join(outputRoot, 'package.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);
await copyFile(join(sourceRoot, 'README.md'), join(outputRoot, 'README.md'));
await copyFile(join(repoRoot, 'LICENSE'), join(outputRoot, 'LICENSE'));

console.log(`Prepared ${manifest.name}@${manifest.version}`);
