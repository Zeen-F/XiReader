import React from 'react';
import { DISCUSSION_SCOPES } from './discussion-state.mjs';
export default function ContextScopeControl({ scope, pages, onChange, disabled, context, idPrefix = 'discussion' }) {
  return <div className="context-scope-control">
    <label htmlFor={`${idPrefix}-scope`}>本轮参考 <span>仅用于这次本机记录与复制</span></label>
    <select id={`${idPrefix}-scope`} value={scope} disabled={disabled} onChange={event => onChange({ scope: event.target.value })}>
      {Object.entries(DISCUSSION_SCOPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    {scope === 'custom' && <input aria-label="讨论参考页码" placeholder="例如 2, 3, 4（最多 10 页）" value={pages} disabled={disabled} onChange={event => onChange({ pages: event.target.value })}/>}
    {context && <div className="context-summary" role="status"><span>{context.pageCount} 页 · {context.characterCount.toLocaleString()} 字符</span><span>实际 PDF 页：{context.pages?.map(item => item.page).join('、') || '仅原文引文'}</span>{context.emptyPages?.length > 0 && <strong>第 {context.emptyPages.join('、')} 页无可提取文字；未做 OCR。</strong>}</div>}
    <p className="context-history-hint">缩小范围不会撤回 Codex 对话中已发送的内容；需要隔离旧上下文时，请新开对话。</p>
  </div>;
}
