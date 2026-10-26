import path from 'node:path';
import {writeFile,chmod} from 'node:fs/promises';
import {codexCommand} from '../server/codex-runtime.mjs';
// Synthetic acceptance only: transparent stdio, no retries or protocol rewriting.
// Retain method/status/error categories, never prompts, answers, account values,
// raw errors/stderr, headers or credentials. Caller removes the wrapper profile.
export async function diagnosticCodexCli(profile,log){
 // Windows cannot spawn a POSIX shebang; retain the ordinary CLI test there.
 if(process.platform==='win32'){await writeFile(log,JSON.stringify({diagnostic:'unavailable-on-windows',protocolUnchanged:true})+'\n');return codexCommand();}
 const diagnosticCli=path.join(profile,'synthetic-cli-diagnostic.mjs');await writeFile(log,'');
 const wrapper=`#!${process.execPath}
import {spawn} from 'node:child_process';import {appendFileSync} from 'node:fs';
const log=${JSON.stringify(log)},child=spawn(${JSON.stringify(codexCommand())},process.argv.slice(2),{stdio:['pipe','pipe','pipe'],shell:false}),pending=new Map();
const record=x=>appendFileSync(log,JSON.stringify({at:new Date().toISOString(),process:process.pid,...x})+'\\n');
function observe(stream,direction){let buffer='';stream.setEncoding('utf8');stream.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{const m=JSON.parse(line);if(direction==='out'&&m.method&&m.id!==undefined)pending.set(m.id,m.method);record({direction,method:m.method||pending.get(m.id)||'response',kind:m.method?(m.id===undefined?'notification':'request'):'response',threadId:m.params?.threadId,turnId:m.params?.turnId||m.params?.turn?.id||m.result?.turn?.id,status:m.params?.turn?.status,errorCode:m.error?.code,errorCategory:m.error?(/timed? ?out|timeout/i.test(m.error.message||'')?'timeout':/auth|token|login/i.test(m.error.message||'')?'authentication':/network|connect|transport/i.test(m.error.message||'')?'transport':'internal'):undefined,itemType:m.params?.item?.type});}catch{record({direction,kind:'non-json'});}}});}
observe(process.stdin,'out');observe(child.stdout,'in');process.stdin.pipe(child.stdin);child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);child.on('exit',code=>{record({kind:'exit',code});process.exitCode=code||0;});child.on('error',e=>{record({kind:'spawn-error',code:e.code});process.exitCode=1;});
`;
 await writeFile(diagnosticCli,wrapper);await chmod(diagnosticCli,0o700);return diagnosticCli;
}
