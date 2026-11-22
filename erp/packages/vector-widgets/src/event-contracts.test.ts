import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { VectorEventDetailMap, VectorSelectDetail } from './vector-types';

test('event detail map preserves event-specific required fields', () => {
  const select = {
    source: 'test',
    role: 'selection',
    transactionId: 'select-1',
    key: 'olive_oil',
  } satisfies VectorEventDetailMap['vector-select'];
  const typed: VectorSelectDetail = select;
  assert.equal(typed.key, 'olive_oil');
});
