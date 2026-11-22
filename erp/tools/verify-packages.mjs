import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageDirectories = [
  'calculator-core',
  'vector-widgets',
  'calculator-workbench',
];
const expectedVersion = '0.1.0';

for (const directory of packageDirectories) {
  const outputRoot = join(repoRoot, 'dist', 'packages', directory);
  const manifest = JSON.parse(
    await readFile(join(outputRoot, 'package.json'), 'utf8'),
  );
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `${manifest.name} has ${manifest.version}; expected fixed version ${expectedVersion}.`,
    );
  }

  const sourceFiles = await recursiveFiles(join(outputRoot, 'src'));
  for (const file of sourceFiles.filter((path) =>
    /\.(?:js|d\.ts)$/.test(path),
  )) {
    const source = await readFile(file, 'utf8');
    if (source.includes('@rmsc/') || source.includes('Workspace')) {
      throw new Error(`Private API leaked into ${file}.`);
    }
  }

  const packed = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: outputRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (packed.status !== 0) {
    throw new Error(
      packed.error?.message ||
        packed.stderr ||
        `npm pack failed for ${manifest.name}.`,
    );
  }
  const report = JSON.parse(packed.stdout);
  const names = new Set(report[0].files.map((file) => file.path));
  for (const required of [
    'package.json',
    'README.md',
    'LICENSE',
    'src/index.js',
    'src/index.d.ts',
  ]) {
    if (!names.has(required)) {
      throw new Error(`${manifest.name} pack is missing ${required}.`);
    }
  }
  console.log(`Verified ${manifest.name}@${manifest.version}`);
}

async function recursiveFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = join(root, entry.name);
        return entry.isDirectory() ? recursiveFiles(path) : [path];
      }),
    )
  ).flat();
}
