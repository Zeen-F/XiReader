import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createEvidenceTools } from '../shared/evidence-snapshot.mjs';

// Execute the actual panel send handlers against a controlled RPC boundary.
// This is a protocol regression, not a browser/real-host visual acceptance test.
const source = await readFile(new URL('../plugins/paperdesk/ui/reader.html', import.meta.url), 'utf8');
const handlers = source.slice(source.indexOf('function questionContent('), source.indexOf('function parseDeepLink('));
const libraryId = 'a'.repeat(64), pdfSha256 = 'b'.repeat(64);
const doc = { id: '87be954a-c945-4b60-bd14-cb724a908f81', title: 'Synthetic', pdfSha256, pageCount: 5 };
const sessionId = 'aac64628-3e82-4cd3-b4d3-97daf949c387';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function harness({ session, context, message, capabilities } = {}) {
  const evidenceTools = createEvidenceTools();
  const selected = { kind: 'text', text: 'Selected only', rects: [], documentId: doc.id, page: 2 };
  selected.evidence = evidenceTools.createEvidenceSnapshot({ libraryId, document: doc, selection: selected, sessionId });
  const messages = [], tools = [], statuses = [], errors = [];
  const elements = new Proxy({}, { get(target, key) { return target[key] ||= { hidden: false, textContent: '', value: '' }; } });
  const scope = vm.createContext({ evidenceTools, selected, doc, sessionId, elements, baseUrl: new URL('http://127.0.0.1:4317'), document: { visibilityState: 'visible' },
    capabilities: capabilities || { message: { text: {}, image: {} } },
    metadata: (result, key) => result._meta[key], hideError() {}, updateControls() {}, status: value => statuses.push(value), error: value => errors.push(value),
    queueSession: async () => ({ _meta: { session: { evidence: session ? await session(selected.evidence) : selected.evidence } } }),
    tool: async name => { tools.push(name); return { structuredContent: { evidence: context ? await context(selected.evidence) : selected.evidence } }; },
    request: async (name, params) => { messages.push({ name, params }); return message ? message(params) : {}; },
  });
  vm.runInContext(`const questionSendGuard = evidenceTools.createEvidenceSendGuard();let current=doc,page=2,draftSelection=selected,sharedSelection=null,closing=false,shareBusy=false,questionTask=null,questionUncertain=false,contextVersion=0;${handlers}`, scope);
  return { scope, messages, tools, statuses, errors, elements, ask: question => scope.askSelection(question),
    change: script => vm.runInContext(script, scope), selected };
}

test('selection preview and unsupported host send no RPC or model message; copy is explicitly not sent', async () => {
  const h = harness({ capabilities: {} }); assert.equal(h.messages.length, 0);
  await h.ask('Explain'); assert.equal(h.messages.length, 0); assert.equal(h.tools.length, 0);
  assert.match(h.elements['question-status'].textContent, /尚未发送/);
  assert.match(h.elements['question-copy'].value, /Selected only/);
});

test('an acknowledged evidence snapshot sends exactly once and never writes notes', async () => {
  const hold = deferred(), h = harness({ message: () => hold.promise });
  const first = h.ask('Explain'); await new Promise(resolve => setImmediate(resolve));
  await h.ask('Explain'); assert.equal(h.messages.length, 1);
  assert.deepEqual(h.tools, ['paperdesk_get_context']);
  hold.resolve({}); await first;
  assert.match(h.messages[0].params.content[0].text, new RegExp(pdfSha256));
  assert.equal(h.change('draftSelection'), null); assert.match(h.statuses.at(-1), /已发送/);
});

test('page/document change while context acknowledgement is delayed sends zero messages', async () => {
  const hold = deferred(), h = harness({ context: () => hold.promise });
  const pending = h.ask('Explain'); await new Promise(resolve => setImmediate(resolve));
  h.change('contextVersion++;page=3;draftSelection=null;'); hold.resolve(h.selected.evidence); await pending;
  assert.equal(h.messages.length, 0); assert.equal(h.statuses.length, 0);
});

test('stale hash, another library, missing identity or substituted quote in receipt cannot send', async () => {
  for (const change of [value => ({ ...value, pdfSha256: 'c'.repeat(64) }), value => ({ ...value, libraryId: 'c'.repeat(64) }),
    () => null, value => ({ ...value, quote: 'Unknown source' })]) {
    const h = harness({ context: change }); await h.ask('Explain');
    assert.equal(h.messages.length, 0); assert.match(h.errors.at(-1), /未发送问题/);
    assert.notEqual(h.change('draftSelection'), null);
  }
});

test('transport uncertainty blocks repeated sends even after reopening the same preview', async () => {
  const h = harness({ message: () => { const error = new Error('lost response'); error.uncertain = true; throw error; } });
  await h.ask('Explain'); assert.equal(h.messages.length, 1); assert.match(h.errors.at(-1), /未能确认/);
  h.change('questionUncertain=false;draftSelection=selected;'); await h.ask('Explain');
  assert.equal(h.messages.length, 1); assert.match(h.errors.at(-1), /尚未确认/);
});

test('late accepted message after cancellation never claims cancellation or retries', async () => {
  const hold = deferred(), h = harness({ message: () => hold.promise });
  const pending = h.ask('Explain'); await new Promise(resolve => setImmediate(resolve));
  h.change("questionSendGuard.settle(questionTask,'cancelled');contextVersion++;draftSelection=null;");
  hold.resolve({}); await pending; assert.equal(h.messages.length, 1); assert.equal(h.statuses.length, 0);
  h.change('questionUncertain=false;draftSelection=selected;'); await h.ask('Explain'); assert.equal(h.messages.length, 1);
});

test('definite host refusal retains preview and only a new manual call retries', async () => {
  let rejected = true; const h = harness({ message: () => ({ isError: rejected }) });
  await h.ask('Explain'); assert.equal(h.messages.length, 1); assert.match(h.errors.at(-1), /拒绝/);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(h.messages.length, 1);
  rejected = false; await h.ask('Explain'); assert.equal(h.messages.length, 2);
  assert.deepEqual(h.messages[0], h.messages[1]);
});
