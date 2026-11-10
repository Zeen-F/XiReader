import React, { useEffect, useRef, useState } from 'react';

export default function VaultPdfIssues({ issues = [], onAccept, busy }) {
  const dialog = useRef(null);
  const [selected, select] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (selected) dialog.current?.showModal();
  }, [selected]);
  if (!issues.length && !selected) return null;

  async function accept() {
    setSaving(true);
    setError('');
    try { await onAccept(selected); select(null); }
    catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  }

  return <>
    <div className="vault-issue-list" aria-label="需要核对的 PDF">
      {issues.map(issue => <button key={issue.id} className="secondary-button" disabled={busy}
        onClick={() => { setError(''); select(issue); }}>{issue.newHash ? '核对新版' : '核对文件'} · {issue.title}</button>)}
    </div>
    {selected && <dialog ref={dialog} className="vault-dialog" aria-label="核对 PDF 文件"
      onCancel={event => { event.preventDefault(); if (!saving) select(null); }}>
      <div className="vault-heading"><h2>{selected.newHash ? '原位置的 PDF 已变化' : '暂时无法读取 PDF'}</h2></div>
      <div className="vault-location"><strong>{selected.title}</strong><span>{selected.path}</span>
        {selected.newHash && <span>原文件 {selected.oldBytes.toLocaleString()} 字节 · 当前文件 {selected.newBytes.toLocaleString()} 字节</span>}
      </div>
      {selected.newHash ? <p className="vault-description">
        原记录共 {selected.pageCount} 页，有 {selected.annotationCount} 条批注和 {selected.bookmarkCount} 个个人书签。
        请核对新文件是同一本书，页面顺序和版面一致。确认后沿用阅读进度、笔记和原页批注，并更新全文搜索。
        页数不同的版本请另存后单独打开。
      </p> : <p className="vault-description">{selected.message} 请检查上方路径与文件同步状态，恢复后刷新书架。</p>}
      {error && <p className="vault-error" role="alert">{error}</p>}
      <div className="vault-actions">
        <button className="secondary-button" autoFocus disabled={saving} onClick={() => select(null)}>关闭</button>
        {selected.newHash && <button className="primary-button" disabled={saving} onClick={accept}>
          {saving ? '正在校验新版…' : '确认同版，使用新 PDF'}
        </button>}
      </div>
    </dialog>}
  </>;
}
