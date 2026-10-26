import React,{useState} from 'react';
import {api} from './api.js';
import {createDiscussionDraftStore} from './discussion-drafts.mjs';
// Read-only projection. Opening this disclosure never creates or migrates a conversation.
export default function LegacyDiscussionHistory({libraryId,documentId,annotationId,annotationIds=[]}){
 const [records,setRecords]=useState(null),[error,setError]=useState('');
 const load=async event=>{if(!event.currentTarget.open||records)return;try{const result=await api(`/documents/${documentId}/threads?libraryId=${libraryId}`);setRecords(result.threads.filter(t=>annotationId?t.annotationId===annotationId:!annotationIds.includes(t.annotationId)).map(t=>({...t,drafts:createDiscussionDraftStore({libraryId,documentId,threadId:t.id,owner:'readonly-history-view'}).others()})));}catch(e){setError(e.message);}};
 return <details className="legacy-discussion-history" onToggle={load}><summary>{annotationId?'历史资料（旧讨论与草稿，只读）':'未关联批注的历史资料（只读）'}</summary><p>原记录保留；手动保存的回答不是 Codex 自动生成记录，打开历史不会发送给模型。</p>{error&&<p role="alert">{error}</p>}{records?.length===0&&<p>没有对应的旧记录。</p>}{records?.map(t=><section key={t.id}><strong>PDF 第 {t.page} 页 · {t.sourceStatus==='verified'?'原来源':'来源需重新核对'}</strong><blockquote>{t.quote||'区域批注，无 OCR 文字'}</blockquote>{t.messages.map(m=><div key={m.id}><small>{m.role==='assistant'?'旧手动保存回答 · 非模型自动记录':'旧本机问题 · 不代表已发送'}</small><p>{m.content}</p></div>)}{t.drafts.map((d,i)=><label key={d.key}>历史未提交草稿 {i+1}<textarea aria-label={`旧讨论草稿 ${i+1}`} readOnly value={[d.question,d.answer].filter(Boolean).join('\n\n')}/></label>)}</section>)}<a href={`/api/documents/${documentId}/threads/export?libraryId=${libraryId}`} download>导出本篇原始历史记录</a></details>;
}
