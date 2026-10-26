import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, MessageSquare, RefreshCw, ScanLine } from 'lucide-react';
import { api } from './api.js';
import ContextScopeControl from './ContextScopeControl.jsx';
import { contextSelection, discussionPrompt, mergeDiscussionThreads } from './discussion-state.mjs';
import { createDiscussionDraftStore } from './discussion-drafts.mjs';

const draftOwner = crypto.randomUUID();
export function ThreadEditor({ libraryId, document, thread, onSaved, onJump, onDraftState }) {
  const [draftStore] = useState(() => createDiscussionDraftStore({ libraryId, documentId: document.id, threadId: thread.id, owner: draftOwner }));
  const [draft, setDraft] = useState(() => draftStore.read());
  const [context, setContext] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [storageError, setStorageError] = useState(false), [copyText, setCopyText] = useState('');
  const mounted = useRef(true), draftRef = useRef(draft), requestBusy = useRef(false), previewSequence = useRef(0);
  draftRef.current = draft;
  const store = value => {
    draftRef.current = value;
    draftStore.write(value);
    if (mounted.current) setStorageError(draftStore.storageError);
    onDraftState(thread.id, { dirty: Boolean(value.question || value.answer || value.pending), busy: requestBusy.current, storageError: draftStore.storageError });
    if (mounted.current) setDraft(value);
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++previewSequence.current; }; }, []);
  useEffect(() => {
    const dirty = Boolean(draft.question || draft.answer || draft.pending);
    onDraftState(thread.id, { dirty, busy, storageError });
  }, [draft.question, draft.answer, draft.pending, busy, storageError, thread.id, onDraftState]);
  const change = patch => { if (draftRef.current.pending || requestBusy.current) return; store({ ...draftRef.current, ...patch }); setError(''); setNotice(''); };
  const scopeChange = patch => { ++previewSequence.current; setContext(null); change(patch); };
  const base = `/documents/${encodeURIComponent(document.id)}/threads/${encodeURIComponent(thread.id)}`;
  const preview = async () => {
    if (requestBusy.current) return;
    const sequence = ++previewSequence.current;
    setError(''); setContext(null);
    try {
      const selection = contextSelection(draft.scope, draft.pages, document.pageCount);
      requestBusy.current = true; setBusy(true);
      const result = await api(`${base}/context`, { method: 'POST', body: JSON.stringify({ libraryId, pdfSha256: thread.pdfSha256, ...selection }) });
      if (mounted.current && previewSequence.current === sequence) setContext(result.context);
    } catch (failure) { if (mounted.current) setError(failure.message); }
    finally { requestBusy.current = false; onDraftState(thread.id, { dirty: Boolean(draftRef.current.question || draftRef.current.answer || draftRef.current.pending), busy: false, storageError: draftStore.storageError }); if (mounted.current) setBusy(false); }
  };
  const save = async role => {
    if (requestBusy.current) return;
    let attempt = draftRef.current.pending;
    if (!attempt) {
      const content = (role === 'assistant' ? draft.answer : draft.question).trim();
      if (!content || (role === 'assistant' && !draft.reviewed) || (role === 'user' && !context)) return;
      attempt = { libraryId, pdfSha256: thread.pdfSha256, expectedRevision: thread.revision, requestId: crypto.randomUUID(), role, content,
        ...(role === 'assistant' ? { reviewed: true } : { ...contextSelection(draft.scope, draft.pages, document.pageCount), contextDigest: context.digest }) };
      store({ ...draftRef.current, pending: attempt });
    }
    requestBusy.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(`${base}/messages`, { method: 'POST', body: JSON.stringify(attempt) });
      const latest = draftRef.current;
      store({ ...latest, pending: null, ...(attempt.role === 'assistant' ? { answer: '', reviewed: false } : { question: '' }) });
      onSaved(result.thread);
      if (mounted.current) { setContext(null); setNotice(attempt.role === 'assistant' ? '已保存你核对过的回答。没有自动写入笔记。' : '问题已保存到本机，尚未发送给 Codex。'); }
    } catch (failure) {
      if ([400, 403, 404, 409, 413, 422].includes(failure.status)) store({ ...draftRef.current, pending: null });
      if (mounted.current) setError(failure.status === 409 ? '讨论或参考内容已更新。草稿保留，请重新读取讨论、核对参考后保存。' : `${failure.message}。输入仍保留；若结果不明确，请使用同一请求重试。`);
    } finally { requestBusy.current = false; onDraftState(thread.id, { dirty: Boolean(draftRef.current.question || draftRef.current.answer || draftRef.current.pending), busy: false, storageError: draftStore.storageError }); if (mounted.current) setBusy(false); }
  };
  const reload = async () => {
    if (requestBusy.current) return;
    requestBusy.current = true; setBusy(true); setError('');
    try {
      const result = await api(`${base}?libraryId=${encodeURIComponent(libraryId)}`);
      onSaved(result.thread); setContext(null);
      const pending = draftRef.current.pending;
      if (pending && result.thread.messages?.some(message => message.requestId === pending.requestId)) {
        store({ ...draftRef.current, pending: null, ...(pending.role === 'assistant' ? { answer: '', reviewed: false } : { question: '' }) });
        setNotice('已从本机讨论确认上次保存成功。');
      }
    } catch (failure) { if (mounted.current) setError(failure.message); }
    finally { requestBusy.current = false; onDraftState(thread.id, { dirty: Boolean(draftRef.current.question || draftRef.current.answer || draftRef.current.pending), busy: false, storageError: draftStore.storageError }); if (mounted.current) setBusy(false); }
  };
  const copy = async message => {
    try {
      const text = discussionPrompt(document.title, thread, message);
      setCopyText(text);
      if (!navigator.clipboard?.writeText) throw new Error('请在下方手动复制');
      await navigator.clipboard.writeText(text);
      setNotice('已复制，尚未发送。请在 Codex 对话中粘贴并确认发送；回答不会自动回传。');
    } catch { setNotice('请从下方复制提问，在 Codex 对话中粘贴并确认发送。这里不会代为发送。'); }
  };
  const locked = busy || Boolean(draft.pending), missing = thread.sourceStatus !== 'verified';
  return <section className="annotation-thread" aria-label={`第 ${thread.page} 页批注讨论`}>
    <div className="thread-source-card" data-source-annotation={thread.annotationId}>
      <div className="source-card-label"><span>{thread.kind === 'region' ? <ScanLine size={13}/> : <MessageSquare size={13}/>} 固定来源</span><button className="text-button" onClick={() => onJump(thread)} disabled={missing}>PDF 第 {thread.page} 页 <ArrowUpRight size={13}/></button></div>
      <p className="source-document-title" title={document.title}>{document.title}</p>
      {thread.kind === 'region' ? <p className="source-region-note">区域批注 · 未做 OCR，不把图片当作文字引文。</p> : <blockquote>{thread.quote}</blockquote>}
      {missing && <p className="inline-error">原批注已删除或改变，讨论与来源快照保留；重新核对前不追加内容。</p>}
      <details className="source-identity"><summary>来源身份</summary><code>PDF SHA-256: {thread.pdfSha256}</code><code>批注: {thread.annotationId}</code></details>
    </div>
    <div className="thread-scroll">
      <div className="thread-history-heading"><span>本机讨论 · {thread.messages?.length || 0} 条</span><button className="icon-button small" disabled={busy} aria-label="重新读取讨论，保留草稿" onClick={reload}><RefreshCw size={14}/></button></div>
      {!thread.messages?.length && <div className="thread-empty"><MessageSquare size={24}/><h3>从这段原文开始</h3><p>先保存问题，再复制到 Codex。读过回答后，可在这里手动留存。</p></div>}
      <ol className="thread-messages">{(thread.messages || []).map(message => <li key={message.id} className={`thread-message ${message.role}`}><div className="message-label"><span>{message.role === 'assistant' ? '手动保存的回答' : '你的问题'}</span><small>{message.role === 'assistant' ? '用户已核对 · 非自动同步' : '本机已保存 · 不代表已发送'}</small></div><p>{message.content}</p>{message.role === 'user' && <button className="text-button copy-question" onClick={() => copy(message)}><Copy size={13}/> 复制给 Codex</button>}</li>)}</ol>
      {copyText && <details open className="copy-prompt"><summary>可复制提问（尚未发送）</summary><textarea aria-label="复制给 Codex 的提问" readOnly value={copyText}/><button className="text-button" onClick={() => setCopyText('')}>收起</button></details>}
      <div className="thread-composer">
        <h3>接着问一句</h3>
        <ContextScopeControl scope={draft.scope} pages={draft.pages} onChange={scopeChange} disabled={locked || missing} context={context} idPrefix={thread.id}/>
        <textarea aria-label="批注讨论问题" placeholder="这段论证依赖什么前提？" maxLength={20000} value={draft.question} disabled={locked || missing} onChange={event => change({ question: event.target.value })}/>
        {context && <details className="context-preview"><summary>核对将保存 / 复制的参考文字</summary><blockquote>{context.quote || '无文字引文'}</blockquote>{context.pages?.map(item => <section key={item.page}><strong>PDF 第 {item.page} 页</strong><p>{item.text || '无可提取文字'}</p></section>)}</details>}
        <div className="thread-actions"><button className="secondary-button" disabled={locked || missing} onClick={preview}>{context ? '重新核对参考' : '核对参考'}</button><button className="primary-button" disabled={locked || missing || !draft.question.trim() || !context} onClick={() => save('user')}>保存问题到本机</button></div>
        <p className="thread-boundary">不会在后台调用模型。Codex 回答留在对话中，不会自动同步。</p>
      </div>
      <details className="manual-answer" open={Boolean(draft.answer) || undefined}><summary>手动保存已核对的回答</summary><label htmlFor={`thread-answer-${thread.id}`}>从 Codex 复制回答，核对来源后保存</label><textarea id={`thread-answer-${thread.id}`} aria-label="手动保存的回答" placeholder="粘贴需要留存的回答，可先修改与删减。" maxLength={50000} disabled={locked || missing} value={draft.answer} onChange={event => change({ answer: event.target.value, reviewed: false })}/><label className="review-answer"><input type="checkbox" checked={draft.reviewed} disabled={locked || missing} onChange={event => change({ reviewed: event.target.checked })}/>我已核对回答与原文，确认保存这份内容</label><button className="primary-button" disabled={locked || missing || !draft.answer.trim() || !draft.reviewed} onClick={() => save('assistant')}><Check size={14}/> 保存已核对回答</button></details>
      {draft.pending && <div className="draft-hint"><p>上次保存结果待确认。这份请求与输入已冻结，重试不会新增另一条消息。</p><button className="secondary-button" disabled={busy} onClick={() => save(draft.pending.role)}>用同一请求重试保存</button></div>}
      {draftStore.others().length > 0 && <details className="other-discussion-drafts"><summary>其他窗口 / 历史草稿（只读核对）</summary>{draftStore.others().map((other,index)=><div key={other.key}><label>草稿 {index+1}<textarea readOnly aria-label={`其他窗口讨论草稿 ${index+1}`} value={[other.question,other.answer].filter(Boolean).join('\n\n')}/></label><p>不会自动覆盖当前输入，也不会随当前保存而删除。</p></div>)}</details>}
      {storageError && <p className="inline-error" role="alert">讨论草稿无法暂存，请保持当前窗口并确认保存后再关闭或切换文献。</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}{notice && <p className="thread-notice" role="status">{notice}</p>}
    </div>
  </section>;
}

export default function AnnotationThread({ libraryId, document, annotation, onJump, onChooseAnnotations, onStateChange, onCounts }) {
  const [threads, setThreads] = useState([]), [activeId, setActiveId] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const retainedEditors = useRef(new Set());
  const readGeneration = useRef(0), handledAnnotation = useRef(null);
  const sequence = useRef(0), mounted = useRef(true), creation = useRef(new Map()), states = useRef(new Map());
  const base = `/documents/${encodeURIComponent(document.id)}/threads`;
  const draftState = useCallback((id, value) => { states.current.set(id, value); onStateChange?.([...states.current.values()]); }, [onStateChange]);
  const saved = useCallback(thread => {
    if (!mounted.current) return;
    setThreads(items => mergeDiscussionThreads(items, [thread]));
  }, []);
  const read = async () => {
    const token = ++readGeneration.current; setLoading(true); setError('');
    try {
      const result = await api(`${base}?libraryId=${encodeURIComponent(libraryId)}`);
      if (mounted.current && token === readGeneration.current) setThreads(items => mergeDiscussionThreads(items, result.threads));
    } catch (failure) { if (mounted.current && token === readGeneration.current) setError(failure.message); }
    finally { if (mounted.current && token === readGeneration.current) setLoading(false); }
  };
  useEffect(() => { mounted.current = true; void read(); return () => { mounted.current = false; ++sequence.current; ++readGeneration.current; }; }, []);
  useEffect(() => { onCounts?.(Object.fromEntries(threads.map(thread => [thread.annotationId, thread.messageCount ?? thread.messages?.length ?? 0]))); }, [threads, onCounts]);
  useEffect(() => {
    if (!annotation || annotation.documentId !== document.id || loading || handledAnnotation.current===annotation) return;
    handledAnnotation.current=annotation;
    const existing = threads.find(thread => thread.annotationId === annotation.id);
    if (existing) { setActiveId(existing.id); return; }
    const token = ++sequence.current;
    let attempt = creation.current.get(annotation.id);
    if (!attempt) { attempt = { libraryId, annotationId: annotation.id, pdfSha256: document.pdfSha256, requestId: crypto.randomUUID() }; creation.current.set(annotation.id, attempt); }
    setError('');
    void api(base, { method: 'POST', body: JSON.stringify(attempt) }).then(result => {
      if (!mounted.current) return;
      saved(result.thread);
      if (token === sequence.current) setActiveId(result.thread.id);
    }).catch(failure => { if (mounted.current && token === sequence.current) setError(failure.message); });
  }, [annotation, loading]);
  const active = threads.find(thread => thread.id === activeId);
  if (active) retainedEditors.current.add(active.id);
  return <div className="discussion-panel">
    <div className="discussion-switcher"><label htmlFor="thread-picker">批注讨论</label><select id="thread-picker" value={active?.id || ''} onChange={event => { ++sequence.current; handledAnnotation.current=annotation; setActiveId(event.target.value); }}><option value="">选择一个已保存的讨论</option>{threads.map(thread => <option key={thread.id} value={thread.id}>第 {thread.page} 页 · {thread.quote?.slice(0, 32) || '区域批注'}</option>)}</select><button className="text-button" onClick={onChooseAnnotations}>查看批注</button><button className="icon-button small" aria-label="刷新讨论列表，保留草稿" onClick={read} disabled={loading}><RefreshCw size={13}/></button><a className="discussion-export text-button" href={`/api${base}/export?libraryId=${encodeURIComponent(libraryId)}`} download title="导出本篇已保存的讨论；不含浏览器草稿">导出本篇讨论 JSON</a></div>
    {loading && <p className="panel-loading" role="status">正在读取本机讨论…</p>}
    {error && <div className="panel-loading"><p className="inline-error" role="alert">{error}</p><button className="text-button" onClick={()=>{handledAnnotation.current=null;void read();}}>重新读取</button></div>}
    {threads.filter(thread=>retainedEditors.current.has(thread.id)).map(thread=><div key={`${libraryId}:${document.id}:${thread.id}`} className="retained-thread-editor" hidden={thread.id!==activeId}><ThreadEditor libraryId={libraryId} document={document} thread={thread} onSaved={saved} onJump={onJump} onDraftState={draftState}/></div>)}
    {!active && !loading && <div className="discussion-start"><MessageSquare size={30} strokeWidth={1.3}/><h2>让问题留在原文旁边</h2><p>在批注上点“讨论”，固定来源、核对参考，再记录问题。</p><button className="secondary-button" onClick={onChooseAnnotations}>选择一条批注</button><small>问题只在本机保存。复制到 Codex 后需由你确认发送，回答需手动核对保存。</small></div>}
  </div>;
}
