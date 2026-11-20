import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { CodexRpc, readingThreadParams, deniedApproval } from '../server/codex-rpc.mjs';

function fixture(t, options = {}) {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null;
  const sent = []; let bytes = '';
  child.stdin.on('data', chunk => { bytes += chunk; let index; while ((index = bytes.indexOf('\n')) >= 0) { sent.push(JSON.parse(bytes.slice(0,index))); bytes = bytes.slice(index+1); } });
  child.stdin.on('finish', () => { child.exitCode = 0; child.emit('exit', 0); });
  let spawnOptions;
  const rpc = new CodexRpc({ cwd: '/synthetic-only', timeoutMs: 1000, spawnProcess: (command, args, config) => { spawnOptions = { command,args,config }; return child; }, ...options });
  t.after(() => rpc.close());
  const send = value => child.stdout.write(JSON.stringify(value)+'\n');
  const ready = async () => { const p = rpc.start(); send({ id:sent[0].id, result: { userAgent:'synthetic' } }); await p; };
  return { rpc,child,sent,send,ready,get spawnOptions(){return spawnOptions;} };
}

test('stdio initialization, concurrent request correlation and fragmented UTF-8 stream',async t=>{
  const f=fixture(t);await f.ready();assert.equal(f.spawnOptions.config.shell,false);assert.equal(f.sent[1].method,'initialized');
  const a=f.rpc.request('thread/start'),b=f.rpc.request('turn/interrupt');
  const aId=f.sent[2].id,bId=f.sent[3].id;
  f.send({id:bId,result:{stopped:true}});f.send({id:aId,result:{thread:{id:'synthetic'}}});
  assert.deepEqual(await a,{thread:{id:'synthetic'}});assert.deepEqual(await b,{stopped:true});
  const events=[];f.rpc.on('notification',x=>events.push(x));
  const bytes=Buffer.from(JSON.stringify({method:'item/agentMessage/delta',params:{delta:'合成回答'}})+'\n');
  for(const byte of bytes)f.child.stdout.write(Buffer.from([byte]));
  assert.equal(events[0].params.delta,'合成回答');
});
test('approval is suspended, explicit decline once, no auto-accept',async t=>{
 const f=fixture(t);await f.ready();const requests=[];f.rpc.on('request',x=>requests.push(x));
 f.send({id:77,method:'item/commandExecution/requestApproval',params:{threadId:'t',turnId:'u'}});
 assert.equal(requests.length,1);assert.equal(f.sent.length,2);
 f.rpc.respond(77,deniedApproval(requests[0].method));assert.deepEqual(f.sent[2],{id:77,result:{decision:'decline'}});
 assert.throws(()=>f.rpc.respond(77,{decision:'accept'}),/失效/);
 assert.deepEqual(deniedApproval('item/permissions/requestApproval'),{permissions:{},scope:'turn'});
});
test('timeouts are uncertain, never retry, late responses cannot settle a different request',async t=>{
 const f=fixture(t,{timeoutMs:20});await f.ready();const p=f.rpc.request('turn/start');const id=f.sent.at(-1).id;
 await assert.rejects(p,e=>e.uncertain===true);assert.equal(f.sent.filter(x=>x.method==='turn/start').length,1);
 const q=f.rpc.request('thread/read');f.send({id,result:{wrong:true}});f.send({id:f.sent.at(-1).id,result:{verified:true}});assert.deepEqual(await q,{verified:true});
});
test('malformed and oversized messages fail closed and reject pending work',async t=>{
 for(const input of ['not-json\n','x'.repeat(513)]){
  const f=fixture(t,{maxFrameBytes:512});await f.ready();const p=f.rpc.request('thread/read');f.child.stdout.write(input);
  await assert.rejects(p,/协议/);assert.equal(f.rpc.closed,true);
 }
});
test('disconnect rejects all pending requests without raw CLI stderr disclosure',async t=>{
 const f=fixture(t);await f.ready();f.child.stderr.write('synthetic-secret-never-display');const p=f.rpc.request('thread/read');
 f.child.exitCode=1;f.child.emit('exit',1);await assert.rejects(p,e=>!e.message.includes('synthetic-secret'));assert.equal(f.rpc.pending.size,0);
});
test('unknown server requests can be rejected without authorizing work',async t=>{
 const f=fixture(t);await f.ready();f.send({id:'unknown',method:'account/login/request',params:{}});f.rpc.rejectRequest('unknown');
 assert.equal(f.sent.at(-1).error.code,-32601);assert.equal(f.rpc.serverRequests.size,0);
});
test('reading thread explicitly disables environments and delegates approvals to user',()=>{
 const params=readingThreadParams('/synthetic-empty');assert.deepEqual(params.environments,[]);assert.deepEqual(params.dynamicTools,[]);
 assert.equal(params.sandbox,'read-only');assert.equal(params.approvalsReviewer,'user');assert.equal(params.approvalPolicy,'on-request');
 assert.equal(Object.hasOwn(params,'model'),false);assert.equal(Object.hasOwn(params,'history'),false);
});
