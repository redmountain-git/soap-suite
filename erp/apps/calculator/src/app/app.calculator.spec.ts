import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createDefaultCalculatorDocument } from '@redmountainsoap/calculator-core';
import { CalculatorApp } from './app.calculator';
import { CalculatorStateService } from './calculator-state.service';

describe('CalculatorApp', () => {
  const stateStub = {
    document: signal(createDefaultCalculatorDocument()),
    status: signal('Calculator ready.'),
    statusIsError: signal(false),
    reset: vi.fn(),
    update: vi.fn(),
  };

  beforeEach(async () => {
    stateStub.reset.mockClear();
    stateStub.update.mockClear();
    await TestBed.configureTestingModule({
      imports: [CalculatorApp],
      providers: [{ provide: CalculatorStateService, useValue: stateStub }],
    }).compileComponents();
  });

  it('renders the public calculator shell without operational controls', async () => {
    const fixture = TestBed.createComponent(CalculatorApp);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('h1')?.textContent).toContain(
      'Design and balance a soap recipe',
    );
    expect(compiled.textContent).toContain('Calculator ready.');
    expect(compiled.querySelector('.tabs')).toBeNull();
    expect(compiled.querySelector('.metric-grid')).toBeNull();
    expect(compiled.querySelector('.top-actions')).toBeNull();
    expect(compiled.querySelector('recipe-vector-workbench')).toBeTruthy();
  });
});
