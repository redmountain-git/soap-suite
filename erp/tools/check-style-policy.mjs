import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const roots = [
  join(repoRoot, 'packages/vector-widgets/src'),
  join(repoRoot, 'apps/operations/src'),
];
const violations = [];

for (const root of roots) {
  for (const path of await sourceFiles(root)) {
    const name = relative(repoRoot, path);
    if (path.endsWith('.styles.generated.ts')) continue;
    if (extname(path) === '.css') {
      violations.push(`${name}: hand-authored CSS must use SCSS`);
      continue;
    }
    if (!/\.(?:ts|html)$/.test(path) || path.endsWith('.test.ts')) continue;
    const source = await readFile(path, 'utf8');
    const checks = [
      [/\bstyleMap\b/, 'styleMap is forbidden; bind runtime custom properties'],
      [/\bcss\s*`/, 'hand-authored Lit css templates are forbidden'],
      [/<style(?:\s|>)/i, 'rendered style elements are forbidden'],
      [/\bstyle\s*=\s*(?:["']|\$\{)/i, 'inline style attributes are forbidden'],
    ];
    for (const [pattern, message] of checks) {
      if (pattern.test(source)) violations.push(`${name}: ${message}`);
    }
  }
}

if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Style policy passed.');
}

async function sourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = join(root, entry.name);
        return entry.isDirectory() ? sourceFiles(path) : [path];
      }),
    )
  ).flat();
}
