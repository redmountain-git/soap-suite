import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const widgetSrc = join(repoRoot, 'packages/vector-widgets/src');
const legacyAppSrc = join(repoRoot, 'app/src');

test('vector-widgets stays domain and framework agnostic', () => {
  const indexSource = readFileSync(join(widgetSrc, 'index.ts'), 'utf8');
  assert.doesNotMatch(
    indexSource,
    /soap-vector-solver|recipe-vector-workbench/,
  );

  for (const file of sourceFiles(widgetSrc)) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /from\s+["']@rmsc\/soap-formulation["']/,
      relative(repoRoot, file),
    );
    assert.doesNotMatch(
      source,
      /from\s+["']@rmsc\/domain-core["']/,
      relative(repoRoot, file),
    );
    assert.doesNotMatch(
      source,
      /from\s+["']@angular\//,
      relative(repoRoot, file),
    );
    assert.doesNotMatch(
      source,
      /from\s+["'](?:\.\.\/)*apps\//,
      relative(repoRoot, file),
    );
  }
});

test('vector components use canonical Lit rendering and focused support modules', () => {
  const support = readFileSync(
    join(widgetSrc, 'vector-component-support.ts'),
    'utf8',
  );
  assert.doesNotMatch(
    support,
    /function\s+\w+Styles|litRender|render\s+as\s+litRender/,
  );
  assert.ok(
    support.split(/\r?\n/).length < 40,
    'vector-component-support.ts should remain a minimal base',
  );

  for (const file of sourceFiles(widgetSrc)) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /@ts-nocheck/, relative(repoRoot, file));
    assert.doesNotMatch(
      source,
      /render\s+as\s+litRender|\blitRender\s*\(/,
      relative(repoRoot, file),
    );
  }
});

test('component modules do not rebuild the support catch-all', () => {
  const allowedSupportImports = new Set(['VectorElement', 'defineElement']);
  for (const file of sourceFiles(widgetSrc)) {
    const source = readFileSync(file, 'utf8');
    const match = source.match(
      /import\s+\{([^}]+)\}\s+from\s+["']\.\/vector-component-support["']/,
    );
    if (!match) continue;
    const names = match[1]
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    names.forEach((name) =>
      assert.ok(
        allowedSupportImports.has(name),
        `${relative(repoRoot, file)} imports unsupported ${name}`,
      ),
    );
  }
});

test('scalar controls compose shared behavior instead of inheriting presentation state', () => {
  for (const name of [
    'vector-constraint-rail.ts',
    'vector-value-slider.ts',
    'vector-quantity-input.ts',
  ]) {
    const source = readFileSync(join(widgetSrc, name), 'utf8');
    assert.doesNotMatch(source, /extends\s+ScalarControlElement/, name);
    assert.match(source, /ScalarControlController/, name);
  }
});

test('pure calculation modules stay independent from Lit and components', () => {
  for (const name of [
    'scalar-control-model.ts',
    'vector-events.ts',
    'vector-formatting.ts',
    'vector-geometry.ts',
    'vector-math.ts',
    'vector-numeric.ts',
  ]) {
    const source = readFileSync(join(widgetSrc, name), 'utf8');
    assert.doesNotMatch(source, /from\s+['"]lit(?:\/|['"])/, name);
    assert.doesNotMatch(
      source,
      /from\s+['"]\.\/vector-(?:pie|radar|constraint-rail|value-slider|quantity-input)/,
      name,
    );
    assert.ok(
      source.split(/\r?\n/).length < 500,
      `${name} is becoming a catch-all`,
    );
  }
});

test('legacy standalone app uses widget and soap packages instead of duplicate implementations', () => {
  const vectorComponents = readFileSync(
    join(legacyAppSrc, 'vector-components.ts'),
    'utf8',
  );
  const vectorMath = readFileSync(join(legacyAppSrc, 'vector-math.ts'), 'utf8');
  const soapSolver = readFileSync(
    join(legacyAppSrc, 'soap-vector-solver.ts'),
    'utf8',
  );
  const workbench = readFileSync(
    join(legacyAppSrc, 'recipe-vector-workbench.ts'),
    'utf8',
  );

  assert.match(vectorComponents, /@rmsc\/vector-widgets/);
  assert.doesNotMatch(
    vectorComponents,
    /class\s+VectorPieChart|customElements\.define/,
  );
  assert.match(vectorMath, /@rmsc\/vector-widgets/);
  assert.doesNotMatch(vectorMath, /function\s+redistributeComposition/);
  assert.match(soapSolver, /@rmsc\/soap-formulation/);
  assert.doesNotMatch(
    soapSolver,
    /DEMO_OIL_PROFILES|function\s+solveMetricTarget/,
  );
  assert.match(
    workbench,
    /apps\/operations\/src\/app\/features\/recipe-vector-workbench\.element/,
  );
  assert.doesNotMatch(
    workbench,
    /class\s+RecipeVectorWorkbench\s+extends\s+HTMLElement/,
  );
});

test('repository consumers use canonical properties and inherited theme tokens', () => {
  const workbench = readFileSync(
    join(
      repoRoot,
      'apps/operations/src/app/features/recipe-vector-workbench.element.ts',
    ),
    'utf8',
  );
  assert.doesNotMatch(workbench, /\.state\s*=\$\{|\.theme\s*=\$\{/);
  for (const file of sourceFiles(widgetSrc)) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /\.state\s*=\$\{|\.theme\s*=\$\{/,
      relative(repoRoot, file),
    );
  }
});

test('large rendering and calculation modules stay within explicit responsibility budgets', () => {
  const limits = new Map<string, number>([
    [join(widgetSrc, 'scalar-control-element.ts'), 450],
    [join(widgetSrc, 'vector-pie-chart.ts'), 600],
    [join(widgetSrc, 'vector-radar-chart.ts'), 500],
    [
      join(
        repoRoot,
        'apps/operations/src/app/features/recipe-vector-workbench.element.ts',
      ),
      2500,
    ],
    [
      join(
        repoRoot,
        'apps/operations/src/app/features/recipe-vector-workbench-model.ts',
      ),
      250,
    ],
    [
      join(
        repoRoot,
        'apps/operations/src/app/features/recipe-vector-workbench.styles.scss',
      ),
      350,
    ],
  ]);
  for (const [file, limit] of limits) {
    const source = readFileSync(file, 'utf8');
    assert.ok(
      source.split(/\r?\n/).length < limit,
      `${relative(repoRoot, file)} exceeds its ${limit}-line responsibility budget`,
    );
  }
  const model = readFileSync(
    join(
      repoRoot,
      'apps/operations/src/app/features/recipe-vector-workbench-model.ts',
    ),
    'utf8',
  );
  assert.doesNotMatch(model, /from\s+['"]lit(?:\/|['"])/);
});

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      return sourceFiles(path);
    }
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}
