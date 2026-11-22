import type {
  BatchCalculation,
  BatchCalculationInput,
  MoldAllocation,
  MoldInput,
  NumericMap,
  ProductionLog,
  Workspace,
} from '@rmsc/worker-protocol';
import { finite, object } from './validation';

export function wholeGramTargets(
  calc: BatchCalculation,
): Record<string, number> {
  const targets = Object.fromEntries(
    Object.entries(calc.materials_required_g).map(([m, n]) => [
      m,
      Math.round(finite(n, `Recipe ${m}`)),
    ]),
  );
  const oils = Object.keys(calc.oils_g || {}).filter(
    (m) => calc.materials_required_g[m] > 0,
  );
  const ordered = oils
    .map((m, index) => ({
      m,
      index,
      fraction: calc.materials_required_g[m] % 1,
    }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const m of oils) targets[m] = Math.floor(calc.materials_required_g[m]);
  const remaining =
    Math.round(oils.reduce((sum, m) => sum + calc.materials_required_g[m], 0)) -
    oils.reduce((sum, m) => sum + targets[m], 0);
  for (let i = 0; i < remaining; i++) targets[ordered[i].m]++;
  return targets;
}

export function weighingGroup(
  calc: BatchCalculation,
  step: string,
  material?: string,
): string[] {
  if (step === 'oils_ready')
    return Object.keys(calc.oils_g || {}).filter(
      (m) => calc.materials_required_g[m] > 0,
    );
  if (step === 'lye_ready')
    return [
      (calc.lye_type || 'naoh').toLowerCase(),
      calc.liquid_type || 'distilled_water',
    ];
  if (step === 'additive' && material) return [material];
  return [];
}

export function calendarDate(
  value: string | Date = new Date(),
  timeZone?: string,
): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function allocateMolds(
  workspace: Workspace,
  input: BatchCalculationInput,
): ReadonlyArray<MoldAllocation> | undefined {
  if (input.molds === undefined) return undefined;
  if (!Array.isArray(input.molds) || !input.molds.length)
    throw new Error('At least one mold is required.');
  const ids = new Set<string>();
  const molds = input.molds.map((m: MoldInput) => {
    if (!m || typeof m.id !== 'string' || !m.id.trim() || ids.has(m.id))
      throw new Error('Mold identifiers must be unique.');
    ids.add(m.id);
    if (typeof m.label !== 'string' || !m.label.trim())
      throw new Error('Mold label is required.');
    const size = workspace.bar_sizes?.[m.barSize];
    if (!size || size.active === false)
      throw new Error('Select an active bar size for each mold.');
    const volume = finite(m.volumeIn3, 'Mold volume', Number.MIN_VALUE);
    const barVolume = finite(
      size.approx_volume_in3,
      'Bar volume',
      Number.MIN_VALUE,
    );
    return {
      ...m,
      bar_volume_in3: barVolume,
      bars_expected: Math.floor((volume + 1e-8) / barVolume),
    };
  });
  const sum = molds.reduce((n, m) => n + m.volumeIn3, 0);
  if (Math.abs(sum - input.volumeIn3) > 1e-6)
    throw new Error('Batch volume must equal the combined mold volume.');
  return molds;
}

export function productionAdditives(calc: BatchCalculation): string[] {
  const excluded = new Set([
    ...Object.keys(calc.oils_g || {}),
    (calc.lye_type || 'naoh').toLowerCase(),
    calc.liquid_type || 'distilled_water',
  ]);
  return Object.keys(calc.materials_required_g).filter(
    (m) => !excluded.has(m) && calc.materials_required_g[m] > 0,
  );
}

export function estimatedTrim(calc: BatchCalculation, counts: NumericMap) {
  if (!calc.molds?.length) return undefined;
  const volumes = Object.fromEntries(
    calc.molds.map((m) => [m.barSize, m.bar_volume_in3]),
  );
  let used = 0;
  for (const [size, count] of Object.entries(counts)) {
    finite(count, 'Yield count');
    if (!Number.isInteger(count))
      throw new Error('Yield counts must be whole bars.');
    if (count && !volumes[size])
      throw new Error('Yield size was not allocated to this batch.');
    used += (volumes[size] || 0) * count;
  }
  if (used > calc.volume_in3 + 1e-6)
    throw new Error(
      'Observed bar volume exceeds planned mold volume. Review the yield or mold dimensions.',
    );
  const trim = Math.max(0, calc.volume_in3 - used);
  return {
    estimated_trim_in3: Math.round(trim * 1e6) / 1e6,
    estimated_trim_pct: Math.round((trim / calc.volume_in3) * 1e6) / 1e4,
  };
}

export function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new Error('Production timestamp must be a valid ISO UTC timestamp.');
  return value;
}

export function validateProductionLog(
  value: unknown,
  omittedMaterials: readonly string[] = [],
): asserts value is ProductionLog {
  if (!object(value) || !object(value['additives']))
    throw new Error('Invalid production log.');
  const steps = [
    'lye_ready',
    'oils_ready',
    'mixed',
    'trace',
    'pour_started',
    'pour_finished',
  ];
  for (const [key, at] of Object.entries(value)) {
    if (key === 'additives') continue;
    if (key === 'pour_finished_estimated') {
      if (typeof at !== 'boolean' || value['pour_finished'] === undefined)
        throw new Error(
          'A pour end estimate flag requires a recorded pour end.',
        );
      continue;
    }
    if (!steps.includes(key)) throw new Error('Unknown production step.');
    timestamp(at);
  }
  const log = value as unknown as ProductionLog;
  for (const at of Object.values(log.additives)) timestamp(at);
  const after = (later?: string, earlier?: string, name = 'previous step') => {
    if (later && (!earlier || later < earlier))
      throw new Error(`Production timestamp cannot precede or omit ${name}.`);
  };
  after(log.mixed, log.lye_ready, 'lye ready');
  after(log.mixed, log.oils_ready, 'oils ready');
  after(log.trace, log.mixed, 'mixed');
  after(log.pour_started, log.trace, 'trace');
  after(log.pour_finished, log.pour_started, 'pour start');
  if (
    log.pour_finished &&
    Object.entries(log.additives).some(
      ([material, at]) =>
        !omittedMaterials.includes(material) && at > log.pour_finished!,
    )
  )
    throw new Error('Additive timestamp cannot follow the completed pour.');
}
