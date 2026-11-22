import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoWorkspace } from './seed-data';
import { calculateBatch } from './domain';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const windows = process.platform === 'win32';
const venvPython = join(
  root,
  '.venv',
  windows ? 'Scripts/python.exe' : 'bin/python',
);
const python =
  process.env.PYTHON ||
  (existsSync(venvPython) ? venvPython : windows ? 'python' : 'python3');
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../demo-data/formulation-golden.json', import.meta.url),
    'utf8',
  ),
) as {
  cases: Array<{
    purity: number;
    volume: number;
    expected_oils: number;
    expected_lye: number;
    expected_liquid: number;
    expected_clay: number;
  }>;
};
for (const example of fixture.cases)
  it(`independent golden model and Python parity at purity ${example.purity}`, () => {
    const w = createDemoWorkspace();
    const base = {
      id: 'BASE',
      name: 'Independent',
      oils_pct: { olive_oil: 100 },
      lye: {
        type: 'NaOH',
        purity_percent: example.purity,
        default_superfat_pct: 0,
      },
      liquid: { default_type: 'distilled_water' },
      additives_pct: { kaolin_clay: 5 },
    };
    const workspace = {
      ...w,
      base_recipes: [base],
      product_recipes: [],
      constants: {
        units: { ...w.constants!.units, in3: { to_ml: 1 } },
        density: { olive_oil: 1, naoh: 1, distilled_water: 1, kaolin_clay: 1 },
        sap_values: { naoh: { olive_oil: 0.1 } },
      },
    };
    const result = calculateBatch(workspace, {
      recipeId: 'BASE',
      volumeIn3: example.volume,
      fragrancePct: 0,
      lyeRatio: 2,
    });
    expect(result.total_oils_g).toBeCloseTo(example.expected_oils, 5);
    expect(result.materials_required_g.naoh).toBeCloseTo(
      example.expected_lye,
      5,
    );
    expect(result.materials_required_g.distilled_water).toBeCloseTo(
      example.expected_liquid,
      5,
    );
    expect(result.materials_required_g.kaolin_clay).toBeCloseTo(
      example.expected_clay,
      5,
    );
    expect(result.total_mass_g).toBeCloseTo(example.volume, 4);
    const code = `import json; from engine.batch_sizing import calculate_batch_from_data; print(json.dumps(calculate_batch_from_data(${example.volume}, {'olive_oil':100}, {'in3':{'to_ml':1}}, {'olive_oil':1,'naoh':1,'distilled_water':1,'kaolin_clay':1}, {'olive_oil':.1},superfat_pct=0,lye_ratio=2,liquid_type='distilled_water',fragrance_pct=0,additives_pct={'kaolin_clay':5},purity_percent=${example.purity})))`;
    const other = JSON.parse(
      execFileSync(python, ['-c', code], {
        cwd: root,
        encoding: 'utf8',
        timeout: 20000,
      }),
    ) as { total_oils_g: number; total_mass_g: number };
    expect(other.total_oils_g).toBeCloseTo(result.total_oils_g, 5);
    expect(other.total_mass_g).toBeCloseTo(result.total_mass_g, 4);
  }, 30000);
