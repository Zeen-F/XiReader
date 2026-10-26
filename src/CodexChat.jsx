import React,{useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import CodexContextTray from './CodexContextTray.jsx';
import CodexConnection from './CodexConnection.jsx';
import { api } from './api.js';
import { createDiscussionDraftStore } from './discussion-drafts.mjs';
import './codex-chat.css';
const ownerId=crypto.randomUUID();
const activeStates=new Set(['preparing','sending','running','stopping','approval']);
const labels={preparing:'准备连接',sending:'正在发送',running:'正在回答',stopping:'正在停止',approval:'等待你拒绝权限或停止',uncertain:'结果待核对',failed:'未完成',completed:'已完成',interrupted:'已停止'};

function Composer({libraryId,document,session,onSession,capture,annotation,onStateChange,onSaveAnswer,connection,modelSelection,onConnection,onModelSelection,readingPage,selection,onExplicitTurn,initialSelectionIncluded=true}){
 const [draftStore]=useState(()=>createDiscussionDraftStore({libraryId,documentId:document.id,threadId:`codex:${session.id}`,owner:ownerId}));
 const [draft,setDraft]=useState(()=>draftStore.read()),[include,setInclude]=useState(true),[mode,setMode]=useState(annotation?.id?'annotation':'follow'),[allowRead,setAllowRead]=useState(false),[includeSelection,setIncludeSelection]=useState(initialSelectionIncluded),[saveReview,setSaveReview]=useState(null),[savedMessage,setSavedMessage]=useState(null),[notice,setNotice]=useState('');
 const [preview,setPreview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[storageError,setStorageError]=useState(draftStore.storageError);
 const saveDialog=useRef(null),saveCancel=useRef(null);
 const historyNode=useRef(null),followOutput=useRef(true),explicitTurn=useRef(null);
 const alive=useRef(true),lock=useRef(false),request=useRef(null),previewSequence=useRef(0);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const base=`/documents/${document.id}/codex/sessions/${session.id}`;
 const live=session.turns.at(-1),active=activeStates.has(live?.status),uncertain=session.turns.some(t=>t.status==='uncertain');
 useEffect(()=>{const own=Boolean(live&&explicitTurn.current===live.requestId);if(own){followOutput.current=true;explicitTurn.current=null;}if(followOutput.current&&historyNode.current){const list=historyNode.current,last=list.lastElementChild;if(last&&(own||!live?.items.length||['completed','interrupted'].includes(live?.status))){list.scrollTop+=last.getBoundingClientRect().top-list.getBoundingClientRect().top-4;}else list.scrollTop=list.scrollHeight;}},[session.turns.length,live?.status,live?.items.map(i=>i.text.length).join(',')]);
 useEffect(()=>{if(!saveReview||!saveDialog.current)return;const dialog=saveDialog.current;dialog.showModal();saveCancel.current?.focus();return()=>{if(dialog.open)dialog.close();};},[saveReview]);
 useEffect(()=>{if(!savedMessage)return;const status=historyNode.current?.querySelector(`[data-codex-turn="${savedMessage.requestId}"] .codex-save-confirmation`);if(status&&historyNode.current){followOutput.current=false;const list=historyNode.current,box=status.getBoundingClientRect();list.scrollTop+=box.top-list.getBoundingClientRect().top-(list.clientHeight-box.height)/2;status.focus({preventScroll:true});}},[savedMessage]);
 const store=value=>{draftStore.write(value);setDraft(value);setStorageError(draftStore.storageError);};
 useEffect(()=>{onStateChange({dirty:Boolean(draft.question),storageError,busy});},[draft.question,storageError,busy,onStateChange]);
 useEffect(()=>()=>onStateChange({dirty:false,storageError:false,busy:false}),[onStateChange]);
 const currentCapture=()=>{
  const reading=capture();
  return{...reading,selection:includeSelection?reading.selection:null,libraryId,includeContext:include,allowDocumentRead:include&&allowRead,mode,annotationId:mode==='annotation'?annotation?.id||null:null};
 };
 const invalidate=()=>{++previewSequence.current;setPreview(null);request.current=null;};
 useEffect(()=>{invalidate();},[include,includeSelection,mode,allowRead,annotation?.id,annotation?.comment]);
 useEffect(()=>{if(annotation?.id){setMode('annotation');setInclude(true);setNotice(`已将下一条消息的引用切换到 PDF 第 ${annotation.page} 页批注；历史和草稿未改变。`);window.document.querySelector('.codex-chat textarea[aria-label="发给 Codex 的问题"]')?.focus();}},[annotation?.focusRequest]);
 const lastSelection=useRef(selection);
 useEffect(()=>{if(lastSelection.current!==selection){lastSelection.current=selection;setIncludeSelection(true);}},[selection]);
 useEffect(()=>{if(!annotation?.id)setMode('follow');},[annotation?.id]);
 useEffect(()=>{request.current=null;},[modelSelection?.model,modelSelection?.effort]);
 const saveAnswer=async()=>{if(lock.current||!saveReview)return;lock.current=true;setBusy(true);setError('');try{await onSaveAnswer({sessionId:session.id,requestId:saveReview.turn.requestId,itemId:saveReview.item.id,target:saveReview.target});setSavedMessage({requestId:saveReview.turn.requestId,text:saveReview.target==='annotation'?'✓ 已保存到此批注 · 原评论和对话来源已保留':'✓ 已保存到笔记 · 原内容和对话来源已保留'});setSaveReview(null);}catch(e){setError(e.message);}finally{lock.current=false;if(alive.current)setBusy(false);}};
 const check=async()=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('');const seq=++previewSequence.current;
  try{const result=await api(`/documents/${document.id}/codex/context`,{method:'POST',body:JSON.stringify({libraryId,capture:currentCapture()})});if(alive.current&&seq===previewSequence.current){setPreview(result);request.current=null;}}
  catch(e){if(alive.current)setError(e.message);}finally{lock.current=false;if(alive.current)setBusy(false);}
 };
 const send=async()=>{
  if(lock.current||!preview||!draft.question.trim()||active||uncertain||connection.state!=='ready'||!modelSelection?.model)return;
  lock.current=true;followOutput.current=true;onExplicitTurn();setBusy(true);setError('');
  try{
   const body=request.current||{libraryId,requestId:crypto.randomUUID(),question:draft.question.trim(),modelSelection,previewId:preview.previewId,capture:currentCapture()};request.current=body;explicitTurn.current=body.requestId;
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
  <ol ref={historyNode} onScroll={()=>{const n=historyNode.current;if(n)followOutput.current=n.scrollHeight-n.scrollTop-n.clientHeight<48;}} className="codex-chat-history" aria-label="Codex 对话记录">{session.turns.map(turn=><li key={turn.requestId} data-codex-turn={turn.requestId}>
   <div className="codex-question"><header className="codex-role-heading"><strong>你</strong><span>已发送</span></header><p>{turn.question}</p><small>{turn.snapshot.included?`已发送参考 · PDF 第 ${turn.snapshot.page} 页${turn.snapshot.mode==='annotation'?' · 固定批注':''}`:'未附带阅读上下文'}</small><details><summary>查看本轮冻结的参考</summary><Snapshot context={turn.snapshot}/></details></div>
   <div className="codex-answer"><header className="codex-role-heading"><strong><span aria-hidden="true" className="codex-role-mark">C</span> Codex</strong><small className={`codex-turn-status status-${turn.status}`} role="status">{labels[turn.status]}</small></header>{turn.items.length>1&&<details className="codex-process"><summary>查看处理过程（{turn.items.length-1}）</summary>{turn.items.slice(0,-1).map(item=><p key={item.id}>{item.text}</p>)}</details>}{turn.items.slice(-1).map(item=><div className="codex-answer-body" key={item.id}>{item.text.split(/\n\n+/).map((text,index)=><p key={index}>{text}</p>)}</div>)}{activeStates.has(turn.status)&&!turn.items.length&&<p className="codex-response-pending">{turn.toolReads?.some(t=>t.status==='running')?'正在补读文献…':'请求已接收，等待 Codex 输出…'}</p>}{turn.modelSelection&&<small>{turn.modelSelection.model} · {turn.modelSelection.effort||'默认推理'}</small>}{turn.status==='completed'&&turn.items.filter(item=>item.text.trim()).slice(-1).map(item=><div className="codex-message-actions" key={item.id}><button disabled={busy} onClick={()=>setSaveReview({turn,item,target:'notes'})}>保存回答到笔记</button>{turn.snapshot.annotation&&<button disabled={busy} onClick={()=>setSaveReview({turn,item,target:'annotation'})}>保存到此批注</button>}</div>)}{savedMessage?.requestId===turn.requestId&&<p className="codex-save-confirmation" role="status" tabIndex={-1}>{savedMessage.text}</p>}{turn.error&&<p role="alert" className="inline-error">{turn.error}</p>}
    {(turn.toolReads||[]).map(tool=><details className="codex-tool-event" key={tool.id}><summary>补读 PDF 第 {tool.pages?.join('、')||'—'} 页 · {({running:'读取中',completed:'已读取',denied:'未授权',failed:'失败'})[tool.status]||tool.status}</summary>{tool.error&&<p role="alert">{tool.error}</p>}{tool.output&&<pre>{JSON.stringify(tool.output,null,2)}</pre>}</details>)}{turn.approvals.map(approval=><div key={String(approval.id)} className="codex-approval" role="alert"><p>{approval.description}</p><code>{approval.method}</code><button disabled={busy} onClick={()=>action('deny',{approvalId:approval.id})}>拒绝此次权限</button></div>)}
   </div>
  </li>)}</ol>
  {!session.turns.length&&<p className="codex-empty">直接和 Codex 讨论当前阅读。先核对参考，再发送问题；回答自动显示在这里。</p>}
  <div className="codex-composer">
   <CodexContextTray document={document} page={readingPage} included={include} selection={selection} selectionIncluded={includeSelection} annotation={annotation} mode={mode} disabled={busy} onRemoveDocument={()=>setInclude(false)} onRemoveSelection={()=>setIncludeSelection(false)} onRestoreSelection={()=>setIncludeSelection(true)} onFollow={()=>{setMode('follow');setInclude(true);setIncludeSelection(true);setNotice('下一条消息改为跟随阅读；已发送消息不变。');}}/>
   <div className="codex-context-controls"><label><input type="checkbox" aria-label="附带本次阅读上下文" checked={include} disabled={busy} onChange={e=>setInclude(e.target.checked)}/>附带阅读</label>{include&&<label><input type="checkbox" aria-label="允许本轮按需补读本篇 PDF（每次最多 3 页）" checked={allowRead} disabled={busy} onChange={e=>setAllowRead(e.target.checked)}/>允许补读本篇</label>}{include&&<select aria-label="Codex 参考方式" value={mode} disabled={busy} onChange={e=>setMode(e.target.value)}><option value="follow">跟随阅读</option><option value="annotation" disabled={!annotation}>固定批注</option></select>}</div>
   <CodexConnection connection={connection} onConnection={onConnection} selection={modelSelection} onSelection={onModelSelection} busy={busy||active}/>
   <textarea aria-label="发给 Codex 的问题" value={draft.question} maxLength={12000} disabled={busy} placeholder="解释这里的论证，哪些前提需要核实？" onChange={e=>{request.current=null;store({...draft,question:e.target.value});}}/>
   {preview&&<details open className="codex-snapshot"><summary>将发送的参考 · 第 {preview.context.page} 页</summary><Snapshot context={preview.context}/></details>}
   <div className="codex-composer-actions"><button className="secondary-button" disabled={busy||active||uncertain} onClick={check}>核对上下文</button><button className="primary-button" disabled={busy||active||uncertain||connection.state!=='ready'||!modelSelection?.model||!preview||!draft.question.trim()} onClick={send}>{busy?'正在处理…':'发送给 Codex'}</button></div>
   {active&&<button className="secondary-button" disabled={busy} onClick={()=>action('stop')}>停止回答</button>}
   {uncertain&&<button className="secondary-button" disabled={busy} onClick={()=>action('recover')}>核对原会话结果</button>}
   <details className="codex-scope-help"><summary>共享范围与权限</summary><p className="codex-context-note">只有点击发送才调用模型。最多三页有界文字；预览明确缺文本与截断。补读仅当前文献和本轮显式允许，不授予命令、写入或整库权限。</p></details>
   {notice&&<p role="status">{notice}</p>}

   {session.runtimeError&&<p className="inline-error" role="alert">{session.runtimeError}</p>}
   {storageError&&<p className="inline-error" role="alert">输入无法暂存，请保持窗口并保存后再切换。</p>}
   {error&&<p className="inline-error" role="alert">{error}</p>}
  </div>
  {saveReview&&createPortal(<dialog ref={saveDialog} aria-label="核对保存的 Codex 回答" className="codex-save-dialog" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();event.preventDefault();if(!busy)setSaveReview(null);}}} onCancel={event=>{event.stopPropagation();event.preventDefault();if(!busy)setSaveReview(null);}}><h3>{saveReview.target==='annotation'?'追加到本轮原批注':'追加到本篇笔记'}</h3><p>保留原内容；附上此消息来源。不会把旧手工记录伪装成模型回答。</p><textarea aria-label="待保存的真实回答" readOnly value={saveReview.item.text}/>{error&&<p role="alert" className="inline-error">{error}</p>}<div><button ref={saveCancel} disabled={busy} onClick={()=>setSaveReview(null)}>取消保存</button><button disabled={busy} onClick={saveAnswer}>确认追加回答</button></div></dialog>,window.document.body)}
 </>;
}
function Snapshot({context}){
 if(!context.included)return <p>不发送阅读上下文。</p>;
 return <div className="codex-snapshot-body">{context.allowDocumentRead&&<p>本轮允许 Codex 按需补读本篇 PDF；每次最多 3 页，每轮最多 4 次，过程将显示在本消息中。</p>}<p>{context.title} · 第 {context.page} 页</p>{context.visible?.length>0&&<p>可见范围：{context.visible.map(item=>`第 ${item.page} 页（横向 ${Math.round(item.rect.x*100)}–${Math.round((item.rect.x+item.rect.width)*100)}%，纵向 ${Math.round(item.rect.y*100)}–${Math.round((item.rect.y+item.rect.height)*100)}%）`).join('；')}</p>}{context.selection&&<section><strong>选区 · 第 {context.selection.page} 页{context.selection.truncated?' · 已截断':''}</strong><blockquote>{context.selection.quote||'区域选区：未发送图片或 OCR 文字'}</blockquote></section>}{context.annotation&&<section><strong>批注 · 第 {context.annotation.page} 页{context.annotation.truncated?' · 已截断':''}</strong><blockquote>{context.annotation.quote}</blockquote><p>用户评论：{context.annotation.comment}</p></section>}{context.pages.map(page=><section key={page.page}><strong>第 {page.page} 页{page.truncated?' · 已截断':''}</strong><p>{page.text||'没有可提取文字'}</p></section>)}{context.limitations.map((line,i)=><small key={i}>{line}</small>)}</div>;
}
function CodexChat({libraryId,document,page,selection,annotation,readingSnapshotRef,onStateChange,target,onSaveAnswer}){
 const [connection,setConnection]=useState({state:'disconnected',message:'连接后可选择真实模型与推理强度；连接检查不发送阅读资料。',models:[]}),[modelSelection,setModelSelection]=useState(null);
 const [sessions,setSessions]=useState([]),[current,setCurrent]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [pendingSelectionHidden,setPendingSelectionHidden]=useState(false);useEffect(()=>setPendingSelectionHidden(false),[selection]);
 const [loaded,setLoaded]=useState(false),[focusedMessage,setFocusedMessage]=useState(null);const createLock=useRef(false),autoAttempt=useRef(null),guard=useRef({});
 const reportState=useCallback(state=>{guard.current=state;onStateChange(state);},[onStateChange]);
 const safeSwitch=()=>{if(guard.current.busy||(guard.current.dirty&&guard.current.storageError))throw new Error('输入正在处理或无法暂存，请先保留草稿。');};
 const generation=useRef(0),alive=useRef(true),currentRef=useRef(null);currentRef.current=current;
 const base=`/documents/${document.id}/codex`;
 useEffect(()=>{if(connection.state!=='ready')return;const prior=current?.turns.at(-1)?.modelSelection;setModelSelection(previous=>{const wanted=prior||previous,model=connection.models.find(m=>m.id===wanted?.model)||connection.models.find(m=>m.isDefault)||connection.models[0];return{model:model.id,effort:model.efforts.includes(wanted?.effort)?wanted.effort:model.defaultEffort};});},[connection,current?.id]);
 const loadList=useCallback(async()=>{const result=await api(`${base}/sessions?libraryId=${libraryId}`);if(alive.current)setSessions(result.sessions);return result.sessions;},[base,libraryId]);
 const pointer=`paperdesk-codex-session:${libraryId}:${document.id}`;
 const choose=async(id,messageId)=>{
  try{safeSwitch();}catch(e){setError(e.message);return;}
  const seq=++generation.current;setError('');setBusy(true);
  try{const result=await api(`${base}/sessions/${id}?libraryId=${libraryId}`);if(alive.current&&seq===generation.current){if(messageId&&!result.session.turns.some(t=>t.requestId===messageId))throw new Error('原消息未找到，未切换到其他消息。');setCurrent(result.session);setFocusedMessage(messageId||null);try{sessionStorage.setItem(pointer,id);localStorage.setItem(pointer,id);}catch{}}}catch(e){if(alive.current&&seq===generation.current)setError(e.message);}finally{if(alive.current&&seq===generation.current)setBusy(false);}
 };
 useEffect(()=>{alive.current=true;loadList().then(async list=>{let id;try{id=sessionStorage.getItem(pointer);}catch{}if(id&&list.some(s=>s.id===id))await choose(id);if(alive.current)setLoaded(true);}).catch(e=>{if(alive.current){setError(e.message);setLoaded(true);}});return()=>{alive.current=false;++generation.current;};},[loadList]);
 useEffect(()=>{
  if(!current)return;let stopped=false;
  const tick=async()=>{try{const result=await api(`${base}/sessions/${current.id}?libraryId=${libraryId}`);if(!stopped&&alive.current&&currentRef.current?.id===current.id)setCurrent(result.session);}catch(e){if(!stopped&&alive.current)setError(e.message);}};
  const timer=setInterval(tick,600);return()=>{stopped=true;clearInterval(timer);};
 },[base,libraryId,current?.id]);
 const create=async()=>{if(busy||createLock.current)return;try{safeSwitch();}catch(e){setError(e.message);return;}createLock.current=true;setBusy(true);setError('');const seq=++generation.current;try{const result=await api(`${base}/sessions`,{method:'POST',body:JSON.stringify({libraryId,pdfSha256:document.pdfSha256,ownerId,requestId:crypto.randomUUID(),title:`阅读对话 ${sessions.length+1}`})});if(alive.current&&seq===generation.current){setCurrent(result.session);try{sessionStorage.setItem(pointer,result.session.id);localStorage.setItem(pointer,result.session.id);}catch{}await loadList();}}catch(e){if(alive.current)setError(e.message);}finally{createLock.current=false;if(alive.current)setBusy(false);}};
 useEffect(()=>{if(!loaded||!annotation?.id||current||busy||target?.sessionId||autoAttempt.current===annotation.focusRequest)return;autoAttempt.current=annotation.focusRequest;let remembered;try{remembered=localStorage.getItem(pointer);}catch{}const found=sessions.find(s=>s.id===remembered)||sessions.at(-1);if(found)void choose(found.id);else void create();},[loaded,annotation?.focusRequest,current?.id,busy,sessions.length]);
 useEffect(()=>{if(loaded&&target?.sessionId)void choose(target.sessionId,target.requestId);},[loaded,target?.focusRequest]);
 useEffect(()=>{if(!focusedMessage||!current)return;const node=window.document.querySelector(`[data-codex-turn="${focusedMessage}"]`);node?.scrollIntoView({block:'center'});if(node){node.classList.add('codex-message-focused');return()=>node.classList.remove('codex-message-focused');}},[focusedMessage,current?.id,current?.turns.length,target?.focusRequest]);
 // A just-created or directly resumed session is already usable before the
 // separate history refresh returns; keep its selector value visible meanwhile.
 const listedSessions=current&&!sessions.some(item=>item.id===current.id)?[...sessions,current]:sessions;
 const capture=()=>{if(!readingSnapshotRef.current)throw new Error('阅读器尚未准备好，请稍候。');return readingSnapshotRef.current();};
 return <section className="codex-chat" aria-label="Codex 阅读对话">
  <header className="codex-chat-heading"><div><strong>Codex</strong><small>PDF 第 {page} 页{selection?` · 已选${selection.kind==='region'?'区域':`${selection.quote.length}字`}`:''}{annotation?' · 已关联批注':''}</small></div><button className="text-button" disabled={busy} onClick={create}>新对话</button></header>
  {!current&&<CodexConnection connection={connection} onConnection={setConnection} selection={modelSelection} onSelection={setModelSelection} busy={busy}/>}
  <select aria-label="选择 Codex 会话" value={current?.id||''} disabled={busy} onChange={e=>e.target.value&&choose(e.target.value)}><option value="">选择历史会话或新建</option>{listedSessions.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select>
  {error&&<p className="inline-error" role="alert">{error}</p>}
  {current?<Composer key={current.id} libraryId={libraryId} document={document} session={current} onSession={setCurrent} capture={capture} annotation={annotation} onStateChange={reportState} onSaveAnswer={onSaveAnswer} connection={connection} modelSelection={modelSelection} onConnection={setConnection} onModelSelection={setModelSelection} onExplicitTurn={()=>setFocusedMessage(null)} readingPage={page} selection={selection} initialSelectionIncluded={!pendingSelectionHidden}/>:<div className="codex-empty"><CodexContextTray document={document} page={page} included selection={selection} selectionIncluded={!pendingSelectionHidden} onRemoveSelection={()=>setPendingSelectionHidden(true)} onRestoreSelection={()=>setPendingSelectionHidden(false)}/><h3>从正在读的地方问起</h3><p>新建对话后，可核对并附带当前页、选区与批注。旧会话保留各轮冻结的参考，不会随翻页变化。</p><button className="primary-button" disabled={busy} onClick={create}>开始 Codex 对话</button></div>}
 </section>;
}

export default function LazyCodexChat({active,...props}){
 const [opened,setOpened]=useState(active);
 useEffect(()=>{if(active)setOpened(true);},[active]);
 return opened?<CodexChat {...props}/>:null;
}
