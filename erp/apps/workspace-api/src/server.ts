import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import type {
  AnyWorkerRequest,
  WorkerCommandName,
} from '@rmsc/worker-protocol';
import { isWorkspaceMutation } from '../../../packages/local-store/src/commands';
import type { SqliteWorkspaceStore } from './sqlite-store';

const payloadFields = {
  seedWorkspace: {},
  getWorkspace: {},
  exportBackup: {},
  listRecovery: {},
  calculateBatch: { recipeId: 'string', volumeIn3: 'number' },
  savePlannedBatch: { input: 'object' },
  runCapacityAudit: {},
  addBaseRecipe: { raw: 'string' },
  recordReceipt: {
    vendor: 'string',
    date: 'string',
    paymentMethod: 'string',
    itemName: 'string',
    material: 'string',
    quantity: 'number',
    unit: 'string',
    total: 'number',
  },
  applyReceiptToInventory: { receipt: 'object' },
  recordAsset: {
    name: 'string',
    amountUsd: 'number',
    usefulLifeMonths: 'number',
  },
  recordBatchEvent: { batchId: 'string', eventType: 'string' },
  recordNextBatchEvent: { batchId: 'string' },
  recordProductionStep: { batchId: 'string', step: 'string' },
  correctAdditiveTimestamp: {
    batchId: 'string',
    material: 'string',
    expectedAt: 'string',
    at: 'string',
    reason: 'string',
  },
  correctAdditiveOmission: {
    batchId: 'string',
    material: 'string',
    expectedAt: 'string',
    expectedWeightG: 'number',
    reason: 'string',
  },
  correctPourEndTimestamp: {
    batchId: 'string',
    expectedAt: 'string',
    at: 'string',
    reason: 'string',
  },
  enableBatchWeighing: { batchId: 'string' },
  recordCutYield: { batchId: 'string', sizeCounts: 'object' },
  recordCureWeighIn: {
    batchId: 'string',
    at: 'string',
    sizeCounts: 'object',
    weightGBySize: 'object',
  },
  postFinishedGoods: { batchId: 'string' },
  runCosting: {},
  previewImport: { raw: 'string' },
  importBackup: { raw: 'string' },
  commitImport: { token: 'string' },
  previewRecovery: { recoveryId: 'string' },
  previewReconstruction: {
    openingDate: 'string',
    openingInventory: 'object',
    adjustments: 'array',
  },
  commitReconstruction: { token: 'string' },
  resetDemo: { confirmed: 'boolean' },
} satisfies Record<WorkerCommandName, Record<string, string>>;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requestFromJson(body: unknown): AnyWorkerRequest | null {
  if (
    !isObject(body) ||
    !Number.isSafeInteger(body['id']) ||
    typeof body['command'] !== 'string' ||
    !Object.hasOwn(payloadFields, body['command']) ||
    !isObject(body['payload'])
  )
    return null;
  const command = body['command'] as WorkerCommandName;
  const mutationId = body['mutationId'];
  if (
    isWorkspaceMutation(command) &&
    (typeof mutationId !== 'string' ||
      !mutationId.trim() ||
      mutationId.length > 128)
  )
    return null;
  if (body['clientId'] !== undefined && typeof body['clientId'] !== 'string')
    return null;
  for (const [field, kind] of Object.entries(payloadFields[command])) {
    const value = body['payload'][field];
    if (
      kind === 'object'
        ? !isObject(value)
        : kind === 'array'
          ? !Array.isArray(value)
          : typeof value !== kind ||
            (kind === 'number' && !Number.isFinite(value))
    )
      return null;
  }
  return body as unknown as AnyWorkerRequest;
}

export function workspaceApp(store: SqliteWorkspaceStore, browserRoot: string) {
  const index = readFileSync(join(browserRoot, 'index.html'), 'utf8').replace(
    /<head(?:\s[^>]*)?>/i,
    (head) => `${head}<meta name="soap-suite-workspace" content="sqlite">`,
  );
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (req.get('host') !== `127.0.0.1:${req.socket.localPort}`) {
      res.sendStatus(403);
      return;
    }
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.post(
    '/api/v1/commands',
    (req, res, next) => {
      if (req.get('origin') !== `http://127.0.0.1:${req.socket.localPort}`) {
        res.status(403).json({
          id: null,
          ok: false,
          error: 'Same-origin request required.',
        });
        return;
      }
      if (!req.is('application/json')) {
        res
          .status(415)
          .json({ id: null, ok: false, error: 'JSON request required.' });
        return;
      }
      next();
    },
    express.json({ limit: '16mb' }),
    async (req, res) => {
      const request = requestFromJson(req.body);
      if (!request) {
        res
          .status(400)
          .json({ id: null, ok: false, error: 'Invalid workspace command.' });
        return;
      }
      try {
        const { result, revision } = await store.execute(request);
        res.json({ id: request.id, ok: true, result, revision });
      } catch (error) {
        res.json({
          id: request.id,
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Workspace command failed.',
        });
      }
    },
  );
  app.use('/api', (_req, res) => res.sendStatus(404));
  const invalidBody: ErrorRequestHandler = (error, _req, res, _next) => {
    res
      .status(error.status === 413 ? 413 : 400)
      .json({ id: null, ok: false, error: 'Invalid JSON request body.' });
  };
  app.use(invalidBody);
  app.use((req, res, next) => {
    const path = decodeURIComponent(req.path).toLowerCase();
    if (/(?:^|\/)ngsw(?:-worker\.js|\.json)$/.test(path)) {
      res.sendStatus(404);
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (path.endsWith('/index.html')) {
        res.set('Cache-Control', 'no-store').type('html').send(index);
        return;
      }
      if (/\.html?$/.test(path)) {
        res.sendStatus(404);
        return;
      }
    }
    next();
  });
  app.use(
    express.static(browserRoot, {
      index: false,
      redirect: false,
      setHeaders(res) {
        res.setHeader('Cache-Control', 'no-store');
      },
    }),
  );
  app.get('*', (req, res) => {
    if (!req.accepts('html') || /\.[^/]+$/.test(req.path)) {
      res.sendStatus(404);
      return;
    }
    res.set('Cache-Control', 'no-store').type('html').send(index);
  });
  return app;
}
