import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CodexReadingSession } from '../server/codex-session.mjs';
function fixture(){
 const rpc=new EventEmitter(),calls=[],saved=[];let counter=0;
 rpc.start=async()=>{};
 rpc.request=async(method,params)=>{calls.push({method,params});if(method==='thread/start'||method==='thread/resume')return{thread:{id:'owned-thread'},sandbox:{type:'readOnly'},approvalsReviewer:'user'};if(method==='turn/start')return{turn:{id:`turn-${++counter}`}};return{};};
 rpc.respond=(id,result)=>calls.push({id,result});rpc.rejectRequest=id=>calls.push({id,rejected:true});
 const binding={libraryId:'lib',documentId:'doc',pdfSha256:'hash'};
 const state={id:'session',binding,threadId:null,turns:[]};
 const s=new CodexReadingSession({rpc,cwd:'/synthetic-empty',state,save:value=>saved.push(value)});
 const send=(id='request-0001')=>s.send({requestId:id,question:'Synthetic question',snapshot:{...binding,pages:[]}});
 return{s,rpc,calls,saved,send,binding};
}
test('streamed automatic answers, continuation and frozen evidence remain in one owned thread',async()=>{
 const f=fixture();await f.send();f.rpc.emit('notification',{method:'item/agentMessage/delta',params:{threadId:'owned-thread',turnId:'turn-1',itemId:'a',delta:'Answer'}});
 assert.equal(f.s.view().turns[0].items[0].text,'Answer');
 f.rpc.emit('notification',{method:'turn/completed',params:{threadId:'owned-thread',turn:{id:'turn-1',status:'completed'}}});await f.send('request-0002');
 assert.equal(f.calls.filter(c=>c.method==='thread/start').length,1);assert.equal(f.calls.filter(c=>c.method==='turn/start').length,2);
 const input=f.calls.find(c=>c.method==='turn/start').params;assert.equal(input.input[0].text,'Synthetic question');assert.ok(Object.values(input.additionalContext).every(v=>v.kind==='untrusted'));
 assert.deepEqual(f.calls.find(c=>c.method==='turn/start').params.environments,[]);assert.equal(f.saved[0].turns[0].status,'preparing');
});
test('cross-document snapshots, foreign notifications and approvals are isolated',async()=>{
 const f=fixture();await assert.rejects(f.s.send({requestId:'request-0001',question:'q',snapshot:{...f.binding,documentId:'other'}}),/不匹配/);assert.equal(f.calls.length,0);
 await f.send();f.rpc.emit('notification',{method:'item/agentMessage/delta',params:{threadId:'foreign',turnId:'turn-1',itemId:'a',delta:'must not appear'}});assert.deepEqual(f.s.view().turns[0].items,[]);
 const before=f.calls.length;f.rpc.emit('request',{id:9,method:'item/fileChange/requestApproval',params:{threadId:'foreign',turnId:'turn-1'}});assert.equal(f.calls.length,before);
});
test('duplicate send never duplicates model turn, changed retry is rejected',async()=>{
 const f=fixture();await f.send();await f.send();assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);
 await assert.rejects(f.s.send({requestId:'request-0001',question:'different',snapshot:{...f.binding,pages:[]}}),/不同内容/);
});
test('stop requested during thread binding prevents sending the question',async()=>{
 const f=fixture();let release;f.rpc.start=()=>new Promise(resolve=>{release=resolve;});const send=f.send();await f.s.stop();release();await send;
 assert.equal(f.calls.some(c=>c.method==='turn/start'),false);assert.equal(f.s.view().turns[0].status,'interrupted');
});
test('stop before turn acknowledgement interrupts exactly once after id arrives',async()=>{
 const f=fixture(),base=f.rpc.request;let release;f.rpc.request=async(m,p)=>m==='turn/start'?new Promise(resolve=>{release=resolve;}):base(m,p);
 const send=f.send();for(let i=0;i<30&&!release;i++)await Promise.resolve();assert.ok(release);await f.s.stop();release({turn:{id:'turn-race'}});await send;assert.equal(f.calls.filter(c=>c.method==='turn/interrupt').length,0);f.rpc.emit('notification',{method:'turn/started',params:{threadId:'owned-thread',turn:{id:'turn-race'}}});await f.s.stop();
 assert.equal(f.calls.filter(c=>c.method==='turn/interrupt').length,1);
});
test('approval waits for user rejection and never grants session permission',async()=>{
 const f=fixture();await f.send();const before=f.calls.length;
 f.rpc.emit('request',{id:3,method:'item/permissions/requestApproval',params:{threadId:'owned-thread',turnId:'turn-1'}});
 assert.equal(f.calls.length,before);assert.equal(f.s.view().turns[0].status,'approval');f.s.deny(3);assert.deepEqual(f.calls.at(-1).result,{permissions:{},scope:'turn'});assert.throws(()=>f.s.deny(3),/失效/);
});
test('uncertain dispatch blocks resending and preserves the synthetic question',async()=>{
 const f=fixture(),base=f.rpc.request;f.rpc.request=async(m,p)=>{if(m==='turn/start')throw new Error('timeout');return base(m,p);};
 await assert.rejects(f.send(),/timeout/);assert.equal(f.s.view().turns[0].status,'uncertain');await assert.rejects(f.send('request-0002'),/核对/);assert.equal(f.s.view().turns[0].question,'Synthetic question');
});
test('restart resumes only locally owned thread; recovery never reads native history files',async()=>{
 const f=fixture();await f.send();f.rpc.emit('disconnect');const state=f.s.view();f.s.dispose();let read=false;
 const resumed=new CodexReadingSession({rpc:f.rpc,cwd:'/synthetic-empty',state,save:()=>{}}),base=f.rpc.request;
 f.rpc.request=async(m,p)=>{if(m==='thread/read'){read=true;assert.equal(p.threadId,'owned-thread');return{thread:{id:'owned-thread',turns:[{id:'turn-1',status:'completed',items:[{type:'agentMessage',id:'a',text:'Recovered synthetic answer'}]}]}};}return base(m,p);};
 await resumed.recover();assert.equal(read,true);assert.equal(resumed.view().turns[0].status,'completed');assert.equal(resumed.view().turns[0].items[0].text,'Recovered synthetic answer');assert.equal(f.calls.at(-1).method,'thread/resume');
});
test('broader returned runtime permissions prevent turn dispatch',async()=>{
 const f=fixture();f.rpc.request=async()=>({thread:{id:'owned-thread'},sandbox:{type:'dangerFullAccess'},approvalsReviewer:'user'});
 await assert.rejects(f.send(),/只读/);assert.equal(f.s.view().turns[0].status,'failed');
});
test('source changed during connection is rejected before model dispatch',async()=>{
 const f=fixture();await assert.rejects(f.s.send({requestId:'request-0001',question:'q',snapshot:{...f.binding},beforeDispatch:async()=>{throw new Error('PDF changed before dispatch');}}),/PDF changed/);assert.equal(f.calls.some(c=>c.method==='turn/start'),false);assert.equal(f.s.view().turns[0].status,'failed');
});
test('completion winning a stop race is reconciled without relabeling it uncertain',async()=>{
 const f=fixture();await f.send();f.rpc.emit('notification',{method:'turn/started',params:{threadId:'owned-thread',turn:{id:'turn-1'}}});const base=f.rpc.request;
 f.rpc.request=async(m,p)=>{if(m==='turn/interrupt')throw new Error('already finished');if(m==='thread/read')return{thread:{id:'owned-thread',turns:[{id:'turn-1',status:'completed',items:[]}]}};return base(m,p);};await f.s.stop();assert.equal(f.s.view().turns[0].status,'completed');
});

test('approval persistence failure rejects permission and interrupts without escaping the event handler',async()=>{
 const f=fixture();await f.send();f.s.save=()=>{throw new Error('Synthetic disk failure');};
 assert.doesNotThrow(()=>f.rpc.emit('request',{id:31,method:'item/fileChange/requestApproval',params:{threadId:'owned-thread',turnId:'turn-1'}}));
 assert.equal(f.calls.some(c=>c.id===31&&c.rejected),true);assert.equal(f.calls.some(c=>c.method==='turn/interrupt'),true);assert.equal(f.calls.some(c=>c.id===31&&c.result),false);
});
test('document tool requires per-turn opt-in and exposes denial in the same transcript',async()=>{
 const f=fixture();let reads=0;f.s.readPages=async()=>{reads++;return{pages:[]};};await f.send();
 f.rpc.emit('request',{id:50,method:'item/tool/call',params:{threadId:'owned-thread',turnId:'turn-1',callId:'read-1',tool:'xireader_read_pages',arguments:{pages:[1]}}});await Promise.all([...f.s.toolWork.values()]);
 assert.equal(reads,0);assert.equal(f.s.view().turns[0].toolReads[0].status,'denied');assert.equal(f.calls.find(c=>c.id===50).result.success,false);
});
test('authorized document tool deduplicates calls and enforces the four-read budget',async()=>{
 const f=fixture();let reads=0;f.s.readPages=async(args,binding)=>{reads++;assert.deepEqual(binding,f.binding);return{pages:args.pages.map(page=>({page,text:'Synthetic evidence'}))};};
 await f.s.send({requestId:'reading-0001',question:'Read prior definition',snapshot:{...f.binding,included:true,allowDocumentRead:true}});
 const invoke=async(id,callId,pages=[1])=>{f.rpc.emit('request',{id,method:'item/tool/call',params:{threadId:'owned-thread',turnId:'turn-1',callId,tool:'xireader_read_pages',arguments:{pages}}});await Promise.all([...f.s.toolWork.values()]);await Promise.resolve();};
 await invoke(51,'read-1');await invoke(52,'read-1');assert.equal(reads,1);await invoke(53,'read-1',[2]);assert.equal(f.calls.find(c=>c.id===53).result.success,false);assert.equal(reads,1);
 for(let i=2;i<=5;i++)await invoke(60+i,`read-${i}`);assert.equal(reads,4);assert.equal(f.calls.find(c=>c.id===65).result.success,false);assert.equal(f.s.view().turns[0].toolReads.filter(t=>t.status==='completed').length,4);
});
test('stop during a document read does not send late PDF content to the model',async()=>{
 const f=fixture();let release;f.s.readPages=()=>new Promise(r=>{release=r;});await f.s.send({requestId:'reading-0001',question:'Read',snapshot:{...f.binding,included:true,allowDocumentRead:true}});
 f.rpc.emit('request',{id:80,method:'item/tool/call',params:{threadId:'owned-thread',turnId:'turn-1',callId:'read-delayed',tool:'xireader_read_pages',arguments:{pages:[1]}}});assert.ok(release);await f.s.stop();release({pages:[{page:1,text:'Must not be sent'}]});await Promise.all([...f.s.toolWork.values()]);await Promise.resolve();const response=f.calls.find(c=>c.id===80).result;assert.equal(response.success,false);assert.doesNotMatch(JSON.stringify(response),/Must not be sent/);
});
