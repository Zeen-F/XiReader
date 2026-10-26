import React from 'react';
// Local reading feedback only. No RPC, text extraction or model request here.
export default function CodexContextTray({document,page,included,selection,selectionIncluded=true,annotation,mode='follow',onRemoveSelection,onRestoreSelection,onRemoveDocument,onFollow,disabled=false}){
 const quoted=selection?.kind==='text'?selection.quote:'区域选区 · 无 OCR 文字';
 return <section className="codex-live-context" aria-label="当前阅读上下文">
  <div className="codex-document-context"><small className="codex-context-caption">{included?'待附带':'未附带'}</small><span title={document.title}>▤ {document.title}</span><small>第 {mode==='annotation'&&annotation?annotation.page:page} 页</small>{included&&onRemoveDocument&&<button aria-label="取消附带文献" title="本轮不附带阅读资料" disabled={disabled} onClick={onRemoveDocument}>×</button>}</div>
  {included&&selection&&selectionIncluded&&<div className="codex-context-chip" data-reading-selection="true"><details><summary><span className="codex-chip-kind">选区 · 第 {selection.page} 页{selection.kind==='text'?` · ${selection.quote.length} 字`:''}</span><span className="codex-chip-excerpt">{quoted}</span><span className="codex-chip-expand">展开</span></summary><blockquote>{quoted}</blockquote>{selection.quote?.length>4000&&<p>选区超过 4000 字符，请缩小范围后发送。</p>}</details><button aria-label="移除选区引用" title="移除本轮选区引用" disabled={disabled} onClick={onRemoveSelection}>×</button>{mode!=='follow'&&<button className="codex-use-selection" disabled={disabled} onClick={onFollow}>改用此选区</button>}</div>}
  {included&&selection&&!selectionIncluded&&<button className="codex-restore-selection" disabled={disabled} onClick={onRestoreSelection}>恢复选区引用</button>}
  {included&&mode==='annotation'&&annotation&&<div className="codex-context-chip codex-annotation-chip" data-codex-annotation={annotation.id}><details><summary><span className="codex-chip-kind">批注 · 第 {annotation.page} 页</span><span className="codex-chip-excerpt">{annotation.quote||'区域批注，无 OCR'}</span><span className="codex-chip-expand">展开</span></summary><blockquote>{annotation.quote||'区域批注，无 OCR'}</blockquote><p>{annotation.comment}</p></details><button aria-label="改为跟随阅读" title="移除固定批注，跟随阅读" disabled={disabled} onClick={onFollow}>×</button></div>}
  {included&&selection&&mode!=='follow'&&selectionIncluded&&<small>新选区尚未附带；当前仍使用固定批注。选择“改用此选区”切换。</small>}
 </section>;
}
