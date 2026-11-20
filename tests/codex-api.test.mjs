import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp,mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.mjs';
const sample=await readFile(new URL('../public/examples/reading-demo.pdf',import.meta.url));
import {mockCodex} from './fixtures/codex-rpc.mjs';
async function fixture(t,vault=false){
 const root=await mkdtemp(path.join(tmpdir(),'paperdesk-codex-')),dataDir=path.join(root,'data'),vaultDir=vault?path.join(root,'vault'):undefined,mock=mockCodex();
 let runtime,server,libraryId;let starts=0;let selectedRpc=mock.rpc;
 const request=(route,method='GET',body,headers={})=>fetch(`http://127.0.0.1:${server.address().port}/api${route}`,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
 const json=async(route,method='GET',body,status=200)=>{const r=await request(route,method,body);assert.equal(r.status,status,await r.clone().text());return r.json();};
 const start=async()=>{runtime=createApp({dataDir,vaultDir,codexOptions:{runtimeFactory:async()=>{starts++;return selectedRpc;}}});await runtime.ready;server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');libraryId=(await json('/plugin/status')).libraryId;};
 const stop=async()=>{server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));await runtime?.close();server=runtime=null;};
 if(vault)await mkdir(path.join(vaultDir,'.obsidian'),{recursive:true});await start();
 t.after(async()=>{await stop();await rm(root,{recursive:true,force:true});});
 const upload=async(extra='')=>{const form=new FormData();form.append('file',new Blob([sample,extra]),'synthetic.pdf');const r=await fetch(`http://127.0.0.1:${server.address().port}/api/documents`,{method:'POST',body:form});assert.equal(r.status,201);return(await r.json()).document;};
 const base=d=>`/documents/${d.id}/codex`;
 const create=async d=>(await json(`${base(d)}/sessions`,'POST',{libraryId,pdfSha256:d.pdfSha256,ownerId:randomUUID(),requestId:randomUUID()} ,201)).session;
 const capture=d=>({libraryId,documentId:d.id,pdfSha256:d.pdfSha256,capturedAt:Date.now(),page:1,visible:[],selection:null,annotationId:null,includeContext:true,mode:'follow'});
 const preview=async d=>json(`${base(d)}/context`,'POST',{libraryId,capture:capture(d)});
 const send=async(d,s)=>{const p=await preview(d);return{libraryId,requestId:randomUUID(),question:'Explain synthetic fixture',previewId:p.previewId,capture:capture(d)};};
 return{replaceRuntime:rpc=>{selectedRpc=rpc;},root,dataDir,vaultDir,mock,json,request,upload,base,create,capture,preview,send,start,stop,get libraryId(){return libraryId;},get starts(){return starts;}};
}
test('API previews never start CLI; explicit send persists automatic streamed answer and deduplicates',async t=>{
 const f=await fixture(t),d=await f.upload(),s=await f.create(d);await f.preview(d);assert.equal(f.starts,0);
 const body=await f.send(d,s),route=`${f.base(d)}/sessions/${s.id}`;let r=await f.json(`${route}/turns`,'POST',body);assert.equal(f.starts,1);f.mock.finish(r.session.threadId);
 r=await f.json(`${route}?libraryId=${f.libraryId}`);assert.equal(r.session.turns[0].items[0].text,'Synthetic streamed answer');assert.equal(r.session.turns[0].status,'completed');
 await f.json(`${route}/turns`,'POST',body);assert.equal(f.mock.calls.filter(c=>c.method==='turn/start').length,1);
 await f.json(`${route}/turns`,'POST',{...body,question:'changed'},409);
});
test('fresh snapshot changes are rejected before any model request; cross-library and cross-document are isolated',async t=>{
 const f=await fixture(t),d=await f.upload(),other=await f.upload('\n%other synthetic\n'),s=await f.create(d),body=await f.send(d,s),route=`${f.base(d)}/sessions/${s.id}`;
 await f.json(`${route}/turns`,'POST',{...body,capture:{...body.capture,includeContext:false}},409);assert.equal(f.starts,0);
 await f.json(`${route}?libraryId=another`, 'GET',undefined,409);
 await f.json(`${f.base(other)}/sessions/${s.id}?libraryId=${f.libraryId}`,'GET',undefined,404);
 const r=await f.request(`${route}/turns`,'POST',body,{Origin:'https://foreign.invalid'});assert.equal(r.status,403);assert.equal(f.starts,0);
});
test('two sessions and windows cannot consume each other stream or permission request',async t=>{
 const f=await fixture(t),d=await f.upload(),a=await f.create(d),b=await f.create(d);
 const ra=await f.json(`${f.base(d)}/sessions/${a.id}/turns`,'POST',await f.send(d,a));const rb=await f.json(`${f.base(d)}/sessions/${b.id}/turns`,'POST',await f.send(d,b));
 f.mock.finish(ra.session.threadId,'First only');let second=await f.json(`${f.base(d)}/sessions/${b.id}?libraryId=${f.libraryId}`);assert.equal(second.session.turns[0].items.length,0);
 f.mock.finish(rb.session.threadId,'Second only');second=await f.json(`${f.base(d)}/sessions/${b.id}?libraryId=${f.libraryId}`);assert.equal(second.session.turns[0].items[0].text,'Second only');
});
test('vault authoritative sessions survive deleting rebuildable cache without changing notes or PDF',async t=>{
 const f=await fixture(t,true),d=await f.upload(),s=await f.create(d),note=path.join(f.vaultDir,'Paperdesk','Notes',`${d.id}.md`),before=await readFile(note);
 const result=await f.json(`${f.base(d)}/sessions/${s.id}/turns`,'POST',await f.send(d,s));f.mock.finish(result.session.threadId);
 const sidecar=path.join(f.vaultDir,'Paperdesk','CodexConversations',`${d.id}.json`);assert.equal(JSON.parse(await readFile(sidecar,'utf8')).sessions[0].turns.length,1);
 await f.stop();await rm(f.dataDir,{recursive:true,force:true});await f.start();
 const loaded=await f.json(`${f.base(d)}/sessions/${s.id}?libraryId=${f.libraryId}`);assert.equal(loaded.session.turns[0].items[0].text,'Synthetic streamed answer');assert.deepEqual(await readFile(note),before);
});
test('vault external edits are not overwritten by a running response',async t=>{
 const f=await fixture(t,true),d=await f.upload(),s=await f.create(d),result=await f.json(`${f.base(d)}/sessions/${s.id}/turns`,'POST',await f.send(d,s));
 const file=path.join(f.vaultDir,'Paperdesk','CodexConversations',`${d.id}.json`),state=JSON.parse(await readFile(file,'utf8'));state.sessions[0].title='External preserved title';const bytes=JSON.stringify(state)+'\n';await writeFile(file,bytes);
 f.mock.finish(result.session.threadId);assert.equal(await readFile(file,'utf8'),bytes);const observed=await f.json(`${f.base(d)}/sessions/${s.id}?libraryId=${f.libraryId}`);assert.match(observed.session.runtimeError,/保存失败/);assert.equal(observed.session.title,'External preserved title');
});

test('explicit recovery replaces a disconnected CLI and reconciles only the owned turn without resending',async t=>{
 const f=await fixture(t),d=await f.upload(),s=await f.create(d),route=`${f.base(d)}/sessions/${s.id}`;
 const sent=await f.json(`${route}/turns`,'POST',await f.send(d,s)),turn=sent.session.turns[0];
 f.mock.rpc.closed=true;f.mock.rpc.emit('disconnect');
 const next=mockCodex(),request=next.rpc.request;next.rpc.request=async(method,params)=>{
  if(method==='thread/read'){assert.equal(params.threadId,sent.session.threadId);return{thread:{id:params.threadId,turns:[{id:turn.turnId,status:'completed',items:[{type:'agentMessage',id:'recovered',text:'Recovered after CLI exit'}]}]}};}
  return request(method,params);
 };f.replaceRuntime(next.rpc);
 const recovered=await f.json(`${route}/recover`,'POST',{libraryId:f.libraryId});assert.equal(f.starts,2);assert.equal(recovered.session.turns[0].status,'completed');assert.equal(recovered.session.turns[0].items[0].text,'Recovered after CLI exit');assert.equal(next.calls.some(c=>c.method==='turn/start'),false);assert.equal(next.calls.find(c=>c.method==='thread/resume').params.threadId,sent.session.threadId);
});

test('closing runtime detaches its orphan-request guard before another runtime reuses the transport',async t=>{
 const f=await fixture(t),d=await f.upload(),s=await f.create(d),route=`${f.base(d)}/sessions/${s.id}`;
 const sent=await f.json(`${route}/turns`,'POST',await f.send(d,s));f.mock.finish(sent.session.threadId);
 await f.stop();assert.equal(f.mock.rpc.listenerCount('request'),0);assert.equal(f.mock.rpc.listenerCount('notification'),0);
 await f.start();const resumed=await f.json(`${route}/turns`,'POST',await f.send(d,s));
 f.mock.rpc.emit('request',{id:9123,method:'item/tool/call',params:{threadId:resumed.session.threadId,turnId:resumed.session.turns.at(-1).turnId,callId:'resumed-denied',tool:'xireader_read_pages',arguments:{pages:[1]}}});
 await new Promise(resolve=>setImmediate(resolve));const responses=f.mock.calls.filter(c=>c.id===9123);assert.equal(responses.length,1);assert.equal(responses[0].result.success,false);assert.match(responses[0].result.contentItems[0].text,/没有允许/);
 f.mock.finish(resumed.session.threadId);
});

test('connection check sends no model prompt, and selected model/effort reach the owned turn only after validation',async t=>{
 const f=await fixture(t),d=await f.upload(),s=await f.create(d),route=`${f.base(d)}/sessions/${s.id}`;
 assert.equal((await f.json('/codex/connection')).state,'disconnected');assert.equal(f.starts,0);
 const connection=await f.json('/codex/connection','POST',{});assert.equal(connection.state,'ready');assert.equal(f.mock.calls.some(c=>c.method==='turn/start'),false);
 const body=await f.send(d,s);await f.json(`${route}/turns`,'POST',{...body,modelSelection:{model:'fake',effort:'ultra'}},400);assert.equal(f.mock.calls.some(c=>c.method==='turn/start'),false);
 const selection={model:'synthetic-model',effort:'low'};const sent=await f.json(`${route}/turns`,'POST',{...body,modelSelection:selection});const call=f.mock.calls.find(c=>c.method==='turn/start');assert.equal(call.params.model,selection.model);assert.equal(call.params.effort,'low');assert.deepEqual(sent.session.turns[0].modelSelection,selection);
 f.mock.finish(sent.session.threadId);await f.json(`${route}/turns`,'POST',{...body,modelSelection:{...selection,effort:'medium'}},409);
});
