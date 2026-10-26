import {codexMessageSources} from '../shared/codex-message-source.mjs';
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Check, LoaderCircle, Save, AlertCircle } from 'lucide-react';
import { mergeNotes, MAX_NOTE_LENGTH } from '../shared/notes.mjs';
import { api } from './api.js';
import { createNoteDraftStore } from './note-drafts.mjs';

const noteText = document => mergeNotes(document.notesZh || '', document.notesEn || '');
const draftSession = crypto.randomUUID();
async function requestDocument(id, libraryId, body) {
  const result = await api(`/documents/${encodeURIComponent(id)}${body ? '' : `?expectedLibraryId=${encodeURIComponent(libraryId)}`}`, body ? {
    method: 'PATCH', body: JSON.stringify({ ...body, expectedLibraryId: libraryId }),
  } : undefined);
  return result.document;
}
const vaultVersionConflictCodes = new Set(['NOTES_VERSION_CONFLICT', 'VAULT_FILE_CONFLICT']);

const Notes = forwardRef(function Notes({ document, libraryId, onSaved, onError, onDirtyChange, storageMode = 'library', onOpenCodexSource }, ref) {
  const [drafts] = useState(() => createNoteDraftStore({ libraryId, owner: draftSession }));
  const boundDocument = useRef(document.id), boundLibrary = useRef(libraryId);
  const scope = useRef(null); scope.current = { libraryId, documentId: document.id };
  const scopeReady = () => drafts.matchesLibrary(scope.current.libraryId) && scope.current.documentId === boundDocument.current;
  const requireScope = () => { if (!scopeReady()) throw new Error('文献库身份已变化，请重新打开文献后再编辑笔记。'); };
  const currentDocument = useRef(document); currentDocument.current = document;
  const [initialDraft] = useState(() => drafts.read(document.id));
  const draft = useRef(initialDraft);
  const [text, setText] = useState(draft.current?.text ?? noteText(document));
  const [status, setStatus] = useState(draft.current ? 'pending' : 'saved');
  const [conflict, setConflict] = useState(false), [recovering, setRecovering] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [storageError, setStorageError] = useState(drafts.storageError), [preserved, setPreserved] = useState(() => drafts.preserved(document.id));
  const [historical, setHistorical] = useState(() => drafts.history(document.id));
  const [legacy, setLegacy] = useState(() => drafts.legacy(document.id));
  const latest = useRef(text), saved = useRef(noteText(document));
  const serverRevision = useRef(draft.current?.baseRevision || document.notesRevision);
  const timer = useRef(null), queue = useRef(Promise.resolve()), alive = useRef(true), revision = useRef(0);
  const scheduled = useRef(Boolean(draft.current));
  const pending = useRef(0), conflicted = useRef(false), incoming = useRef(null), recoveringRef = useRef(false);
  const vaultConflictArchiveStarted = useRef(false);
  const callbacks = useRef({ onSaved, onDirtyChange }); callbacks.current = { onSaved, onDirtyChange };
  const dirty = () => scheduled.current || pending.current > 0 || latest.current !== saved.current || conflicted.current;
  const report = () => callbacks.current.onDirtyChange?.(document.id, dirty());
  const preserveVaultConflict = () => {
    if (!scopeReady() || storageMode !== 'vault' || vaultConflictArchiveStarted.current) return;
    vaultConflictArchiveStarted.current = true;
    const snapshot = latest.current;
    void api(`/documents/${encodeURIComponent(document.id)}/vault-conflict`, { method: 'POST', body: JSON.stringify({ text: snapshot, expectedLibraryId: boundLibrary.current }) })
      .then(result => { if (result.preserved !== true) throw new Error('仓库未确认保留冲突副本。'); })
      .catch(error => { if (alive.current) onError(`冲突草稿仍在本机，仓库副本未确认保存：${error.message}`); });
  };
  const markConflict = (preserve = true) => {
    if (!preserve) vaultConflictArchiveStarted.current = true;
    conflicted.current = true; scheduled.current = false; clearTimeout(timer.current);
    if (alive.current) { setConflict(true); setStatus('error'); }
    if (preserve) preserveVaultConflict();
    report();
  };
  const acceptExternal = next => {
    if (!scopeReady() || !next || next.id !== boundDocument.current || next.notesRevision === serverRevision.current) return;
    if (pending.current || recoveringRef.current) { incoming.current = next; return; }
    if (dirty()) { incoming.current = next; markConflict(); return; }
    serverRevision.current = next.notesRevision;
    latest.current = saved.current = noteText(next);
    if (alive.current) { setText(latest.current); setStatus('saved'); }
    report();
  };
  const save = () => {
    clearTimeout(timer.current); scheduled.current = false;
    const snapshot = latest.current, atRevision = revision.current;
    pending.current++; report();
    if (alive.current && !conflicted.current) { setStatus('saving'); setSaveError(''); }
    const work = queue.current.catch(() => {}).then(async () => {
      requireScope();
      if (conflicted.current) throw new Error('已保存的笔记有新版本，请先处理保留的草稿。');
      // Compare after older writes settle: B -> A must still write A after B.
      // Merged semantic equality keeps merely opening legacy notes read-only.
      if (snapshot !== saved.current) {
        const expectedRevision = serverRevision.current;
        const next = await requestDocument(boundDocument.current, boundLibrary.current, { notesZh: snapshot, notesEn: '', expectedNotesRevision: expectedRevision });
        saved.current = snapshot; serverRevision.current = next.notesRevision;
        callbacks.current.onSaved(next, expectedRevision);
        if (incoming.current?.notesRevision === next.notesRevision) incoming.current = null;
        // If typing continued during this request, its recovery draft now builds
        // on our acknowledged save. Do not modify a different tab's local draft.
        try {
          const retained = drafts.read(boundDocument.current);
          if (revision.current !== atRevision && retained?.text === latest.current && retained.baseRevision === expectedRevision) {
            drafts.write(boundDocument.current, latest.current, next.notesRevision);
          }
        } catch { if (alive.current) setStorageError(true); }
      }
      if (revision.current === atRevision) {
        try { if (drafts.read(boundDocument.current)?.text === snapshot) drafts.clear(boundDocument.current, snapshot); } catch {}
        if (alive.current) setStatus('saved');
      }
    }).catch(error => {
      const versionConflict = error.status === 409 && error.code !== 'LIBRARY_IDENTITY_MISMATCH'
        && (storageMode !== 'vault' || vaultVersionConflictCodes.has(error.code));
      if (versionConflict) markConflict(error.conflictPreserved !== true);
      else if (alive.current && revision.current === atRevision) { setStatus('error'); setSaveError(error.message); }
      throw error;
    }).finally(() => {
      pending.current--;
      if (!pending.current && incoming.current) {
        const next = incoming.current; incoming.current = null; acceptExternal(next);
      }
      report();
    });
    queue.current = work;
    return work;
  };
  const saveRef = useRef(save); saveRef.current = save;
  useImperativeHandle(ref, () => ({ flush: () => saveRef.current(), isDirty: () => dirty(), appendFromCodex: async(block,source)=>{
    await saveRef.current();requireScope();if(dirty())throw new Error('笔记草稿尚未保存，未追加回答。');
    const next=await requestDocument(boundDocument.current,boundLibrary.current);requireScope();if(dirty())throw new Error('读取期间笔记有新草稿，请先保存后重试。');
    acceptExternal(next);if(latest.current.includes(source))return;
    const combined=[latest.current,block].filter(Boolean).join('\n\n');if(combined.length>MAX_NOTE_LENGTH)throw new Error('笔记达到容量上限，未追加回答。');
    change(combined);await saveRef.current();if(dirty())throw new Error('回答仍在笔记草稿中，请核对保存结果。');
  } }));
  useEffect(() => { acceptExternal(document); }, [document.notesRevision]);
  useEffect(() => { if (conflicted.current) preserveVaultConflict(); }, [storageMode]);
  useEffect(() => {
    const refreshDrafts = event => {
      if (event.key === null || event.key?.includes(document.id)) {
        setPreserved(drafts.preserved(boundDocument.current)); setHistorical(drafts.history(boundDocument.current)); setLegacy(drafts.legacy(boundDocument.current));
      }
    };
    window.addEventListener('storage', refreshDrafts);
    return () => window.removeEventListener('storage', refreshDrafts);
  }, [document.id]);
  useEffect(() => {
    alive.current = true; report();
    if (draft.current) {
      if ((draft.current.baseRevision && draft.current.baseRevision !== document.notesRevision) || (!draft.current.baseRevision && draft.current.text !== noteText(document))) markConflict();
      else timer.current = setTimeout(() => saveRef.current().catch(() => {}), 200);
    }
    const warn = event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => {
      alive.current = false; window.removeEventListener('beforeunload', warn); clearTimeout(timer.current);
      // A conflicted draft remains local. It must never become an unconditional write.
      if (!conflicted.current && latest.current !== saved.current) saveRef.current().catch(() => {});
    };
  }, []);
  const change = value => {
    if (!scopeReady()) { onError('正在核对文献库，请稍候再编辑笔记。'); return; }
    revision.current++; latest.current = value; scheduled.current = !conflicted.current; setText(value);
    if (!conflicted.current) { setStatus('pending'); setSaveError(''); }
    try {
      drafts.write(boundDocument.current, value, serverRevision.current);
      setStorageError(false);
    } catch { setStorageError(true); }
    report(); clearTimeout(timer.current);
    if (!conflicted.current) timer.current = setTimeout(() => saveRef.current().catch(() => {}), 650);
  };
  const loadSaved = async () => {
    if (recoveringRef.current || !scopeReady()) return;
    recoveringRef.current = true; setRecovering(true); clearTimeout(timer.current);
    try {
      await queue.current.catch(() => {});
      let expectedRevision, next;
      for (let attempt = 0; attempt < 3; attempt++) {
        expectedRevision = currentDocument.current.notesRevision;
        next = await requestDocument(boundDocument.current, boundLibrary.current);
        if (currentDocument.current.notesRevision === expectedRevision) break;
        next = null;
      }
      if (!next) throw new Error('已保存的笔记正在更新，请稍后重试。');
      // Persist the archive before replacing the editor. Storage failure leaves it intact.
      // One independent key per action prevents cross-tab read/modify/write loss.
      requireScope();
      drafts.preserve(boundDocument.current, latest.current, serverRevision.current);
      drafts.clear(boundDocument.current, latest.current);
      revision.current++; latest.current = saved.current = noteText(next); serverRevision.current = next.notesRevision;
      incoming.current = null; conflicted.current = false;
      vaultConflictArchiveStarted.current = false;
      setPreserved(drafts.preserved(boundDocument.current)); setHistorical(drafts.history(boundDocument.current)); setLegacy(drafts.legacy(boundDocument.current)); setText(latest.current); setConflict(false); setStatus('saved'); setStorageError(false); setSaveError('');
      callbacks.current.onSaved(next, expectedRevision); report();
    } catch (error) { onError(`草稿仍在编辑区：${error.message}`); }
    finally { recoveringRef.current = false; setRecovering(false); }
  };
  const visibleHistory = historical.filter((entry, index, entries) => entry.key !== (scopeReady() ? drafts.key(boundDocument.current) : null)
    && entry.key !== draft.current?.key && entry.text !== text && !preserved.some(archive => archive.text === entry.text)
    && entries.findIndex(other => other.text === entry.text) === index);
  return <div className="notes-body">
    <h2>笔记</h2><p className="notes-intro">{storageMode === 'vault' ? '支持 Markdown，自动保存到 Obsidian 仓库。' : '支持 Markdown，自动保存到本机。'}</p>
    {storageMode === 'vault' && <p className="vault-note-rule">正文可在两边编辑，批注由 XiReader 管理。</p>}
    {!scopeReady() && <p role="alert" className="inline-error">正在核对文献库身份，确认前不会读取或保存笔记草稿。</p>}
    {draft.current && <div className="draft-hint">已恢复本机草稿。</div>}
    {conflict && <div className="notes-conflict" role="alert"><p>已保存的笔记有新版本。你的草稿仍在这里，自动保存已暂停。</p><button className="text-button" disabled={recovering} onClick={loadSaved}>{recovering ? '正在保留草稿…' : '保留草稿并载入已保存笔记'}</button></div>}
    <label className="notes-field"><textarea aria-label="笔记" maxLength={MAX_NOTE_LENGTH} spellCheck="false" value={text} disabled={recovering || !scopeReady()} onChange={event => change(event.target.value)} placeholder="记录你的想法…"/><span className="word-count">{text.length} 字符</span></label>
    <div className={`save-row ${status === 'error' ? 'save-error' : ''}`}><span role="status">{status === 'saved' ? <Check size={14}/> : status === 'saving' ? <LoaderCircle size={14} className="spin"/> : status === 'error' ? <AlertCircle size={14}/> : <span className="status-dot"/>}{({ saved: storageMode === 'vault' ? '已保存到 Obsidian 仓库' : '已保存到本机', saving: '正在保存…', pending: '等待保存…', error: conflict ? '版本冲突，草稿已保留' : '保存失败，草稿已保留' })[status]}</span><button className="text-button" disabled={conflict || recovering || !scopeReady()} onClick={() => save().catch(error => onError(error.message))}><Save size={14}/> 保存</button></div>
    {codexMessageSources(text).map(source=><button className="text-button" key={source.url} onClick={()=>onOpenCodexSource?.(source)}>查看 Codex 原消息</button>)}
    {saveError && !conflict && <p className="inline-error notes-save-failure" role="alert">{saveError}</p>}
    {storageError && <p role="alert" className="inline-error">浏览器草稿存储不可用或已满，内容仍在编辑区。请点击保存并确认成功后再关闭页面。</p>}
    {preserved.length > 0 && <details className="preserved-drafts"><summary>查看保留的草稿（{preserved.length}）</summary>{preserved.map((entry, index) => <label key={entry.key}>草稿 {index + 1}<textarea aria-label={`保留的笔记草稿 ${index + 1}`} readOnly value={entry.text}/></label>)}</details>}
    {visibleHistory.length > 0 && <details className="historical-drafts"><summary>查看其他窗口与历史草稿（{visibleHistory.length}）</summary><p>这里只供查看和复制，不会载入编辑区或改动原草稿。需要恢复时，请核对后复制到笔记中。</p>{visibleHistory.map((entry, index) => <label key={entry.key}>其他窗口或历史草稿 {index + 1}<textarea aria-label={`其他窗口或历史草稿 ${index + 1}`} readOnly value={entry.text}/></label>)}</details>}
    {legacy.length > 0 && <details className="legacy-drafts"><summary>查看旧版待核对草稿（{legacy.length}）</summary><p>这些旧草稿没有文献库身份，可能来自另一个库。它们不会自动恢复、保存或删除；请先核对文献与来源，再手动复制需要的内容。</p>{legacy.map((entry, index) => <label key={entry.key}>旧版待核对草稿 {index + 1}<textarea aria-label={`旧版待核对笔记草稿 ${index + 1}`} readOnly value={entry.text}/></label>)}</details>}
  </div>;
});
export default Notes;
