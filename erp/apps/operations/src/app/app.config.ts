import {
  isDevMode,
  inject,
  provideBrowserGlobalErrorListeners,
  type ApplicationConfig,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import {
  provideServiceWorker,
  SwRegistrationOptions,
} from '@angular/service-worker';
import { appRoutes } from './app.routes';
import { WORKSPACE_DATA_PROVIDER } from './workspace-provider';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    provideServiceWorker('ngsw-worker.js'),
    {
      provide: SwRegistrationOptions,
      useFactory: () => ({
        enabled:
          !isDevMode() && inject(WORKSPACE_DATA_PROVIDER).mode === 'browser',
        registrationStrategy: 'registerWhenStable:30000',
      }),
    },
  ],
};
