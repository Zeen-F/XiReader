import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createEvidenceSnapshot, assertEvidenceReceipt, evidenceSourceLink, questionContent, createEvidenceSendGuard, uncertainMessageFailure, renderEvidenceReaderTemplate } from '../shared/evidence-snapshot.mjs';
import { readSourceLink, createReadingHistory } from '../shared/source-navigation.mjs';

const libraryId = 'a'.repeat(64), pdfSha256 = 'b'.repeat(64);
const document = { id: '87be954a-c945-4b60-bd14-cb724a908f81', title: 'Synthetic source', pdfSha256, pageCount: 7 };
const sessionId = 'aac64628-3e82-4cd3-b4d3-97daf949c387';
const selection = { documentId: document.id, page: 3, kind: 'text', quote: 'User-approved synthetic quote', rects: [{ x: .1, y: .2, width: .3, height: .1 }] };
const make = patch => createEvidenceSnapshot({ libraryId, document, selection, sessionId, ...patch });

test('evidence freezes exact selected identities, quote and geometry across later navigation', () => {
  const input = structuredClone(selection), snapshot = make({ selection: input });
  input.quote = 'later page'; input.page = 5; input.rects[0].x = .6;
  assert.equal(snapshot.quote, selection.quote); assert.equal(snapshot.physicalPage, 3); assert.equal(snapshot.rects[0].x, .1);
  assert.equal(snapshot.libraryId, libraryId); assert.equal(snapshot.pdfSha256, pdfSha256);
  assert.throws(() => { snapshot.sourceRef.page = 6; }, TypeError);
  assert.throws(() => snapshot.rects.push({}), TypeError);
  assert.ok(evidenceSourceLink(snapshot, 'http://127.0.0.1:4317').startsWith('http://127.0.0.1:4317/?'));
  for (const origin of ['https://model.example', 'http://user:pass@127.0.0.1:4317', 'http://127.0.0.1:4317/arbitrary', 'javascript:alert(1)']) assert.throws(() => evidenceSourceLink(snapshot, origin));
  assert.deepEqual(readSourceLink(evidenceSourceLink(snapshot).slice(2)), { ...snapshot.sourceRef, captureId: null, annotationId: null, invalid: false });
});

test('unconfirmed library, wrong document, invalid page/hash and untrusted URLs cannot become evidence', () => {
  for (const patch of [{ libraryId: null }, { libraryId: 'wrong' }, { document: { ...document, pdfSha256: 'stale' } },
    { selection: { ...selection, documentId: sessionId } }, { selection: { ...selection, page: 8 } },
    { selection: { ...selection, annotationId: sessionId } }, { selection: { ...selection, captureId: sessionId } },
    { selection: { ...selection, url: 'https://model.example/fake.pdf' } }, { selection: { ...selection, sourceRef: { documentId: document.id } } },
    { selection: { ...selection, rects: [{ x: .9, y: 0, width: .2, height: .2 }] } }, { selection: { ...selection, quote: 'x'.repeat(12001) } }]) assert.throws(() => make(patch));
});

test('only separately resolved same-library local anchors are incorporated; raw selection anchors are rejected', () => {
  const source = { libraryId, documentId: document.id, pdfSha256, page: 3, annotationId: sessionId };
  const snapshot = createEvidenceSnapshot({ libraryId, document, selection }, source);
  assert.equal(readSourceLink(evidenceSourceLink(snapshot).slice(2)).annotationId, sessionId);
  for (const bad of [{ ...source, libraryId: 'c'.repeat(64) }, { ...source, documentId: sessionId }, { ...source, page: 4 },
    { ...source, pdfSha256: 'c'.repeat(64) }, { ...source, annotationId: 'unknown' }, { ...source, captureId: sessionId }]) assert.throws(() => createEvidenceSnapshot({ libraryId, document, selection }, bad));
});

test('receipt must acknowledge the same immutable snapshot; delayed or missing identity cannot silently downgrade', () => {
  const snapshot = make(); assert.equal(assertEvidenceReceipt(snapshot, structuredClone(snapshot)), snapshot);
  for (const actual of [null, { ...snapshot, pdfSha256: 'c'.repeat(64) }, { ...snapshot, libraryId: 'c'.repeat(64) },
    { ...snapshot, physicalPage: 4 }, { ...snapshot, quote: 'later quote' }, { ...snapshot, sourceRef: { ...snapshot.sourceRef, annotationId: sessionId } }]) assert.throws(() => assertEvidenceReceipt(snapshot, actual), /未发送问题/);
});

test('message content is bounded selection-only, app-generated source link and no guessed image OCR', () => {
  const snapshot = make(), content = questionContent('Explain this.', snapshot);
  assert.equal(content.length, 1); assert.ok(content[0].text.includes(JSON.stringify(selection.quote)));
  assert.ok(content[0].text.includes(pdfSha256)); assert.match(content[0].text, /不读取整本书或笔记，不自动保存回答/);
  assert.doesNotMatch(content[0].text, /https:\/\/model/);
  const region = make({ selection: { ...selection, kind: 'region', quote: '' } });
  assert.throws(() => questionContent('Explain figure.', region, 'https://model.example/image.png'));
  const image = questionContent('Explain figure.', region, 'data:image/png;base64,aGVsbG8=');
  assert.equal(image[1].data, 'aGVsbG8='); assert.match(image[0].text, /仅讨论截图中可见/);
});

test('same-source repeated navigation deduplicates but distinct library identity does not collapse', () => {
  const first = make().sourceRef, history = createReadingHistory();
  history.visit(first); history.visit(first); assert.equal(history.snapshot().length, 1);
  history.visit({ ...first, libraryId: 'c'.repeat(64) }); assert.equal(history.snapshot().length, 2);
});

test('manual-send guard prevents duplicate pending and uncertain sends; definite rejection permits explicit retry', () => {
  const evidence = make(), guard = createEvidenceSendGuard(), question = 'Explain this.';
  const first = guard.begin(evidence, question); assert.throws(() => guard.begin(evidence, question), /处理中/);
  guard.sending(first); guard.settle(first, 'uncertain'); assert.throws(() => guard.begin(evidence, question), /查看当前对话/);
  const second = guard.begin(evidence, 'A different question'); guard.sending(second); guard.settle(second, 'rejected');
  assert.ok(guard.begin(evidence, 'A different question'));
});

test('cancelling before message sends nothing; cancelling after dispatch remains uncertain', () => {
  const evidence = make(), guard = createEvidenceSendGuard();
  const before = guard.begin(evidence, 'before'); guard.settle(before, 'cancelled'); assert.equal(guard.isUncertain(evidence, 'before'), false);
  const after = guard.begin(evidence, 'after'); guard.sending(after); guard.settle(after, 'cancelled'); assert.equal(guard.isUncertain(evidence, 'after'), true);
  assert.equal(uncertainMessageFailure(new Error('transport ended'), 'sending'), true);
  assert.equal(uncertainMessageFailure({ definitelyRejected: true }, 'sending'), false);
  assert.equal(uncertainMessageFailure({ rpcCode: -32601 }, 'sending'), false);
  assert.equal(uncertainMessageFailure({ rpcCode: -32000 }, 'sending'), true);
  assert.equal(uncertainMessageFailure({ uncertain: true }, 'sharing'), false);
});

test('the MCP resource uses the same factory inline under unchanged offline CSP, with safe config escaping', async () => {
  const template = await readFile(new URL('../plugins/paperdesk/ui/reader.html', import.meta.url), 'utf8');
  const html = renderEvidenceReaderTemplate(template, { baseUrl: 'http://localhost:4317', libraryId, extra: '</script><script>bad()</script>\u2028' });
  assert.doesNotMatch(html, /__PAPERDESK_(?:CONFIG|EVIDENCE_TOOLS)__/);
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.doesNotMatch(html, /<script\s+src=|import\s*\(|fetch\(/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]; assert.ok(new vm.Script(script));
});
