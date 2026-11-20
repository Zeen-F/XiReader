import { createDiscussionStore } from './discussion-store.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash=/^[0-9a-f]{64}$/;
export function createCodexStore({dataDir,vaultStore,HttpError}){
 const fail=()=>{throw new HttpError(409,'Codex 会话记录格式损坏或来源不匹配；未覆盖原文件。');};
 const validate=(state,id)=>{
  if(!state||state.schemaVersion!==1||state.documentId!==id||!uuid.test(id)||!Array.isArray(state.sessions)||state.sessions.length>50)fail();
  if(new Set(state.sessions.map(s=>s.id)).size!==state.sessions.length)fail();
  for(const s of state.sessions){
   if(!uuid.test(s.id)||!uuid.test(s.ownerId)||s.binding?.documentId!==id||!hash.test(s.binding?.libraryId)||!hash.test(s.binding?.pdfSha256)||typeof s.title!=='string'||s.title.length>200||!Array.isArray(s.turns)||s.turns.length>100||(s.threadId!==null&&typeof s.threadId!=='string'))fail();
   if(new Set(s.turns.map(t=>t.requestId)).size!==s.turns.length)fail();
   for(const t of s.turns){
    if(!uuid.test(t.requestId)||!hash.test(t.fingerprint)||typeof t.question!=='string'||t.question.length>12000||!['preparing','sending','running','stopping','approval','uncertain','failed','completed','interrupted'].includes(t.status)||!Array.isArray(t.items)||t.items.length>100||!Array.isArray(t.approvals))fail();
    if(t.snapshot?.libraryId!==s.binding.libraryId||t.snapshot?.documentId!==id||t.snapshot?.pdfSha256!==s.binding.pdfSha256)fail();
    if(t.toolReads!==undefined&&(!Array.isArray(t.toolReads)||t.toolReads.length>12||t.toolReads.some(r=>typeof r.id!=='string'||!['running','completed','denied','failed'].includes(r.status)||!Array.isArray(r.pages))))fail();
    if(t.items.some(i=>typeof i.id!=='string'||typeof i.text!=='string')||t.items.reduce((n,i)=>n+i.text.length,0)>100000)fail();
   }
  }
 };
 return createDiscussionStore({dataDir,HttpError,validate,databaseName:'codex-conversations.sqlite',emptyState:id=>({schemaVersion:1,documentId:id,sessions:[]}),
  vaultStore:vaultStore?{readDiscussions:id=>vaultStore.readCodexConversations(id),writeDiscussions:(...args)=>vaultStore.writeCodexConversations(...args)}:null});
}
