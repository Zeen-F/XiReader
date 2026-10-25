// Synthetic loopback fixtures for GHSA-27r3-jxmh-p828. No library is opened.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';

const scenario = process.argv[2];
assert.ok(['compressed-tail', 'unsupported-charset'].includes(scenario));
const guard = setTimeout(() => { console.error('Fixture timed out'); process.exit(2); }, 10_000);
const app = express();
// Same default inflation and JSON limit as the application. The charset case
// also exercises a verifier so rejection must not leave a decoder unhandled.
app.use(express.json({ limit: '2mb', ...(scenario === 'unsupported-charset' ? { verify() {} } : {}) }));
app.post('/', (req, res) => res.json(req.body));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ type: error.type }));
const server = app.listen(0, '127.0.0.1');
let request;
try {
  await once(server, 'listening');
  const body = Buffer.concat([gzipSync(Buffer.from('{"synthetic":true}')), Buffer.from([0]), Buffer.alloc(100 * 1024, 0x58)]);
  const result = await new Promise((resolve, reject) => {
    request = http.request({ host: '127.0.0.1', port: server.address().port, method: 'POST', agent: false, headers: {
      'Content-Type': scenario === 'unsupported-charset' ? 'application/json; charset=utf-999' : 'application/json',
      'Content-Encoding': 'gzip', 'Content-Length': body.length,
    } }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    request.on('error', reject);
    request.setTimeout(3000, () => request.destroy(new Error('Request timed out')));
    request.end(body);
  });
  assert.equal(result.status, scenario === 'unsupported-charset' ? 415 : 200);
  assert.deepEqual(result.body, scenario === 'unsupported-charset' ? { type: 'charset.unsupported' } : { synthetic: true });
  // Give late decoder errors an event-loop turn, then prove service continuity.
  await delay(200);
  const healthy = await fetch(`http://127.0.0.1:${server.address().port}/health`, { signal: AbortSignal.timeout(3000) });
  assert.equal(healthy.status, 200);
  assert.deepEqual(await healthy.json(), { ok: true });
  console.log('PASS', scenario);
} finally {
  request?.destroy();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  clearTimeout(guard);
}
