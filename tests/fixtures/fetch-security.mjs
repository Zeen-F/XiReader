// GHSA-xjj6-f33q-929c: only synthetic loopback traffic and a temporary library.
// An optional app root lets the same assertion exercise the built package.
import assert from 'node:assert/strict';
import { clearInheritedTestStorage } from '../../scripts/test-isolated.mjs';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
clearInheritedTestStorage();
const root = process.argv[2] || fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(path.join(root, 'package.json'));
const { fetch } = await import(pathToFileURL(path.join(root, 'server/fetch.mjs')));
const { createApp } = await import(pathToFileURL(path.join(root, 'server/app.mjs')));
const versions = { electron: process.versions.electron || null, node: process.versions.node, embeddedUndici: process.versions.undici, applicationUndici: require('undici/package.json').version };
console.log(JSON.stringify(versions));
const guard = setTimeout(() => { console.error('Fixture timed out'); process.exit(2); }, 15_000);
const sockets = new Set();
let bad = true, requests = 0;
const provider = net.createServer(socket => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket));
  socket.once('data', () => {
    requests++;
    if (bad) socket.end('HTTP/1.1 200 OK\r\nContent-Encoding: gzip, gzip, gzip, gzip, gzip, gzip\r\nContent-Length: 1\r\nConnection: close\r\n\r\n');
    else {
      const body = JSON.stringify({ choices: [{ message: { content: '合成译文' } }] });
      socket.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
    }
  });
});
const dataDir = await mkdtemp(path.join(tmpdir(), 'paperdesk-fetch-security-'));
let runtime, server;
try {
  await once(provider.listen(0, '127.0.0.1'), 'listening');
  const endpoint = `http://127.0.0.1:${provider.address().port}/v1/chat/completions`;
  await assert.rejects(fetch(endpoint, { signal: AbortSignal.timeout(3000) }), error => /content-encoding/.test(error.cause?.message));
  await delay(100);
  runtime = createApp({ dataDir, vaultDir: null });
  server = runtime.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const jsonRequest = (url, method, body) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  const config = await jsonRequest('/api/translation/settings', 'PUT', { provider: 'openai-compatible', apiKey: 'synthetic-only', endpoint, model: 'synthetic', monthlyLimit: 50000 });
  assert.equal(config.status, 200, await config.text());
  const failure = await jsonRequest('/api/translation', 'POST', { text: 'Synthetic source', from: 'en', to: 'zh' });
  assert.equal(failure.status, 502);
  const error = await failure.json();
  assert.deepEqual(Object.keys(error), ['error']);
  assert.ok(!JSON.stringify(error).includes('synthetic-only'));
  await delay(100);
  assert.equal(requests, 2, 'Failure must not auto-retry');
  const documents = await fetch(base + '/api/documents');
  assert.equal(documents.status, 200);
  assert.deepEqual((await documents.json()).documents, []);
  bad = false;
  const recovered = await jsonRequest('/api/translation', 'POST', { text: 'Synthetic source', from: 'en', to: 'zh' });
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).translation.translatedText, '合成译文');
  assert.equal(requests, 3, 'An explicit retry sends exactly once');
  console.log('PASS: malformed upstream response is contained; service and explicit retry survive');
} finally {
  server?.closeAllConnections();
  if (server) await new Promise(resolve => server.close(resolve));
  await runtime?.close();
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => provider.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
  clearTimeout(guard);
}
