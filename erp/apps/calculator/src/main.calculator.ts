import { bootstrapApplication } from '@angular/platform-browser';
import { CalculatorApp } from './app/app.calculator';
import { calculatorAppConfig } from './app/app.config.calculator';

bootstrapApplication(CalculatorApp, calculatorAppConfig).catch((error) =>
  console.error(error),
);
