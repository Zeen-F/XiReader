import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { fetch as undiciFetch } from 'undici';
import { fetch as runtimeFetch } from '../server/fetch.mjs';

test('server requests use the fetch implementation in the application lockfile', () => {
  assert.equal(runtimeFetch, undiciFetch);
});

test('bounded Zod arrays reject oversized input before visiting elements', () => {
  let visited = 0;
  const schema = z.array(z.preprocess(value => { visited++; return value; }, z.string())).max(2);
  const oversized = schema.safeParse(Array(1000).fill(null));
  assert.equal(oversized.success, false);
  assert.equal(visited, 0);
  assert.equal(oversized.error.issues[0].code, 'too_big');
  assert.deepEqual(schema.parse(['first', 'second']), ['first', 'second']);
  assert.equal(visited, 2);
  assert.equal(schema.safeParse([null]).success, false);
});
