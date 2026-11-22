import { Component, CUSTOM_ELEMENTS_SCHEMA, inject } from '@angular/core';
import type { CalculatorChangeDetail } from '@redmountainsoap/calculator-core';
import '@redmountainsoap/calculator-workbench';
import { CalculatorStateService } from './calculator-state.service';

@Component({
  selector: 'rms-root',
  templateUrl: './app.calculator.html',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class CalculatorApp {
  readonly state = inject(CalculatorStateService);

  onCalculatorChange(event: Event): void {
    const detail = (event as CustomEvent<CalculatorChangeDetail>).detail;
    if (detail?.document) {
      this.state.update(detail.document);
    }
  }
}
