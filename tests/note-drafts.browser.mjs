import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createApp } from '../server/app.mjs';
import { graphicsOnlyPdf } from './fixtures/scan-browser.mjs';

// Two actual libraries intentionally retain the same document ID/revision. A
// test-owned dispatcher switches them behind one loopback origin, so browser
// storage really is shared. The source is closed before copying the synthetic
// fixture; no running SQLite database or user library is copied.
export async function noteDraftLibraryWorkflow({ context }) {
  const fixture = await mkdtemp(path.join(tmpdir(), 'paperdesk-note-libraries-'));
  const libraries = { a: path.join(fixture, 'library-a'), b: path.join(fixture, 'library-b') };
  const runtimes = new Set(), pages = [], pageErrors = [];
  let active, activeName = 'a', releaseIdentity;
  const server = createServer((request, response) => {
    if (active) active.app(request, response);
    else { response.writeHead(503); response.end('Synthetic library switch'); }
  });
  const start = async name => {
    const runtime = createApp({ dataDir: libraries[name] }); runtimes.add(runtime);
    await runtime.ready; return runtime;
  };
  const switchTo = (name, runtime) => { activeName = name; active = runtime; };
  try {
    switchTo('a', await start('a'));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const upload = new FormData();
    upload.append('file', new Blob([graphicsOnlyPdf()], { type: 'application/pdf' }), 'synthetic-note-libraries.pdf');
    const uploaded = await fetch(`${base}/api/documents`, { method: 'POST', body: upload });
    assert.equal(uploaded.status, 201);
    const { document } = await uploaded.json(), endpoint = `${base}/api/documents/${document.id}`;
    const savedText = 'Same initial note in both synthetic libraries';
    const saved = await fetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notesZh: savedText, notesEn: '', expectedNotesRevision: document.notesRevision }) });
    assert.equal(saved.status, 200);
    const initial = (await saved.json()).document;
    const sourceRuntime = active; active = null;
    await sourceRuntime.close(); runtimes.delete(sourceRuntime);
    await cp(libraries.a, libraries.b, { recursive: true });
    const a = await start('a'), b = await start('b');
    switchTo('a', a);
    const read = async () => (await (await fetch(endpoint)).json()).document;
    const libraryId = async () => (await (await fetch(`${base}/api/plugin/status`)).json()).libraryId;
    const aId = await libraryId(); switchTo('b', b);
    const bId = await libraryId(), copy = await read();
    assert.notEqual(aId, bId);
    assert.equal(copy.id, initial.id); assert.equal(copy.notesRevision, initial.notesRevision);
    switchTo('a', a);

    const page = await context.newPage(); pages.push(page);
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    let rejectAWrites = true, phase = 'a';
    const noteWrites = [];
    page.on('request', request => {
      if (request.url() === endpoint && request.method() === 'PATCH' && typeof request.postDataJSON()?.notesZh === 'string') noteWrites.push({ phase, body: request.postDataJSON() });
    });
    await page.route(endpoint, async route => {
      const body = route.request().method() === 'PATCH' ? route.request().postDataJSON() : null;
      if (activeName === 'a' && rejectAWrites && typeof body?.notesZh === 'string') await route.abort('failed');
      else await route.continue();
    });
    await page.goto(`${base}/?document=${document.id}&page=1`);
    const editor = page.getByRole('textbox', { name: '笔记', exact: true });
    await expect(editor).toHaveValue(savedText);
    const aText = 'Unsaved note belongs only to synthetic library A';
    await editor.fill(aText); await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.locator('.save-row [role="status"]')).toHaveText('保存失败，草稿已保留');
    assert.equal((await read()).notesZh, savedText);
    const aPrefix = `paperdesk-note-draft-v2:${encodeURIComponent(aId)}:${encodeURIComponent(document.id)}:`;
    const originalDrafts = await page.evaluate(prefix => Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith(prefix)).map(key => [key, localStorage.getItem(key)])), aPrefix);
    assert.equal(Object.keys(originalDrafts).length, 1);

    // A live stale editor must not save or archive into B even when CAS matches.
    switchTo('b', b); rejectAWrites = false;
    const staleSave = page.waitForResponse(response => response.url() === endpoint && response.request().method() === 'PATCH' && response.request().postDataJSON()?.notesZh === aText);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const rejected = await staleSave;
    assert.equal(rejected.status(), 409);
    assert.equal((await rejected.json()).code, 'LIBRARY_IDENTITY_MISMATCH');
    await expect(page.locator('.notes-save-failure')).toBeVisible();
    await expect(page.locator('.notes-conflict')).toHaveCount(0);
    await expect(editor).toHaveValue(aText); assert.equal((await read()).notesZh, savedText);

    // A delayed identity response cannot expose a document-only draft editor.
    let identityEntered;
    const entered = new Promise(resolve => { identityEntered = resolve; });
    const identityGate = new Promise(resolve => { releaseIdentity = resolve; });
    const holdIdentity = async route => { identityEntered(); await identityGate; await route.continue(); };
    await page.route(`${base}/api/plugin/status`, holdIdentity);
    // Choose the document explicitly in B rather than replaying A's scoped
    // source URL, which is correctly rejected by source-navigation guards.
    phase = 'b'; await page.goto(`${base}/?document=${document.id}&page=1`); await entered;
    await expect(editor).toHaveCount(0);
    releaseIdentity(); await page.unroute(`${base}/api/plugin/status`, holdIdentity);
    await expect(editor).toHaveValue(savedText);
    await expect(page.locator('.historical-drafts')).toHaveCount(0);
    await expect(page.locator('.preserved-drafts')).toHaveCount(0);
    // Cross the 200 ms recovery and 650 ms autosave boundaries deliberately.
    await page.waitForTimeout(800);
    assert.deepEqual(noteWrites.filter(entry => entry.phase === 'b'), []);
    assert.equal((await read()).notesZh, savedText);
    assert.deepEqual(await page.evaluate(prefix => Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith(prefix)).map(key => [key, localStorage.getItem(key)])), aPrefix), originalDrafts);

    switchTo('a', a); rejectAWrites = true; phase = 'return-a';
    await page.goto(`${base}/?document=${document.id}&page=1`); await expect(editor).toHaveValue(aText);
    await expect(page.locator('.save-row [role="status"]')).toHaveText('保存失败，草稿已保留');
    assert.equal((await read()).notesRevision, initial.notesRevision);
    assert.ok(noteWrites.filter(entry => entry.phase === 'return-a').every(entry => entry.body.expectedLibraryId === aId));
    assert.deepEqual(pageErrors, []);
    console.log('PASS: same-origin duplicate-document libraries isolate notes, delay unconfirmed editing, reject live stale-library saves, and recover the original A draft');
  } finally {
    releaseIdentity?.();
    const failures = [], stop = async action => { try { await action(); } catch (error) { failures.push(error); } };
    await Promise.all(pages.map(page => stop(() => page.close())));
    if (server.listening) {
      server.closeAllConnections();
      await stop(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    }
    await Promise.all([...runtimes].map(runtime => stop(() => runtime.close())));
    if (!failures.length) await rm(fixture, { recursive: true, force: true });
    if (failures.length) throw new AggregateError(failures, 'Synthetic note-library cleanup failed; fixture retained for recovery');
  }
}
