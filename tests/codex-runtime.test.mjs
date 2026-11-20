import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReadingRuntime,READING_CLI_OVERRIDES} from '../server/codex-runtime.mjs';
import {readingTurnInput} from '../server/codex-input.mjs';
async function fixture(t,finalStatus='disabled'){
 const cwd=await mkdtemp(path.join(tmpdir(),'paperdesk-codex-runtime-'));t.after(()=>rm(cwd,{recursive:true,force:true}));const launched=[];
 const makeRpc=options=>{const rpc=new EventEmitter(),index=launched.length;launched.push({options,rpc});rpc.start=async()=>{};rpc.close=async()=>{rpc.closed=true;};rpc.rejectRequest=()=>{};
 rpc.request=async method=>method==='thread/start'?{thread:{id:'synthetic-probe'}}:{data:[{name:'synthetic_tools',runtimeStatus:index?finalStatus:'connected',tools:index?{}:{read:{name:'read'}} ,resources:[],resourceTemplates:[]}],nextCursor:null};return rpc;};
 return{cwd,makeRpc,launched};
}
test('inherited MCP names are disabled only in final child, then runtime state is checked',async t=>{
 const f=await fixture(t),rpc=await createReadingRuntime(f);assert.equal(f.launched.length,2);assert.equal(f.launched[0].rpc.closed,true);assert.ok(f.launched[1].options.args.includes('mcp_servers.synthetic_tools.enabled=false'));await rpc.verifyReadingThread('owned');await rpc.close();
 for(const name of ['features.plugins=false','features.apps=false','features.shell_tool=false','project_doc_max_bytes=0'])assert.ok(READING_CLI_OVERRIDES.includes(name));
});
test('connected or ambiguous inherited tools fail closed',async t=>{
 for(const status of ['connected',null,'starting']){const f=await fixture(t,status),rpc=await createReadingRuntime(f);await assert.rejects(rpc.verifyReadingThread('owned'),/未发送问题/);await rpc.close();}
});
test('untrusted reading context splits only at UTF-8 boundaries and is not a system instruction',()=>{
 const snapshot={included:true,text:'科研🧪'.repeat(1500)},p=readingTurnInput('Question',snapshot,'synthetic');const chunks=Object.values(p.additionalContext);
 assert.ok(chunks.length>1&&chunks.length<=8);assert.ok(chunks.every(c=>c.kind==='untrusted'&&Buffer.byteLength(c.value)<=2800));assert.equal(chunks.map(c=>c.value).join(''),JSON.stringify(snapshot));assert.equal(p.input[0].text,'Question');assert.throws(()=>readingTurnInput('q',{included:true,text:'x'.repeat(25000)},'synthetic'),/22400/);
});
