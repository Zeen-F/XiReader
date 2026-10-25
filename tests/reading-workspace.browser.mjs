import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';

// Synthetic local fixture only. No model, translation, private PDF or host session.
export async function readingWorkspaceWorkflow({ context, base, onPreview }) {
  const page = await context.newPage(), pages = [page], errors = [];
  const json = async (path, body, method = 'GET') => {
    const response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.ok(response.ok, `${method} ${path}: ${response.status}`); return response.json();
  };
  const form = new FormData();
  form.append('file', new Blob([await readFile(new URL('../public/examples/reading-demo.pdf', import.meta.url)), `\n% workspace-${randomUUID()}\n`]), 'synthetic-reading-workspace.pdf');
  const uploaded = await fetch(`${base}/api/documents`, { method: 'POST', body: form }); assert.equal(uploaded.status, 201);
  const { document } = await uploaded.json(), { libraryId } = await json('/plugin/status');
  const annotations = [];
  for (const [index, quote] of ['A bounded synthetic quotation.', 'Another independent source anchor.'].entries()) annotations.push((await json(`/documents/${document.id}/annotations`, { page: 1, kind: 'text', quote, comment: `Synthetic annotation ${index + 1}`, color: 'yellow', rects: [{ x: .1, y: .2 + index * .1, width: .3, height: .04 }], requestId: randomUUID() }, 'POST')).annotation);
  const openNotes = async target => { const expand = target.getByRole('button', { name: '展开笔记面板', exact: true }); if (await expand.isVisible()) await expand.click(); };
  const openDiscussion = async (target, index = 0) => {
    await openNotes(target); await target.getByRole('tab', { name: /^批注/ }).click();
    await target.locator(`[data-annotation-id="${annotations[index].id}"]`).getByRole('button', { name: /讨论这条批注/ }).click();
    await expect(target.locator(`.thread-source-card[data-source-annotation="${annotations[index].id}"]`)).toBeVisible();
  };
  const question = target => target.getByRole('textbox', { name: '批注讨论问题', exact: true });
  try {
    page.on('pageerror', failure => errors.push(failure.message));
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto(`${base}/?document=${document.id}&page=1&libraryId=${libraryId}`);
    await expect(page.getByLabel('PDF 第 1 页', { exact: true })).toBeVisible();
    await expect(page.locator('.brand')).toContainText('XiReader');
    assert.equal(new URL(page.url()).searchParams.get('libraryId'), libraryId);
    const left = page.getByRole('separator', { name: '调整文献栏宽度', exact: true });
    const expandLibrary = page.getByRole('button', { name: '展开文献栏', exact: true }); if (await expandLibrary.isVisible()) await expandLibrary.click();
    await left.focus(); await page.keyboard.press('End'); await expect(left).toHaveAttribute('aria-valuenow', '360');
    await page.keyboard.press('Home'); await expect(left).toHaveAttribute('aria-valuenow', '200');
    await left.dblclick(); await expect(left).toHaveAttribute('aria-valuenow', '244');
    await openNotes(page);
    const right = page.getByRole('separator', { name: '调整笔记面板宽度', exact: true });
    await right.focus(); await page.keyboard.press('ArrowLeft'); await expect(right).toHaveAttribute('aria-valuenow', '364');
    await right.dblclick(); await expect(right).toHaveAttribute('aria-valuenow', '348');
    await page.getByRole('tab', { name: '笔记', exact: true }).click();
    const notes = page.getByRole('textbox', { name: '笔记', exact: true });
    await notes.fill('Synthetic mounted notebook draft');
    await page.evaluate(() => { window.__workspaceNoteNode = window.document.querySelector('textarea[aria-label="笔记"]'); });
    await page.getByRole('button', { name: '收起笔记面板', exact: true }).click();
    await openNotes(page); await expect(notes).toHaveValue('Synthetic mounted notebook draft');
    assert.equal(await page.evaluate(() => window.__workspaceNoteNode === window.document.querySelector('textarea[aria-label="笔记"]')), true);
    for (const width of [1440, 1280, 1000, 784, 780, 480]) {
      await page.setViewportSize({ width, height: 950 });
      await openNotes(page);
      if (width <= 1100) assert.equal(await page.locator('#library-panel:not(.collapsed)').count(), 0);
      assert.ok(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth + 1));
      const status = page.locator('.workspace-status-row .codex-status');
      await expect(status).toBeVisible();
      assert.equal(await page.evaluate(() => {
        const close = window.document.querySelector('[aria-label="关闭阅读工作区"]');
        const box = close.getBoundingClientRect();
        const hit = window.document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        const status = window.document.querySelector('.workspace-status-row');
        return (hit === close || close.contains(hit)) && status.getBoundingClientRect().bottom <= box.top;
      }), true, `At ${width}px the workspace close must be hittable, below the live status row`);
      await onPreview?.(page, `reading-workspace-${width}`);
    }
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.getByRole('tab', { name: '笔记', exact: true }).click();
    await expect(notes).toHaveValue('Synthetic mounted notebook draft'); await notes.fill(''); await page.getByRole('button', { name: '保存', exact: true }).click();
    await openDiscussion(page, 0);
    const source = page.locator('.thread-source-card:visible'); await expect(source).toContainText(annotations[0].quote);
    await question(page).fill('Which premise supports this synthetic claim?');
    await page.getByRole('button', { name: '核对参考', exact: true }).click();
    await expect(page.locator('.context-summary:visible')).toContainText('1 页');
    await page.getByRole('button', { name: '保存问题到本机', exact: true }).click();
    await expect(page.locator('.thread-message.user:visible')).toHaveCount(1);
    await expect(page.locator('.thread-notice:visible')).toContainText('尚未发送');
    await page.getByRole('button', { name: '复制给 Codex', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '复制给 Codex 的提问', exact: true })).toHaveValue(new RegExp(annotations[0].quote.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    await page.getByRole('button', { name: '收起', exact: true }).click();
    await page.getByText('手动保存已核对的回答', { exact: true }).click();
    const answer = page.getByRole('textbox', { name: '手动保存的回答', exact: true }); await answer.fill('Synthetic, manually reviewed answer. Not a model response.');
    const answerSave = page.getByRole('button', { name: '保存已核对回答', exact: true }); await expect(answerSave).toBeDisabled();
    await page.getByRole('checkbox', { name: /我已核对回答与原文/ }).check(); await answerSave.click();
    await expect(page.locator('.thread-message.assistant:visible')).toHaveCount(1);
    // A storage failure must not lose A when switching to B or collapsing panels.
    await page.evaluate(() => { const original = Storage.prototype.setItem; window.__restoreDiscussionStorage = () => { Storage.prototype.setItem = original; }; Storage.prototype.setItem = function(key, value) { if (key.startsWith('paperdesk-discussion-draft:')) throw new DOMException('Synthetic quota', 'QuotaExceededError'); return original.call(this, key, value); }; });
    await question(page).fill('Memory-only question A'); await expect(page.getByRole('alert').filter({ hasText: '讨论草稿无法暂存' })).toBeVisible();
    await openDiscussion(page, 1); await question(page).fill('Memory-only question B');
    await page.getByLabel('批注讨论', { exact: true }).selectOption({ label: `第 1 页 · ${annotations[0].quote.slice(0, 32)}` });
    await expect(question(page)).toHaveValue('Memory-only question A');
    await page.getByRole('button', { name: '关闭阅读工作区', exact: true }).click(); await openNotes(page); await expect(question(page)).toHaveValue('Memory-only question A');
    await page.evaluate(() => window.__restoreDiscussionStorage());
    // An older list reply must neither roll back a completed save nor leave loading stuck after selection changes.
    await question(page).fill('Question saved while an old list reply waits');
    await page.getByRole('button', { name: '核对参考', exact: true }).click();
    await expect(page.locator('.context-summary:visible')).toBeVisible();
    let releaseList, listCaptured;
    const captured = new Promise(resolve => { listCaptured = resolve; });
    const heldList = new Promise(resolve => { releaseList = resolve; });
    const listRoute = url => url.origin === base && url.pathname === `/api/documents/${document.id}/threads`;
    await page.route(listRoute, async route => { const response = await route.fetch(); listCaptured(); await heldList; await route.fulfill({ response }); });
    await page.getByRole('button', { name: '刷新讨论列表，保留草稿', exact: true }).click(); await captured;
    await page.getByRole('button', { name: '保存问题到本机', exact: true }).click();
    await expect(page.locator('.thread-message.user:visible')).toHaveCount(2);
    await page.getByLabel('批注讨论', { exact: true }).selectOption({ label: `第 1 页 · ${annotations[1].quote.slice(0, 32)}` });
    releaseList(); await expect(page.getByText('正在读取本机讨论…', { exact: true })).toBeHidden(); await page.unroute(listRoute);
    await expect(page.locator('.thread-source-card:visible')).toContainText(annotations[1].quote);
    await page.getByLabel('批注讨论', { exact: true }).selectOption({ label: `第 1 页 · ${annotations[0].quote.slice(0, 32)}` });
    await expect(page.locator('.thread-message.user:visible')).toHaveCount(2);
    await question(page).fill('First window question');
    const second = await context.newPage(); pages.push(second); second.on('pageerror', failure => errors.push(failure.message));
    await second.goto(`${base}/?document=${document.id}&libraryId=${libraryId}&page=1`); await openDiscussion(second, 0); await question(second).fill('Second window question');
    await question(page).fill('');
    await expect(question(second)).toHaveValue('Second window question');
    const slots = await second.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('paperdesk-discussion-draft:')).map(([,value]) => JSON.parse(value).draft.question));
    assert.ok(slots.includes('Second window question'));
    await question(second).fill('');
    await openDiscussion(page, 1); await question(page).fill('');
    assert.deepEqual(errors, []);
    console.log('PASS: workspace widths, keyboard resizing, mounted notes, anchored local discussion/manual review, quota-safe thread switches and independent window drafts');
  } finally { for (const target of pages) await target.close(); }
}
