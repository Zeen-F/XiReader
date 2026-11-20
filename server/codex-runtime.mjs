import { existsSync, mkdirSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { CodexRpc, readingThreadParams } from './codex-rpc.mjs';

// These overrides affect only the dedicated child process, not user settings.
// An empty mcp_servers table does NOT clear inherited entries in Codex's merged
// configuration. Discover names via the public status API without exposing any
// credentials, disable each name in the final process, then verify again.
export const READING_CLI_OVERRIDES = [
 'features.plugins=false','features.remote_plugin=false','features.apps=false','features.hooks=false','features.memories=false',
 'features.shell_tool=false','features.unified_exec=false','features.multi_agent=false','features.multi_agent_v2=false',
 'features.browser_use=false','features.browser_use_external=false','features.code_mode=false','features.code_mode_only=false',
 'features.skill_mcp_dependency_install=false','features.skill_env_var_dependency_prompt=false',
 'orchestrator.mcp.enabled=false','cloud.skills.enabled=false','web_search="disabled"',
 'project_doc_max_bytes=0','developer_instructions=""','shell_environment_policy.inherit="none"',
];
export function codexCommand(environment=process.env){
 // Explicit user environment configuration is a path, never a shell fragment.
 if(environment.PAPERDESK_CODEX_CLI)return environment.PAPERDESK_CODEX_CLI;
 if(process.platform==='darwin')for(const candidate of ['/opt/homebrew/bin/codex','/usr/local/bin/codex'])if(existsSync(candidate))return candidate;
 return process.platform==='win32'?'codex.exe':'codex';
}
const args=overrides=>['app-server','--listen','stdio://',...overrides.flatMap(value=>['-c',value])];
async function inventory(rpc,threadId){
 const servers=[];let cursor;
 for(let page=0;page<20;page++){
  const result=await rpc.request('mcpServerStatus/list',{threadId,detail:'toolsAndAuthOnly',limit:100,...(cursor?{cursor}:{})});
  if(!Array.isArray(result.data))throw new Error('Codex 无法核验继承工具清单；未发送问题。');
  servers.push(...result.data);cursor=result.nextCursor;
  if(!cursor)return servers;
 }
 throw new Error('Codex 工具清单超过核验上限；未发送问题。');
}
export async function createReadingRuntime({cwd,command=codexCommand(),env=process.env,makeRpc=options=>new CodexRpc(options)}={}){
 mkdirSync(cwd,{recursive:true,mode:0o700});const stat=lstatSync(cwd);
 if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Codex 阅读工作目录必须是独立普通目录。');
 if(path.isAbsolute(command))env={...env,PATH:[path.dirname(command),env.PATH||''].filter(Boolean).join(path.delimiter)};
 let rpc=makeRpc({command,cwd,env,args:args(READING_CLI_OVERRIDES)});
 const reject=message=>rpc.rejectRequest(message.id,'Capability discovery does not authorize any action.');rpc.on('request',reject);
 try{
  await rpc.start();
  const probe=await rpc.request('thread/start',{...readingThreadParams(cwd),ephemeral:true});
  if(!probe.thread?.id)throw new Error('Codex 工具核验未返回线程。');
  const servers=await inventory(rpc,probe.thread.id);
  const names=[...new Set(servers.map(s=>s.name))];
  if(names.some(name=>typeof name!=='string'||!/^[A-Za-z0-9_-]+$/.test(name)))throw new Error('Codex 存在无法安全隔离的工具名称；未发送问题。');
  await rpc.close();rpc.off('request',reject);
  const overrides=[...READING_CLI_OVERRIDES,...names.map(name=>`mcp_servers.${name}.enabled=false`)];
  rpc=makeRpc({command,cwd,env,args:args(overrides)});
  await rpc.start();
  // Each owned conversation is checked before its first model turn, including
  // resumed threads. A nonempty catalog fails closed, never requests wider access.
  rpc.verifyReadingThread=async threadId=>{
   const found=await inventory(rpc,threadId);
   if(found.some(server=>server.runtimeStatus!=='disabled'||Object.keys(server.tools||{}).length||(server.resources||[]).length||(server.resourceTemplates||[]).length)) {
    const error=new Error('Codex 仍暴露继承工具或状态不明；未发送问题。');
    error.capabilityStates=found.map(s=>({status:s.runtimeStatus,tools:Object.keys(s.tools||{}).length}));throw error;
   }
  };
  rpc.readingCapabilitySummary={inheritedServersDisabled:names.length,environments:0,tools:'checked-per-thread'};
  return rpc;
 }catch(error){await rpc.close().catch(()=>{});throw error;}
}
