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
    await expect(target.locator(`.codex-annotation-chip[data-codex-annotation="${annotations[index].id}"]`)).toBeVisible();
  };
  const question = target => target.getByRole('textbox', { name: '发给 Codex 的问题', exact: true });
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
      if (width <= 1100) await expect(page.locator('#library-panel:not(.collapsed)')).toHaveCount(0);
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
    assert.equal(await page.getByRole('tab',{name:'讨论',exact:true}).count(),0,'Manual discussion is not a parallel chat panel');
    const legacy=(await json(`/documents/${document.id}/threads`,{libraryId,pdfSha256:document.pdfSha256,annotationId:annotations[0].id,requestId:randomUUID()},'POST')).thread;
    await json(`/documents/${document.id}/threads/${legacy.id}/messages`,{libraryId,pdfSha256:document.pdfSha256,expectedRevision:0,requestId:randomUUID(),role:'assistant',content:'Historical manually saved answer, not a model response.',reviewed:true},'POST');
    const oldExport=await json(`/documents/${document.id}/threads/export?libraryId=${libraryId}`);
    const legacyKey=`paperdesk-discussion-draft:v1:${libraryId}:${document.id}:${legacy.id}:owner:synthetic-history`;
    const legacyValue=JSON.stringify({libraryId,documentId:document.id,threadId:legacy.id,draft:{question:'Historical unsent question',answer:'Historical unsent answer',scope:'selection',pages:'',reviewed:false,pending:null}});
    await page.evaluate(({key,value})=>localStorage.setItem(key,value),{key:legacyKey,value:legacyValue});
    const sessionEndpoint=`${base}/api/documents/${document.id}/codex/sessions`, listEndpoint=`${sessionEndpoint}?libraryId=${libraryId}`;
    let createdSession=false, releaseList;const heldList=new Promise(resolve=>{releaseList=resolve;});
    await page.route(sessionEndpoint,async route=>{const response=await route.fetch();createdSession=true;await route.fulfill({response});});
    await page.route(listEndpoint,async route=>{if(createdSession)await heldList;await route.continue();});
    let session;
    try{await openDiscussion(page,0);session=await page.getByLabel('选择 Codex 会话').inputValue();assert.ok(session,'Newly created session stays selected while its history refresh is held');}
    finally{releaseList();await page.unroute(sessionEndpoint);await page.unroute(listEndpoint);}

    await question(page).fill('Keep this exact draft across annotation references');
    await openDiscussion(page,1);await expect(question(page)).toHaveValue('Keep this exact draft across annotation references');await expect(page.getByLabel('选择 Codex 会话')).toHaveValue(session);
    await openDiscussion(page,1);await expect(page.getByLabel('选择 Codex 会话')).toHaveValue(session);await expect(question(page)).toHaveValue('Keep this exact draft across annotation references');
    let sessions=(await json(`/documents/${document.id}/codex/sessions?libraryId=${libraryId}`)).sessions;assert.equal(sessions.length,1);assert.equal(sessions[0].turnCount,0,'Discuss never sends automatically');
    await page.getByRole('button',{name:'核对上下文',exact:true}).click();await expect(page.locator('.codex-snapshot')).toContainText(annotations[1].quote);
    await page.getByRole('button',{name:'关闭阅读工作区',exact:true}).click();await openNotes(page);await expect(question(page)).toHaveValue('Keep this exact draft across annotation references');
    await page.evaluate(()=>{const original=Storage.prototype.setItem;window.__restoreDiscussionStorage=()=>Storage.prototype.setItem=original;Storage.prototype.setItem=function(key,value){if(key.startsWith('paperdesk-discussion-draft:'))throw new DOMException('Synthetic quota','QuotaExceededError');return original.call(this,key,value);};});
    await question(page).fill('Memory-only unified draft');await expect(page.getByRole('alert').filter({hasText:'输入无法暂存'})).toBeVisible();await page.getByRole('button',{name:'新对话',exact:true}).click();await expect(question(page)).toHaveValue('Memory-only unified draft');await expect(page.getByLabel('选择 Codex 会话')).toHaveValue(session);
    await openDiscussion(page,0);await expect(question(page)).toHaveValue('Memory-only unified draft');await page.evaluate(()=>window.__restoreDiscussionStorage());await question(page).fill('Recovered unified draft');
    await page.getByRole('button',{name:'新对话',exact:true}).click();await expect(question(page)).toHaveValue('');await page.getByLabel('选择 Codex 会话').selectOption(session);await expect(question(page)).toHaveValue('Recovered unified draft');
    const second=await context.newPage();pages.push(second);second.on('pageerror',failure=>errors.push(failure.message));await second.goto(`${base}/?document=${document.id}&libraryId=${libraryId}&page=1`);await openDiscussion(second,1);await expect(second.getByLabel('选择 Codex 会话')).toHaveValue(session);await expect(question(second)).toHaveValue('');await question(second).fill('Independent second-window draft');await expect(question(page)).toHaveValue('Recovered unified draft');
    await question(page).fill('');await question(second).fill('');
    await page.getByRole('tab',{name:/^批注/}).click();const card=page.locator(`[data-annotation-id="${annotations[0].id}"]`);await card.getByText('历史资料（旧讨论与草稿，只读）',{exact:true}).click();await expect(card).toContainText('Historical manually saved answer, not a model response.');await expect(card).toContainText('非模型自动记录');await expect(card.getByLabel('旧讨论草稿 1')).toHaveValue('Historical unsent question\n\nHistorical unsent answer');
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),legacyKey),legacyValue);assert.deepEqual(await json(`/documents/${document.id}/threads/export?libraryId=${libraryId}`),oldExport,'History viewing does not migrate or rewrite old records');
    assert.deepEqual(errors,[]);console.log('PASS: workspace layout, same composer/session across annotation A/B, no automatic sends, quota-safe switching, independent window drafts and lossless read-only legacy history');
  } finally { for (const target of pages) await target.close(); }
}
