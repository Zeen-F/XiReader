import React,{useCallback,useEffect,useRef,useState} from 'react';
import { api } from './api.js';
import { createDiscussionDraftStore } from './discussion-drafts.mjs';
import './codex-chat.css';
const ownerId=crypto.randomUUID();
const activeStates=new Set(['preparing','sending','running','stopping','approval']);
const labels={preparing:'准备连接',sending:'正在发送',running:'正在回答',stopping:'正在停止',approval:'等待你拒绝权限或停止',uncertain:'结果待核对',failed:'未完成',completed:'已完成',interrupted:'已停止'};

function Composer({libraryId,document,session,onSession,capture,annotation,onStateChange}){
 const [draftStore]=useState(()=>createDiscussionDraftStore({libraryId,documentId:document.id,threadId:`codex:${session.id}`,owner:ownerId}));
 const [draft,setDraft]=useState(()=>draftStore.read()),[include,setInclude]=useState(true),[mode,setMode]=useState('follow');
 const [preview,setPreview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[storageError,setStorageError]=useState(draftStore.storageError);
 const alive=useRef(true),lock=useRef(false),request=useRef(null),previewSequence=useRef(0);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const base=`/documents/${document.id}/codex/sessions/${session.id}`;
 const live=session.turns.at(-1),active=activeStates.has(live?.status),uncertain=session.turns.some(t=>t.status==='uncertain');
 const store=value=>{draftStore.write(value);setDraft(value);setStorageError(draftStore.storageError);};
 useEffect(()=>{onStateChange({dirty:Boolean(draft.question),storageError,busy});},[draft.question,storageError,busy,onStateChange]);
 useEffect(()=>()=>onStateChange({dirty:false,storageError:false,busy:false}),[onStateChange]);
 const currentCapture=()=>{
  const reading=capture();
  return{...reading,libraryId,includeContext:include,mode,annotationId:annotation?.id||null};
 };
 const invalidate=()=>{++previewSequence.current;setPreview(null);request.current=null;};
 useEffect(()=>{invalidate();},[include,mode,annotation?.id,annotation?.comment]);
 const check=async()=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('');const seq=++previewSequence.current;
  try{const result=await api(`/documents/${document.id}/codex/context`,{method:'POST',body:JSON.stringify({libraryId,capture:currentCapture()})});if(alive.current&&seq===previewSequence.current){setPreview(result);request.current=null;}}
  catch(e){if(alive.current)setError(e.message);}finally{lock.current=false;if(alive.current)setBusy(false);}
 };
 const send=async()=>{
  if(lock.current||!preview||!draft.question.trim()||active||uncertain)return;
  lock.current=true;setBusy(true);setError('');
  try{
   const body=request.current||{libraryId,requestId:crypto.randomUUID(),question:draft.question.trim(),previewId:preview.previewId,capture:currentCapture()};request.current=body;
   const result=await api(`${base}/turns`,{method:'POST',body:JSON.stringify(body)});
   if(alive.current){onSession(result.session);store({...draft,question:''});setPreview(null);request.current=null;}
  }catch(e){if(alive.current){setError(e.message);if([400,409,413,422].includes(e.status)){request.current=null;setPreview(null);}else{
    // A failed HTTP response is not proof that model work was rejected.
    try{const result=await api(`${base}?libraryId=${libraryId}`);onSession(result.session);}catch{}
   }}}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 };
 const action=async(kind,extra={})=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const result=await api(`${base}/${kind}`,{method:'POST',body:JSON.stringify({libraryId,...extra})});if(alive.current)onSession(result.session);}catch(e){if(alive.current)setError(e.message);}finally{lock.current=false;if(alive.current)setBusy(false);}};
 return <>
  <ol className="codex-chat-history" aria-label="Codex 对话记录">{session.turns.map(turn=><li key={turn.requestId}>
   <div className="codex-question"><strong>你</strong><p>{turn.question}</p><small>{turn.snapshot.included?`冻结参考 · PDF 第 ${turn.snapshot.page} 页${turn.snapshot.mode==='annotation'?' · 固定批注':''}`:'未附带阅读上下文'}</small><details><summary>本轮实际发送的参考</summary><Snapshot context={turn.snapshot}/></details></div>
   <div className="codex-answer"><strong>Codex</strong>{turn.items.map(item=><p key={item.id}>{item.text}</p>)}<small role="status">{labels[turn.status]}</small>{turn.error&&<p role="alert" className="inline-error">{turn.error}</p>}
    {turn.approvals.map(approval=><div key={String(approval.id)} className="codex-approval" role="alert"><p>{approval.description}</p><code>{approval.method}</code><button disabled={busy} onClick={()=>action('deny',{approvalId:approval.id})}>拒绝此次权限</button></div>)}
   </div>
  </li>)}</ol>
  {!session.turns.length&&<p className="codex-empty">直接和 Codex 讨论当前阅读。先核对参考，再发送问题；回答自动显示在这里。</p>}
  <div className="codex-composer">
   <label className="codex-context-toggle"><input type="checkbox" checked={include} disabled={busy} onChange={e=>setInclude(e.target.checked)}/>附带本次阅读上下文</label>
   {include&&<><label>参考方式<select aria-label="Codex 参考方式" value={mode} disabled={busy} onChange={e=>setMode(e.target.value)}><option value="follow">跟随当前阅读</option><option value="annotation" disabled={!annotation}>固定当前批注</option></select></label><p className="codex-context-note">最多三页文字，选区与批注单独标注。区域图片未做 OCR。</p></>}
   <textarea aria-label="发给 Codex 的问题" value={draft.question} maxLength={12000} disabled={busy} placeholder="解释这里的论证，哪些前提需要核实？" onChange={e=>{request.current=null;store({...draft,question:e.target.value});}}/>
   {preview&&<details open className="codex-snapshot"><summary>将发送的参考 · 第 {preview.context.page} 页</summary><Snapshot context={preview.context}/></details>}
   <div className="codex-composer-actions"><button className="secondary-button" disabled={busy||active||uncertain} onClick={check}>核对上下文</button><button className="primary-button" disabled={busy||active||uncertain||!preview||!draft.question.trim()} onClick={send}>{busy?'正在处理…':'发送给 Codex'}</button></div>
   {active&&<button className="secondary-button" disabled={busy} onClick={()=>action('stop')}>停止回答</button>}
   {uncertain&&<button className="secondary-button" disabled={busy} onClick={()=>action('recover')}>核对原会话结果</button>}
   <p className="codex-context-note">只有点击发送才调用模型。当前聊天不授予命令、写入或整库访问权限。</p>
   {session.runtimeError&&<p className="inline-error" role="alert">{session.runtimeError}</p>}
   {storageError&&<p className="inline-error" role="alert">输入无法暂存，请保持窗口并保存后再切换。</p>}
   {error&&<p className="inline-error" role="alert">{error}</p>}
  </div>
 </>;
}
function Snapshot({context}){
 if(!context.included)return <p>不发送阅读上下文。</p>;
 return <div className="codex-snapshot-body"><p>{context.title} · 第 {context.page} 页</p>{context.visible?.length>0&&<p>可见范围：{context.visible.map(item=>`第 ${item.page} 页（横向 ${Math.round(item.rect.x*100)}–${Math.round((item.rect.x+item.rect.width)*100)}%，纵向 ${Math.round(item.rect.y*100)}–${Math.round((item.rect.y+item.rect.height)*100)}%）`).join('；')}</p>}{context.selection&&<section><strong>选区 · 第 {context.selection.page} 页{context.selection.truncated?' · 已截断':''}</strong><blockquote>{context.selection.quote||'区域选区：未发送图片或 OCR 文字'}</blockquote></section>}{context.annotation&&<section><strong>批注 · 第 {context.annotation.page} 页{context.annotation.truncated?' · 已截断':''}</strong><blockquote>{context.annotation.quote}</blockquote><p>用户评论：{context.annotation.comment}</p></section>}{context.pages.map(page=><section key={page.page}><strong>第 {page.page} 页{page.truncated?' · 已截断':''}</strong><p>{page.text||'没有可提取文字'}</p></section>)}{context.limitations.map((line,i)=><small key={i}>{line}</small>)}</div>;
}
function CodexChat({libraryId,document,page,selection,annotation,readingSnapshotRef,onStateChange}){
 const [sessions,setSessions]=useState([]),[current,setCurrent]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const generation=useRef(0),alive=useRef(true),currentRef=useRef(null);currentRef.current=current;
 const base=`/documents/${document.id}/codex`;
 const loadList=useCallback(async()=>{const result=await api(`${base}/sessions?libraryId=${libraryId}`);if(alive.current)setSessions(result.sessions);return result.sessions;},[base,libraryId]);
 const pointer=`paperdesk-codex-session:${libraryId}:${document.id}`;
 const choose=async id=>{
  const seq=++generation.current;setError('');setBusy(true);
  try{const result=await api(`${base}/sessions/${id}?libraryId=${libraryId}`);if(alive.current&&seq===generation.current){setCurrent(result.session);try{sessionStorage.setItem(pointer,id);}catch{}}}catch(e){if(alive.current&&seq===generation.current)setError(e.message);}finally{if(alive.current&&seq===generation.current)setBusy(false);}
 };
 useEffect(()=>{alive.current=true;loadList().then(list=>{let id;try{id=sessionStorage.getItem(pointer);}catch{}if(id&&list.some(s=>s.id===id))choose(id);}).catch(e=>{if(alive.current)setError(e.message);});return()=>{alive.current=false;++generation.current;};},[loadList]);
 useEffect(()=>{
  if(!current)return;let stopped=false;
  const tick=async()=>{try{const result=await api(`${base}/sessions/${current.id}?libraryId=${libraryId}`);if(!stopped&&alive.current&&currentRef.current?.id===current.id)setCurrent(result.session);}catch(e){if(!stopped&&alive.current)setError(e.message);}};
  const timer=setInterval(tick,600);return()=>{stopped=true;clearInterval(timer);};
 },[base,libraryId,current?.id]);
 const create=async()=>{if(busy)return;setBusy(true);setError('');const seq=++generation.current;try{const result=await api(`${base}/sessions`,{method:'POST',body:JSON.stringify({libraryId,pdfSha256:document.pdfSha256,ownerId,requestId:crypto.randomUUID(),title:`阅读对话 ${sessions.length+1}`})});if(alive.current&&seq===generation.current){setCurrent(result.session);try{sessionStorage.setItem(pointer,result.session.id);}catch{}await loadList();}}catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setBusy(false);}};
 const capture=()=>{if(!readingSnapshotRef.current)throw new Error('阅读器尚未准备好，请稍候。');return readingSnapshotRef.current();};
 return <section className="codex-chat" aria-label="Codex 阅读对话">
  <header className="codex-chat-heading"><div><strong>Codex</strong><small>PDF 第 {page} 页{selection?` · 已选${selection.kind==='region'?'区域':`${selection.quote.length}字`}`:''}{annotation?' · 已关联批注':''}</small></div><button className="text-button" disabled={busy} onClick={create}>新对话</button></header>
  <select aria-label="选择 Codex 会话" value={current?.id||''} disabled={busy} onChange={e=>e.target.value&&choose(e.target.value)}><option value="">选择历史会话或新建</option>{sessions.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select>
  {error&&<p className="inline-error" role="alert">{error}</p>}
  {current?<Composer key={current.id} libraryId={libraryId} document={document} session={current} onSession={setCurrent} capture={capture} annotation={annotation} onStateChange={onStateChange}/>:<div className="codex-empty"><h3>从正在读的地方问起</h3><p>新建对话后，可核对并附带当前页、选区与批注。旧会话保留各轮冻结的参考，不会随翻页变化。</p><button className="primary-button" disabled={busy} onClick={create}>开始 Codex 对话</button></div>}
 </section>;
}

export default function LazyCodexChat({active,...props}){
 const [opened,setOpened]=useState(active);
 useEffect(()=>{if(active)setOpened(true);},[active]);
 return opened?<CodexChat {...props}/>:null;
}
