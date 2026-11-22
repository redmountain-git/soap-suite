import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { WorkspaceService } from './workspace.service';
import { appRoutes } from './app.routes';

describe('App', () => {
  const workspaceStub = {
    sqliteMode: false,
    initialize: vi.fn(),
    exportBackup: vi.fn(),
    resetDemo: vi.fn(),
    reports: signal(null),
    workspace: signal({ name: 'SIMULATION - Test workspace' }),
    statusMessage: signal('Local workspace ready.'),
    statusIsError: signal(false),
  };

  beforeEach(async () => {
    workspaceStub.initialize.mockClear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        { provide: WorkspaceService, useValue: workspaceStub },
      ],
    }).compileComponents();
  });

  it('renders the ERP shell', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('h1')?.textContent).toContain(
      'Red Mountain Soap Suite',
    );
    expect(compiled.querySelector('#sync-state')?.textContent).toContain(
      'Local workspace ready.',
    );
    expect(workspaceStub.initialize).toHaveBeenCalled();
    expect(compiled.querySelector('.brand')?.textContent).toContain(
      'SIMULATION - Test workspace',
    );
    expect(compiled.querySelector('nav')?.textContent).toContain('Production');
    expect(compiled.querySelector('nav')?.textContent).toContain('Finances');
    expect(compiled.querySelector('.metric-grid')).toBeNull();
    expect(
      compiled.querySelector('button[title="Reset demo data"]'),
    ).toBeNull();
  });
  it('opens production and retains previous route links', () => {
    expect(appRoutes.find((r) => r.path === '')?.redirectTo).toBe('production');
    expect(appRoutes.find((r) => r.path === 'flow')?.redirectTo).toBe(
      'production',
    );
    expect(appRoutes.find((r) => r.path === 'stock')?.redirectTo).toBe(
      'inventory',
    );
    expect(appRoutes.find((r) => r.path === 'files')?.redirectTo).toBe(
      'settings',
    );
  });
});
