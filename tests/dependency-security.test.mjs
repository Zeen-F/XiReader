import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { isolatedTestEnvironment } from '../scripts/test-isolated.mjs';

const run = promisify(execFile);
// Run crash regressions in their own process; never intercept uncaught errors.
for (const scenario of ['compressed-tail', 'unsupported-charset']) {
  test(`JSON middleware survives ${scenario} and still serves a healthy request`, async () => {
    const result = await run(process.execPath, [fileURLToPath(new URL('./fixtures/dependency-security.mjs', import.meta.url)), scenario], {
      env: isolatedTestEnvironment(), timeout: 15_000, maxBuffer: 1024 * 1024,
    });
    assert.match(result.stdout, /PASS/);
  });
}

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

test('runtime fetch and translation survive malformed upstream encoding and recover', async () => {
  const result = await run(process.execPath, [fileURLToPath(new URL('./fixtures/fetch-security.mjs', import.meta.url))], {
    env: isolatedTestEnvironment(), timeout: 20_000, maxBuffer: 1024 * 1024,
  });
  assert.match(result.stdout, /PASS/);
});
