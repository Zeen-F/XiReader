import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { createDiscussionStore } from './discussion-store.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
export const DISCUSSION_LIMITS = Object.freeze({ pages:10, contextCharacters:50_000, questionCharacters:20_000, answerCharacters:50_000, threads:50, messages:200, requests:10_050 });
const SCOPES = ['selection','page','adjacent','custom'];
const hash = value => createHash('sha256').update(value).digest('hex');
const signature = stat => [stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
const contextDigest = context => hash(JSON.stringify(Object.fromEntries(Object.entries(context).filter(([key]) => key !== 'digest'))));

/** Read the actual bytes through an identity-checked descriptor. An indexed hash
 * alone cannot prove that a selected PDF has not been replaced on disk. */
export function verifyDiscussionPdf(doc, filename, HttpError) {
  let fd;
  try {
    const directory = lstatSync(path.dirname(filename)), before = lstatSync(filename);
    if (!directory.isDirectory() || directory.isSymbolicLink() || !before.isFile() || before.isSymbolicLink()) throw new Error('unsafe PDF path');
    fd = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const opened = fstatSync(fd), initial = signature(opened);
    if (signature(before) !== initial || opened.size !== doc.byte_size) throw new Error('PDF changed');
    const digest = createHash('sha256'), bytes = Buffer.alloc(64 * 1024);
    let count;
    while ((count = readSync(fd,bytes,0,bytes.length,null))) digest.update(bytes.subarray(0,count));
    if (signature(fstatSync(fd)) !== initial || signature(lstatSync(filename)) !== initial || digest.digest('hex') !== doc.sha256) throw new Error('PDF changed');
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(409,'原始 PDF 已缺失、被替换或仍在变化；请恢复匹配的来源后重试，未发送或保存本次内容。');
  } finally { if (fd !== undefined) closeSync(fd); }
}

export function discussionStateValidator(HttpError) {
  const fail = () => { throw new HttpError(409,'讨论记录格式或来源已损坏，请保留原文件并恢复有效备份；未覆盖记录。'); };
  const object = (value, keys) => { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value,key))) fail(); };
  const text = (value,max,required=false) => { if (typeof value !== 'string' || value.length > max || value.includes('\0') || (required && !value.trim())) fail(); };
  const uuid = value => { if (!UUID.test(value)) fail(); };
  const sha = value => { if (!HASH.test(value)) fail(); };
  const date = value => { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(); };
  const array = (value,max) => { if (!Array.isArray(value) || value.length > max) fail(); };
  const distinct = values => { if (new Set(values).size !== values.length) fail(); };
  const page = value => { if (!Number.isInteger(value) || value < 1 || value > 2000) fail(); };
  function source(value,id) {
    object(value,['documentId','annotationId','pdfSha256','page','kind']);
    uuid(value.documentId); uuid(value.annotationId); sha(value.pdfSha256); page(value.page);
    if (value.documentId !== id || !['text','region'].includes(value.kind)) fail();
  }
  function context(value,thread) {
    object(value,['schemaVersion','scope','pages','quote','pageCount','characterCount','emptyPages','source','digest']);
    if (value.schemaVersion !== 1 || !SCOPES.includes(value.scope)) fail();
    array(value.pages,DISCUSSION_LIMITS.pages); if (!value.pages.length) fail();
    for (const row of value.pages) { object(row,['page','text']); page(row.page); text(row.text,DISCUSSION_LIMITS.contextCharacters); }
    distinct(value.pages.map(row=>row.page));
    if (value.pageCount !== value.pages.length || value.characterCount !== value.pages.reduce((total,row)=>total+row.text.length,0)
      || value.characterCount > DISCUSSION_LIMITS.contextCharacters) fail();
    text(value.quote,50_000); array(value.emptyPages,DISCUSSION_LIMITS.pages);
    if (JSON.stringify(value.emptyPages) !== JSON.stringify(value.pages.filter(row=>!row.text.trim()).map(row=>row.page))) fail();
    source(value.source,thread.documentId);
    if (['documentId','annotationId','pdfSha256','page','kind'].some(key=>value.source[key] !== thread[key]) || value.quote !== thread.quote) fail();
    sha(value.digest); if (contextDigest(value) !== value.digest) fail();
  }
  return (state,id) => {
    object(state,['schemaVersion','documentId','threads','requests']);
    if (state.schemaVersion !== 1 || state.documentId !== id) fail(); uuid(id);
    array(state.threads,DISCUSSION_LIMITS.threads); distinct(state.threads.map(thread=>thread.id));
    for (const thread of state.threads) {
      object(thread,['id','documentId','annotationId','pdfSha256','page','kind','quote','rects','title','revision','createdAt','updatedAt','messages']);
      uuid(thread.id); source(Object.fromEntries(['documentId','annotationId','pdfSha256','page','kind'].map(key=>[key,thread[key]])),id);
      text(thread.title,500,true); text(thread.quote,50_000,thread.kind === 'text');
      if (thread.kind === 'region' && thread.quote !== '') fail();
      array(thread.rects,200); if (!thread.rects.length) fail();
      for (const rect of thread.rects) {
        object(rect,['x','y','width','height']);
        if (![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite) || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 || rect.x+rect.width > 1 || rect.y+rect.height > 1) fail();
      }
      date(thread.createdAt); date(thread.updatedAt);
      array(thread.messages,DISCUSSION_LIMITS.messages); distinct(thread.messages.map(message=>message.id));
      if (thread.revision !== thread.messages.length || Date.parse(thread.updatedAt) < Date.parse(thread.createdAt)) fail();
      thread.messages.forEach((message,index) => {
        object(message,['id','role','content','status','provenance','sequence','requestId','context','createdAt']);
        uuid(message.id); uuid(message.requestId); date(message.createdAt);
        if (!['user','assistant'].includes(message.role) || message.status !== 'saved' || message.sequence !== index+1
          || message.provenance !== (message.role === 'user' ? 'user' : 'manual-answer')) fail();
        text(message.content,message.role === 'user' ? DISCUSSION_LIMITS.questionCharacters : DISCUSSION_LIMITS.answerCharacters,true);
        if (message.role === 'user') context(message.context,thread); else if (message.context !== null) fail();
      });
    }
    array(state.requests,DISCUSSION_LIMITS.requests); distinct(state.requests.map(request=>request.requestId));
    for (const request of state.requests) {
      object(request,['requestId','requestHash','threadId','messageId','createdAt']);
      uuid(request.requestId); sha(request.requestHash); uuid(request.threadId); date(request.createdAt);
      const thread = state.threads.find(row=>row.id === request.threadId); if (!thread) fail();
      if (request.messageId !== null) {
        uuid(request.messageId);
        if (!thread.messages.some(message=>message.id === request.messageId && message.requestId === request.requestId)) fail();
      }
    }
    for (const thread of state.threads) for (const message of thread.messages) {
      if (!state.requests.some(request=>request.requestId === message.requestId && request.messageId === message.id && request.threadId === thread.id)) fail();
    }
  };
}

export function registerThreadsApi({ app, db, dataDir, vaultStore, libraryId, documentOr404, verifyDocument, HttpError, objectBody, uuidValue, stringValue, pageValue }) {
  const store = createDiscussionStore({ dataDir,vaultStore,validate:discussionStateValidator(HttpError),HttpError });
  const annotation = (id,documentId) => db.prepare('SELECT * FROM annotations WHERE id=? AND document_id=?').get(id,documentId);
  function checkLibrary(value) {
    if (typeof value !== 'string' || !HASH.test(value)) throw new HttpError(400,'讨论请求必须包含已核验的文献库身份。');
    if (value !== libraryId) throw new HttpError(409,'当前文献库已切换；请回到原库核对草稿，本次内容未保存。');
  }
  function document(req,body) {
    checkLibrary(body.libraryId);
    return documentOr404(uuidValue(req.params.id,'文献'));
  }
  function sourceHash(value,doc) {
    if (typeof value !== 'string' || !HASH.test(value)) throw new HttpError(400,'请提供有效的 PDF 校验和。');
    if (value !== doc.sha256) throw new HttpError(409,'文献来源版本已变化，请刷新并重新核对，未保存本次内容。');
    verifyDocument(doc);
  }
  function sourceStatus(thread,doc) {
    if (thread.pdfSha256 !== doc.sha256) return 'source-changed';
    const current = annotation(thread.annotationId,doc.id);
    if (!current) return 'annotation-missing';
    if (current.page !== thread.page || current.kind !== thread.kind || current.quote !== thread.quote || JSON.stringify(JSON.parse(current.rects)) !== JSON.stringify(thread.rects)) return 'annotation-changed';
    return 'verified';
  }
  function serialize(thread,doc) {
    return { ...thread,libraryId,messageCount:thread.messages.length,sourceStatus:sourceStatus(thread,doc) };
  }
  const find = (state,id) => {
    const thread = state.threads.find(row=>row.id === id);
    if (!thread) throw new HttpError(404,'没有找到这篇文献中的讨论。');
    return thread;
  };
  function verified(thread,doc) {
    if (sourceStatus(thread,doc) !== 'verified') throw new HttpError(409,'讨论的原批注已删除或来源已变化；历史已保留，请重新选择有效批注，未追加本次内容。');
  }
  function scopeRequest(body,doc) {
    if (!SCOPES.includes(body.scope)) throw new HttpError(400,'上下文范围必须是 selection、page、adjacent 或 custom。');
    if (body.scope !== 'custom') {
      if (Object.hasOwn(body,'pages')) throw new HttpError(400,'只有指定页范围才能提供 pages。');
      return { scope:body.scope };
    }
    if (!Array.isArray(body.pages) || !body.pages.length || body.pages.length > DISCUSSION_LIMITS.pages) throw new HttpError(400,'指定页范围需要 1 至 10 个实际 PDF 页码。');
    const pages = body.pages.map(value=>pageValue(value,doc.page_count));
    if (new Set(pages).size !== pages.length) throw new HttpError(400,'指定页码不能重复。');
    return { scope:body.scope,pages:pages.sort((a,b)=>a-b) };
  }
  function buildContext(thread,doc,scope) {
    verified(thread,doc);
    const numbers = scope.scope === 'custom' ? scope.pages : scope.scope === 'adjacent'
      ? [thread.page-1,thread.page,thread.page+1].filter(page=>page>=1 && page<=doc.page_count) : [thread.page];
    const pages = numbers.map(page => {
      if (scope.scope === 'selection') return { page,text:thread.quote };
      const row = db.prepare('SELECT text FROM pages WHERE document_id=? AND page=?').get(doc.id,page);
      if (!row) throw new HttpError(409,'所选页面文字索引缺失，请刷新文献；没有跳过缺失页。');
      return { page,text:row.text };
    });
    const characterCount = pages.reduce((total,row)=>total+row.text.length,0);
    if (characterCount > DISCUSSION_LIMITS.contextCharacters) throw new HttpError(413,'所选上下文超过 50,000 个字符，请缩小范围；没有截断或发送。');
    const context = { schemaVersion:1,scope:scope.scope,pages,quote:thread.quote,pageCount:pages.length,characterCount,
      emptyPages:pages.filter(row=>!row.text.trim()).map(row=>row.page),
      source:Object.fromEntries(['documentId','annotationId','pdfSha256','page','kind'].map(key=>[key,thread[key]])) };
    return { ...context,digest:contextDigest(context) };
  }
  function replay(state,requestId,requestHash) {
    const saved = state.requests.find(row=>row.requestId === requestId);
    if (saved && saved.requestHash !== requestHash) throw new HttpError(409,'同一 requestId 不能用于不同讨论内容，请先核对已保存记录。');
    return saved;
  }
  function record(state,value) {
    if (state.requests.length >= DISCUSSION_LIMITS.requests) throw new HttpError(429,'本篇讨论的重试保护记录已达上限；可导出本篇讨论 JSON 保留，本次内容未保存。');
    state.requests.push(value);
  }
  const base = '/api/documents/:id/threads';
  app.get(base,(req,res) => {
    const doc = document(req,req.query); verifyDocument(doc);
    const state = store.read(doc.id);
    res.json({ threads:state.threads.map(thread=>serialize(thread,doc)),limits:DISCUSSION_LIMITS });
  });
  app.post(base,(req,res) => {
    const body = objectBody(req.body,['libraryId','annotationId','pdfSha256','requestId']);
    const doc = document(req,body), annotationId = uuidValue(body.annotationId,'批注'),requestId = uuidValue(body.requestId,'请求');
    sourceHash(body.pdfSha256,doc);
    const requestHash = hash(JSON.stringify({ action:'create',libraryId,documentId:doc.id,annotationId,pdfSha256:body.pdfSha256 }));
    const result = store.mutate(doc.id,state => {
      const previous = replay(state,requestId,requestHash);
      if (previous) return { thread:find(state,previous.threadId),replayed:true };
      const selected = annotation(annotationId,doc.id);
      if (!selected) throw new HttpError(404,'没有找到这篇文献中的批注。');
      let thread = state.threads.find(row=>row.annotationId === annotationId && row.pdfSha256 === doc.sha256);
      const now = new Date().toISOString();
      if (!thread) {
        if (state.threads.length >= DISCUSSION_LIMITS.threads) throw new HttpError(429,'本篇文献最多保存 50 个批注讨论；已有记录保留，可导出本篇讨论 JSON。');
        thread = { id:randomUUID(),documentId:doc.id,annotationId,pdfSha256:doc.sha256,page:selected.page,kind:selected.kind,quote:selected.quote,
          rects:JSON.parse(selected.rects),title:doc.title,revision:0,createdAt:now,updatedAt:now,messages:[] };
        state.threads.push(thread);
      }
      verified(thread,doc);
      record(state,{ requestId,requestHash,threadId:thread.id,messageId:null,createdAt:now });
      return { thread,replayed:false };
    });
    res.status(result.replayed ? 200 : 201).json({ thread:serialize(result.thread,doc),replayed:result.replayed });
  });
  // Kept separate from the existing note/annotation Markdown export: this is a
  // lossless discussion-only artifact, including immutable contexts and retries.
  app.get(`${base}/export`,(req,res) => {
    const doc = document(req,req.query),state = store.read(doc.id);
    res.setHeader('Content-Disposition', `attachment; filename="discussions-${doc.id}.json"`);
    res.type('application/json').send(`${JSON.stringify(state)}\n`);
  });
  app.get(`${base}/:threadId`,(req,res) => {
    const doc = document(req,req.query); verifyDocument(doc);
    const thread = find(store.read(doc.id),uuidValue(req.params.threadId,'讨论'));
    res.json({ thread:serialize(thread,doc) });
  });
  app.post(`${base}/:threadId/context`,(req,res) => {
    const body = objectBody(req.body,['libraryId','pdfSha256','scope','pages']),doc = document(req,body);
    sourceHash(body.pdfSha256,doc);
    const thread = find(store.read(doc.id),uuidValue(req.params.threadId,'讨论'));
    res.json({ context:buildContext(thread,doc,scopeRequest(body,doc)) });
  });
  app.post(`${base}/:threadId/messages`,(req,res) => {
    const body = objectBody(req.body,['libraryId','pdfSha256','expectedRevision','requestId','role','content','scope','pages','contextDigest','reviewed']);
    const doc = document(req,body),threadId = uuidValue(req.params.threadId,'讨论'),requestId = uuidValue(body.requestId,'请求');
    sourceHash(body.pdfSha256,doc);
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw new HttpError(400,'请提供读取到的讨论版本。');
    if (!['user','assistant'].includes(body.role)) throw new HttpError(400,'仅支持保存问题或人工核对的回答。');
    const content = stringValue(body.content,'讨论内容',body.role === 'user' ? DISCUSSION_LIMITS.questionCharacters : DISCUSSION_LIMITS.answerCharacters,{nonempty:true});
    let scope;
    if (body.role === 'user') {
      if (Object.hasOwn(body,'reviewed')) throw new HttpError(400,'问题不使用 reviewed 字段。');
      scope = scopeRequest(body,doc);
      if (typeof body.contextDigest !== 'string' || !HASH.test(body.contextDigest)) throw new HttpError(400,'请先预览并确认本轮上下文。');
    } else if (body.reviewed !== true || ['scope','pages','contextDigest'].some(key=>Object.hasOwn(body,key))) {
      throw new HttpError(400,'回答只能在人工核对后保存（reviewed:true），不能伪装成自动生成结果。');
    }
    const requestHash = hash(JSON.stringify({ action:'message',libraryId,documentId:doc.id,threadId,pdfSha256:body.pdfSha256,expectedRevision:body.expectedRevision,
      role:body.role,content,...(scope ? { ...scope,contextDigest:body.contextDigest } : { reviewed:true }) }));
    const result = store.mutate(doc.id,state => {
      const thread = find(state,threadId),previous = replay(state,requestId,requestHash);
      if (previous) return { thread,message:thread.messages.find(message=>message.id === previous.messageId),replayed:true };
      verified(thread,doc);
      if (thread.revision !== body.expectedRevision) throw new HttpError(409,'讨论已在其他窗口更新，请读取最新记录后重试；草稿未覆盖新内容。');
      if (thread.messages.length >= DISCUSSION_LIMITS.messages) throw new HttpError(429,'此讨论最多保存 200 条消息；可导出本篇讨论 JSON 保留，本次内容未保存。');
      const context = scope ? buildContext(thread,doc,scope) : null;
      if (context && context.digest !== body.contextDigest) throw new HttpError(409,'本轮上下文与预览不一致，请重新预览并确认；没有保存或发送。');
      const now = new Date(Math.max(Date.now(),Date.parse(thread.updatedAt)+1)).toISOString();
      const message = { id:randomUUID(),role:body.role,content,status:'saved',provenance:body.role === 'user' ? 'user' : 'manual-answer',sequence:thread.revision+1,requestId,context,createdAt:now };
      thread.messages.push(message); thread.revision++; thread.updatedAt = now;
      record(state,{ requestId,requestHash,threadId,messageId:message.id,createdAt:now });
      return { thread,message,replayed:false };
    });
    res.status(result.replayed ? 200 : 201).json({ ...result,thread:serialize(result.thread,doc) });
  });
  return store;
}
