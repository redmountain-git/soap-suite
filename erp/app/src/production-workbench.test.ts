import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildReports,
  createDemoWorkspace,
  transition,
  wholeGramTargets,
} from '@rmsc/domain-core';
import type { DomainCommand, DomainCommandName } from '@rmsc/domain-core';
import type { DecoratedWorkspace, Workspace } from '@rmsc/worker-protocol';
import { ProductionWorkbench } from '../../apps/operations/src/app/features/production-workbench.element';
import {
  ProductionYieldForm,
  type ExecuteWorkspace,
} from '../../apps/operations/src/app/features/data-recovery.element';

it('defaults the shared cut date to the workspace day after UTC midnight', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-18T04:00:00Z'));
  const yieldForm = new ProductionYieldForm();
  yieldForm.workspace = {
    ...createDemoWorkspace(),
    timeZone: 'America/Denver',
  };
  document.body.append(yieldForm);
  try {
    await yieldForm.updateComplete;
    expect(
      yieldForm.renderRoot.querySelector<HTMLInputElement>('input[name="at"]')
        ?.value,
    ).toBe('2026-11-17');
  } finally {
    yieldForm.remove();
    vi.useRealTimers();
  }
});

let element: ProductionWorkbench;
afterEach(() => {
  element?.remove();
  vi.restoreAllMocks();
});
async function settle() {
  await element.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await element.updateComplete;
}
async function setup(initial = createDemoWorkspace()) {
  let w: Workspace = initial;
  let id = 0;
  element = new ProductionWorkbench();
  element.workspace = w;
  element.execute = (async (name: DomainCommandName, payload: unknown) => {
    const context = {
      today: '2026-11-15',
      nowIso: new Date(
        Date.parse('2026-11-15T20:00:00.123Z') +
          id++ * 1000 +
          (name === 'correctAdditiveTimestamp' ||
          name === 'correctPourEndTimestamp'
            ? 60000
            : 0),
      ).toISOString(),
      nextId: () => 'B-UI',
    };
    const result = transition(w, { name, payload } as DomainCommand, context);
    if (name === 'calculateBatch' || name === 'runCapacityAudit') return result;
    w = { ...(result as Workspace), revision: Number(w.revision || 0) + 1 };
    return { workspace: w, reports: buildReports(w) };
  }) as ExecuteWorkspace;
  document.body.append(element);
  await settle();
  return () => w;
}
function button(name: string) {
  const result = [...element.shadowRoot!.querySelectorAll('button')].find(
    (b) => b.textContent!.trim() === name,
  );
  if (!result) throw new Error(`Missing button: ${name}`);
  return result;
}
async function click(name: string) {
  button(name).click();
  await settle();
}

describe('shared production UI', () => {
  it('records two groups at cut and labels a changed count at a cure weigh-in', async () => {
    const source = transition(
      createDemoWorkspace(),
      {
        name: 'savePlannedBatch',
        payload: {
          input: {
            recipeId: 'BSR-DEMO-001',
            volumeIn3: 90,
            fragrancePct: 0,
            molds: [
              {
                id: 'retail',
                label: 'Retail',
                barSize: 'bar_5_2_oz',
                volumeIn3: 70,
              },
              {
                id: 'guest',
                label: 'Hospitality',
                barSize: 'bar_1_0_oz',
                volumeIn3: 20,
              },
            ],
          },
        },
      },
      {
        today: '2026-11-15',
        nowIso: '2026-11-15T20:00:00.000Z',
        nextId: () => 'B-UI-YIELD',
      },
    );
    const batch = source.batches!.at(-1)!;
    const workspace = await setup({
      ...source,
      batches: [{ ...batch, status: 'unmolded' }],
    });
    element.addEventListener('workspace-updated', (event) => {
      element.workspace = (
        event as CustomEvent<DecoratedWorkspace>
      ).detail.workspace;
    });
    const field = (root: ShadowRoot, name: string, value: string) => {
      const input = root.querySelector<HTMLInputElement>(
        `input[name="${name}"]`,
      )!;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const submit = (root: ShadowRoot) =>
      root.querySelector('form')!.requestSubmit();
    await click('Record cut yield');
    const cut = element.shadowRoot!.querySelector(
      'production-yield-form',
    )!.shadowRoot!;
    field(cut, 'size-bar_5_2_oz', '5');
    field(cut, 'weight-bar_5_2_oz', '750');
    field(cut, 'size-bar_1_0_oz', '8');
    field(cut, 'weight-bar_1_0_oz', '224');
    field(cut, 'at', '2026-11-15');
    await settle();
    submit(cut);
    await settle();
    expect(workspace().batches![0].yield_actual?.weight_g_by_size).toEqual({
      bar_5_2_oz: 750,
      bar_1_0_oz: 224,
    });
    field(element.shadowRoot!, 'cureStartDate', '2026-11-15');
    await click('Start cure');
    expect(workspace().batches![0].events?.at(-1)).toMatchObject({
      type: 'cure_started',
      at: '2026-11-15',
    });
    expect(workspace().batches![0].cure_weigh_ins).toBeUndefined();
    const cure =
      element.shadowRoot!.querySelector('batch-cure-weights')!.shadowRoot!;
    cure.querySelector('button')!.click();
    await settle();
    expect(
      cure.querySelector<HTMLInputElement>('input[name="size-bar_1_0_oz"]')
        ?.value,
    ).toBe('8');
    field(cure, 'size-bar_1_0_oz', '7');
    field(cure, 'weight-bar_1_0_oz', '182');
    field(cure, 'at', '2026-11-15');
    submit(cure);
    await settle();
    expect(workspace().batches![0].cure_weigh_ins?.[0].size_counts).toEqual({
      bar_1_0_oz: 7,
    });
    expect(cure.textContent).toContain('count changed; no loss estimate');
    expect(cure.textContent).not.toContain('% vs cut');
  });
  it('opens planning with the recipe chosen in the library', async () => {
    await setup();
    element.initialRecipeId = 'PR-DEMO-001';
    element.workspace = { ...element.workspace! };
    await settle();
    const recipe = element.shadowRoot!.querySelector('select')!;
    expect(recipe.value).toBe('PR-DEMO-001');
  });
  it('lets a user enter a historical pour end and correct it without changing inventory', async () => {
    const workspace = await setup();
    element
      .shadowRoot!.querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await click('Save one batch');
    await click('Begin preparation');
    await click('Oil mix ready');
    await click('Lye solution ready');
    (
      element.shadowRoot!.querySelector(
        '.checklist input[type="checkbox"]',
      ) as HTMLInputElement
    ).click();
    await settle();
    await click('Combine oils + lye / start timer');
    await click('Mark trace');
    await click('Start pour');
    const source = workspace();
    const start = source.batches!.at(-1)!.production!.pour_started!;
    await click('Enter actual end time');
    expect(workspace()).toBe(source);
    const input = element.shadowRoot!.querySelector(
      'input[name="pourEndAt"]',
    ) as HTMLInputElement;
    const firstDate = new Date(Date.parse(start) + 1000);
    const local = new Date(
      firstDate.getTime() - firstDate.getTimezoneOffset() * 60000,
    )
      .toISOString()
      .slice(0, 19);
    input.value = local;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    await click('Confirm actual pour end');
    expect(workspace().batches!.at(-1)!.status).toBe('poured');
    expect(workspace().batches!.at(-1)!.production!.pour_finished).toBe(
      new Date(local).toISOString(),
    );
    await click('Correct pour end time');
    const form = element.shadowRoot!.querySelector(
      'form[aria-label="Pour end time"]',
    )!;
    const time = form.querySelector(
      'input[name="pourEndAt"]',
    ) as HTMLInputElement;
    const secondDate = new Date(Date.parse(start) + 2000);
    const corrected = new Date(
      secondDate.getTime() - secondDate.getTimezoneOffset() * 60000,
    )
      .toISOString()
      .slice(0, 19);
    time.value = corrected;
    time.dispatchEvent(new Event('input', { bubbles: true }));
    (form.querySelector('input[name="reason"]') as HTMLInputElement).value =
      'Estimated finish from my notes';
    (form.querySelector('input[name="estimated"]') as HTMLInputElement).click();
    await settle();
    await click('Save corrected pour end');
    expect(workspace().batches!.at(-1)!.production!.pour_finished).toBe(
      new Date(corrected).toISOString(),
    );
    expect(
      workspace().batches!.at(-1)!.production!.pour_finished_estimated,
    ).toBe(true);
    expect(element.shadowRoot!.textContent).toContain('(estimated)');
    expect(workspace().inventory).toEqual(source.inventory);
    expect(workspace().integrity!.audit.at(-1)!.action).toContain('pour end');
  });
  it('records an omitted additive explicitly without consuming it and allows the pour to finish', async () => {
    const workspace = await setup();
    element
      .shadowRoot!.querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await click('Save one batch');
    await click('Begin preparation');
    await click('Oil mix ready');
    await click('Lye solution ready');
    await click('Combine oils + lye / start timer');
    await click('Mark trace');
    await click('Start pour');
    const before = workspace().inventory;
    await click('Omit kaolin clay');
    expect(
      workspace().batches!.at(-1)!.production!.additives.kaolin_clay,
    ).toBeUndefined();
    await click('Confirm omitted');
    expect(workspace().inventory).toEqual(before);
    expect(workspace().batches!.at(-1)!.weighing!.actual_g.kaolin_clay).toBe(0);
    expect(element.shadowRoot!.textContent).toContain(
      'kaolin clay omitted (0 g)',
    );
    expect(button('End pour').disabled).toBe(false);
    await click('End pour');
    expect(workspace().batches!.at(-1)!.status).toBe('poured');
  });
  it('explains which additive prevents ending a pour and enables End pour after confirmation', async () => {
    await setup();
    element
      .shadowRoot!.querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await click('Save one batch');
    await click('Begin preparation');
    await click('Oil mix ready');
    await click('Lye solution ready');
    await click('Combine oils + lye / start timer');
    await click('Mark trace');
    await click('Start pour');
    expect(button('End pour').disabled).toBe(true);
    expect(
      element.shadowRoot!.querySelector('[role="status"][id="pour-blocker"]')!
        .textContent,
    ).toContain('kaolin clay');
    (
      element.shadowRoot!.querySelector(
        '.checklist input[type="checkbox"]',
      ) as HTMLInputElement
    ).click();
    await settle();
    expect(button('End pour').disabled).toBe(false);
    await click('End pour');
  });
  it('corrects an additive to 30 seconds after trace without changing its actual weight or stock', async () => {
    const workspace = await setup();
    element
      .shadowRoot!.querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await click('Save one batch');
    await click('Begin preparation');
    await click('Oil mix ready');
    await click('Lye solution ready');
    (
      element.shadowRoot!.querySelector(
        '.checklist input[type="checkbox"]',
      ) as HTMLInputElement
    ).click();
    await settle();
    await click('Combine oils + lye / start timer');
    await click('Mark trace');
    const before = workspace();
    await click('Correct time');
    const form = element.shadowRoot!.querySelector(
      'form[aria-label="Correct additive time"]',
    )!;
    const offset = form.querySelector(
      'input[name="traceOffset"]',
    ) as HTMLInputElement;
    offset.value = '30';
    offset.dispatchEvent(new Event('input', { bubbles: true }));
    const reason = form.querySelector(
      'input[name="reason"]',
    ) as HTMLInputElement;
    reason.value = 'Accidental early click';
    await settle();
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await settle();
    const after = workspace();
    const batch = after.batches!.at(-1)!;
    expect(
      Date.parse(batch.production!.additives.kaolin_clay) -
        Date.parse(batch.production!.trace!),
    ).toBe(30000);
    expect(after.inventory).toEqual(before.inventory);
    expect(batch.weighing).toEqual(before.batches!.at(-1)!.weighing);
  });
  it('keeps the clay choice visible for scented product recipes', async () => {
    await setup();
    const recipe = element.shadowRoot!.querySelector('select')!;
    recipe.value = 'PR-DEMO-001';
    recipe.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(
      [...element.shadowRoot!.querySelectorAll('label')].some((l) =>
        l.textContent!.includes('Kaolin replacement'),
      ),
    ).toBe(true);
  });
  it('shows the correct native select values and creates a single multi-mold plan', async () => {
    const workspace = await setup();
    const selects = [...element.shadowRoot!.querySelectorAll('select')];
    expect(selects.map((s) => s.value)).toEqual([
      'BSR-DEMO-001',
      '',
      'bar_5_2_oz',
      'bar_1_0_oz',
    ]);
    element
      .shadowRoot!.querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(button('Save one batch').disabled).toBe(false);
    await click('Save one batch');
    expect(workspace().batches!.at(-1)!.formulation!.molds).toHaveLength(2);
    expect(button('Begin preparation').disabled).toBe(false);
  });
  it('records parallel prep, mix, trace, additives and pour without losing the batch', async () => {
    const workspace = await setup();
    element
      .shadowRoot!.querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await click('Save one batch');
    expect(button('Combine oils + lye / start timer').disabled).toBe(true);
    await click('Begin preparation');
    await click('Lye solution ready');
    await click('Oil mix ready');
    expect(button('Combine oils + lye / start timer').disabled).toBe(false);
    await click('Combine oils + lye / start timer');
    await click('Mark trace');
    const check = element.shadowRoot!.querySelector(
      '.checklist input[type="checkbox"]',
    ) as HTMLInputElement;
    check.click();
    await settle();
    await click('Start pour');
    await click('End pour');
    const batch = workspace().batches!.at(-1)!;
    expect(batch.status).toBe('poured');
    expect(batch.production!.pour_finished).toBeTruthy();
    expect(element.shadowRoot!.textContent).toContain('Trace at');
    expect(button('Mark unmolded').disabled).toBe(false);
  });
  it('defaults actual fields to whole-gram suggestions and saves edited amounts using +/- controls', async () => {
    const workspace = await setup();
    element
      .shadowRoot!.querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await click('Save one batch');
    const before = workspace().inventory;
    const batch = workspace().batches!.at(-1)!;
    const expected = wholeGramTargets(batch.formulation!);
    const input = element.shadowRoot!.querySelector(
      'input[aria-label="Actual olive oil (g)"]',
    ) as HTMLInputElement;
    expect(input.value).toBe(String(expected.olive_oil));
    expect(input.step).toBe('1');
    await click('Begin preparation');
    expect(workspace().inventory).toEqual(before);
    const plus = element.shadowRoot!.querySelector(
      'button[aria-label="Increase olive oil by 1 g"]',
    ) as HTMLButtonElement;
    plus.click();
    await settle();
    expect(input.value).toBe(String(expected.olive_oil + 1));
    const minus = element.shadowRoot!.querySelector(
      'button[aria-label="Decrease olive oil by 1 g"]',
    ) as HTMLButtonElement;
    minus.click();
    await settle();
    input.value = String(expected.olive_oil + 3);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    await click('Oil mix ready');
    expect(workspace().batches!.at(-1)!.weighing!.actual_g.olive_oil).toBe(
      expected.olive_oil + 3,
    );
    expect(input.disabled).toBe(true);
    expect(workspace().inventory.raw_materials!.olive_oil.on_hand).toBeCloseTo(
      6 - (expected.olive_oil + 3) / 1000,
      8,
    );
  });
});
