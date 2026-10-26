import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Render-only DOM contract checks; these are not browser interaction/visual QA.
test('workspace component markup exposes anchored source, bounded scope and honest manual-save states', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { ThreadEditor } = await vite.ssrLoadModule('/src/AnnotationThread.jsx');
    const { default: Scope } = await vite.ssrLoadModule('/src/ContextScopeControl.jsx');
    const { default: AnnotationCard } = await vite.ssrLoadModule('/src/AnnotationCard.jsx');
    const thread = { id: 'thread-a', documentId: 'doc-a', annotationId: 'annotation-a', pdfSha256: 'a'.repeat(64), kind: 'text', page: 2, quote: 'Synthetic anchored quote', sourceStatus: 'verified', revision: 0, messages: [] };
    const props = { libraryId: 'library-a', document: { id: 'doc-a', title: 'Synthetic reading fixture', pageCount: 4 }, thread, onSaved() {}, onJump() {}, onDraftState() {} };
    const html = renderToStaticMarkup(React.createElement(ThreadEditor, props));
    assert.match(html, /data-source-annotation="annotation-a"/);
    assert.match(html, /Synthetic anchored quote/);
    assert.match(html, /PDF 第 2 页/);
    assert.match(html, /不会自动同步/);
    assert.match(html, /type="checkbox"/);
    assert.match(html, /disabled=""[^>]*>[^<]*保存问题到本机/);
    assert.match(html, /id="thread-answer-thread-a"/);
    assert.match(html, /for="thread-answer-thread-a"/);
    const other = renderToStaticMarkup(React.createElement(ThreadEditor, { ...props, thread: { ...thread, id: 'thread-b' } }));
    assert.match(other, /id="thread-answer-thread-b"/); assert.doesNotMatch(other, /id="thread-answer-thread-a"/);
    const scope = renderToStaticMarkup(React.createElement(Scope, { scope: 'custom', pages: '1,2', onChange() {}, idPrefix: 'thread-a', context: { pageCount: 2, characterCount: 18, pages: [{ page: 1 }, { page: 2 }], emptyPages: [2] } }));
    assert.match(scope, /id="thread-a-scope"/); assert.match(scope, /未做 OCR/); assert.match(scope, /不会撤回 Codex/);
    const card = renderToStaticMarkup(React.createElement(AnnotationCard, { annotation: { ...thread, id: 'annotation-a', color: 'yellow', comment: '', createdAt: '2026-01-01' }, drafts: { edit: () => null }, onJump() {}, onDiscuss() {}, libraryId: 'library-a' }));
    assert.match(card, /问 Codex · 讨论这条批注/); assert.equal((card.match(/class="annotation-discuss"/g)||[]).length, 1); assert.match(card, /历史资料（旧讨论与草稿，只读）/); assert.doesNotMatch(card, /3 条记录/); assert.match(card, /aria-label="回到第 2 页批注原文"/);
  } finally { await vite.close(); }
});
