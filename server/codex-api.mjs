import {queryReadingCapabilities,validateModelSelection,connectionFailure} from './codex-capabilities.mjs';
import {readBoundedDocumentPages} from './codex-document-tool.mjs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createCodexStore } from './codex-store.mjs';
import { createReadingRuntime } from './codex-runtime.mjs';
import { CodexReadingSession } from './codex-session.mjs';
import { buildReadingSnapshot } from './codex-reading-context.mjs';

const ACTIVE=new Set(['preparing','sending','running','stopping','approval']);
const comparable=s=>JSON.stringify({...s,capturedAt:undefined,digest:undefined});
export function registerCodexApi({app,db,dataDir,vaultStore,libraryId,documentOr404,verifyDocument,HttpError,objectBody,uuidValue,options={}}){
 let stored;
 const storage=()=>stored||(stored=createCodexStore({dataDir,vaultStore,HttpError}));
 const store={read:(...args)=>storage().read(...args),mutate:(...args)=>storage().mutate(...args),close:()=>stored?.close()};
 const live=new Map(),creating=new Map(),previews=new Map();
 let runtimePromise=null,closing=false;const requestGuards=new Map();
 const cwd=path.join(dataDir,'codex-empty-runtime');
 const runtime=async()=>{
  if(runtimePromise){const pending=runtimePromise,previous=await pending;if(!previous.closed)return previous;if(runtimePromise===pending)runtimePromise=null;else return runtime();}
  return runtimePromise||(runtimePromise=(options.runtimeFactory||createReadingRuntime)({cwd}).then(rpc=>{const guard=message=>{queueMicrotask(()=>{if(!closing&&![...live.values()].some(s=>s.state.threadId===message.params?.threadId))rpc.rejectRequest(message.id);});};guard.disconnect=()=>{if(!closing)connection={state:'error',message:'Codex CLI 连接已断开。请重新检查连接；原消息不会自动重发。',models:[]};};rpc.on('request',guard);rpc.on('disconnect',guard.disconnect);requestGuards.set(rpc,guard);return rpc;}).catch(error=>{runtimePromise=null;throw error;}));
 };
 let connection={state:'disconnected',message:'尚未检查 Codex CLI 连接。',models:[]},connectionWork=null;
 const connect=async()=>{if(connectionWork)return connectionWork;connection={state:'connecting',message:'正在检查 CLI、已有认证和模型列表…',models:[]};connectionWork=(async()=>{try{connection=await queryReadingCapabilities(await runtime());}catch(error){connection=connectionFailure(error);}return connection;})();try{return await connectionWork;}finally{connectionWork=null;}};
 app.get('/api/codex/connection',(req,res)=>res.json(connection));
 app.post('/api/codex/connection',async(req,res)=>{objectBody(req.body,[]);if(closing)throw new HttpError(503,'服务正在关闭。');res.json(await connect());});
 const getDoc=(req,input)=>{if(input.libraryId!==libraryId)throw new HttpError(409,'当前文献库与请求不一致。');return documentOr404(uuidValue(req.params.id,'文献'));};
 const load=doc=>{
  const state=store.read(doc.id);
  if(state.sessions.some(s=>!live.has(s.id)&&s.turns.some(t=>ACTIVE.has(t.status))))store.mutate(doc.id,d=>{for(const s of d.sessions)if(!live.has(s.id))for(const t of s.turns)if(ACTIVE.has(t.status)){t.status=t.status==='preparing'?'failed':'uncertain';t.approvals=[];t.error='应用曾中断；请核对原会话，不会自动重发。';}});
  return store.read(doc.id);
 };
 const getSession=(doc,id)=>{const s=load(doc).sessions.find(s=>s.id===uuidValue(id,'会话'));if(!s)throw new HttpError(404,'会话不属于当前文献。');if(s.binding.libraryId!==libraryId||s.binding.pdfSha256!==doc.sha256)throw new HttpError(409,'会话来源身份不一致，请保留原记录。');return live.get(s.id)?.disposed?{...s,runtimeError:'会话保存失败，已请求停止且未覆盖外部记录。请保留输入，恢复本机存储后重新打开应用。'}:s;};
 async function session(doc,id){
  if(closing)throw new HttpError(503,'服务正在关闭。');
  if(live.has(id)){const value=live.get(id);if(value.state.binding.documentId!==doc.id)throw new HttpError(409,'会话文献不一致。');if(!value.rpc.closed)return value;value.dispose();live.delete(id);}
  if(creating.has(id))return creating.get(id);
  const work=(async()=>{
   const state=getSession(doc,id),rpc=await runtime();let expected=JSON.stringify(state);
   const value=new CodexReadingSession({rpc,cwd,state,readPages:(args,binding)=>readBoundedDocumentPages({arguments:args,binding,document:documentOr404(doc.id),verifyDocument,readPage:number=>db.prepare('SELECT text FROM pages WHERE document_id=? AND page=?').get(doc.id,number)?.text||''}),save:next=>{
    store.mutate(doc.id,record=>{const index=record.sessions.findIndex(s=>s.id===id);if(index<0||JSON.stringify(record.sessions[index])!==expected)throw new HttpError(409,'其他窗口或外部程序已修改会话，请保留输入并重新读取。');record.sessions[index]=next;});expected=JSON.stringify(next);
   }});
   live.set(id,value);return value;
  })();creating.set(id,work);try{return await work;}finally{creating.delete(id);}
 }
 const snapshot=(doc,request)=>buildReadingSnapshot({request,libraryId,document:doc,verifyDocument,readPage:number=>db.prepare('SELECT text FROM pages WHERE document_id=? AND page=?').get(doc.id,number)?.text||'',readAnnotation:id=>db.prepare('SELECT * FROM annotations WHERE document_id=? AND id=?').get(doc.id,id)});
 const base='/api/documents/:id/codex';
 app.get(`${base}/sessions`,(req,res)=>{const doc=getDoc(req,req.query);res.json({sessions:load(doc).sessions.map(s=>({id:s.id,title:s.title,ownerId:s.ownerId,turnCount:s.turns.length,status:s.turns.at(-1)?.status||'empty'}))});});
 app.post(`${base}/sessions`,(req,res)=>{
  const body=objectBody(req.body,['libraryId','pdfSha256','ownerId','requestId','title']),doc=getDoc(req,body);verifyDocument(doc);
  if(body.pdfSha256!==doc.sha256)throw new HttpError(409,'PDF 身份已变化。');
  const id=uuidValue(body.requestId,'请求'),ownerId=uuidValue(body.ownerId,'窗口');
  const title=typeof body.title==='string'?body.title.trim().slice(0,200):'阅读对话';
  const result=store.mutate(doc.id,state=>{const existing=state.sessions.find(s=>s.id===id);if(existing){if(existing.ownerId!==ownerId)throw new HttpError(409,'会话创建请求冲突。');return existing;}if(state.sessions.length>=50)throw new HttpError(413,'本篇已有 50 个会话，请先保留导出记录。');const s={id,ownerId,title:title||'阅读对话',binding:{libraryId,documentId:doc.id,pdfSha256:doc.sha256},threadId:null,turns:[]};state.sessions.push(s);return s;});res.status(201).json({session:result});
 });
 app.get(`${base}/sessions/:sessionId`,(req,res)=>{const doc=getDoc(req,req.query);res.json({session:getSession(doc,req.params.sessionId)});});
 app.post(`${base}/context`,async(req,res)=>{
  const body=objectBody(req.body,['libraryId','capture']),doc=getDoc(req,body),context=await snapshot(doc,body.capture);
  for(const [key,value]of previews)if(Date.now()-value.at>300000)previews.delete(key);
  if(previews.size>=500)throw new HttpError(429,'上下文核对过于频繁，请稍候。');
  const previewId=randomUUID();previews.set(previewId,{at:Date.now(),documentId:doc.id,context});res.json({previewId,context});
 });
 app.post(`${base}/sessions/:sessionId/turns`,async(req,res)=>{
  const body=objectBody(req.body,['libraryId','requestId','question','previewId','capture','modelSelection']),doc=getDoc(req,body),saved=getSession(doc,req.params.sessionId);
  uuidValue(body.requestId,'发送请求');
  const existing=saved.turns.find(t=>t.requestId===body.requestId);
  if(existing){if(existing.question!==body.question||existing.previewId!==body.previewId||JSON.stringify(existing.modelSelection||null)!==JSON.stringify(body.modelSelection||null))throw new HttpError(409,'不能修改已接收的发送请求。');return res.json({session:saved,replayed:true});}
  const preview=previews.get(body.previewId);
  if(!preview||preview.documentId!==doc.id||Date.now()-preview.at>300000)throw new HttpError(409,'上下文预览已过期，请重新核对。');
  const current=await snapshot(doc,body.capture);
  if(comparable(current)!==comparable(preview.context))throw new HttpError(409,'阅读位置或参考内容已变化，请重新核对上下文后发送。');
  let modelSelection;
  if(body.modelSelection!==undefined){try{modelSelection=validateModelSelection(body.modelSelection,await connect());}catch(error){throw new HttpError(400,error.message);}}
  const value=await session(doc,saved.id);
  // The session owns accepted work even if the requesting HTTP window disappears.
  await value.send({requestId:body.requestId,question:body.question,snapshot:current,modelSelection,previewId:body.previewId,beforeDispatch:async()=>{const latest=await snapshot(doc,{...body.capture,capturedAt:Date.now()});if(comparable(latest)!==comparable(current))throw new HttpError(409,'发送前原文或批注已变化；未发送问题，请重新核对。');}});
  res.json({session:value.view(),replayed:false});
 });
 app.post(`${base}/sessions/:sessionId/stop`,async(req,res)=>{objectBody(req.body,['libraryId']);const doc=getDoc(req,req.body),saved=getSession(doc,req.params.sessionId),value=live.get(saved.id);if(value)await value.stop();res.json({session:value?.view()||saved});});
 app.post(`${base}/sessions/:sessionId/recover`,async(req,res)=>{objectBody(req.body,['libraryId']);const doc=getDoc(req,req.body),value=await session(doc,req.params.sessionId);await value.recover();res.json({session:value.view()});});
 app.post(`${base}/sessions/:sessionId/deny`,async(req,res)=>{objectBody(req.body,['libraryId','approvalId']);const doc=getDoc(req,req.body),saved=getSession(doc,req.params.sessionId),value=live.get(saved.id);if(!value)throw new HttpError(409,'审批连接已断开，请恢复会话。');value.deny(req.body.approvalId);res.json({session:value.view()});});
 return{async close(){closing=true;await Promise.allSettled([...creating.values()]);for(const value of live.values())await value.stop().catch(()=>{});try{await Promise.allSettled([...live.values()].flatMap(value=>[...value.toolWork.values()]));if(runtimePromise)await(await runtimePromise.catch(()=>null))?.close();}finally{for(const [rpc,guard]of requestGuards){rpc.off('request',guard);rpc.off('disconnect',guard.disconnect);}requestGuards.clear();for(const value of live.values())value.dispose();live.clear();store.close();}}};
}
