// Public app-server metadata only. Never expose account email, routing or tokens.
export async function queryReadingCapabilities(rpc){
 await rpc.start();
 const account=await rpc.request('account/read',{refreshToken:false});
 if(account.requiresOpenaiAuth===true&&!account.account)return{state:'auth-required',message:'Codex CLI 尚未登录。请在终端完成已有 Codex 的正常登录，再点击重新检查；XiReader 不收集凭据。',models:[]};
 const models=[];let cursor;const seen=new Set();
 for(let page=0;page<5;page++){
  const result=await rpc.request('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})});
  if(!Array.isArray(result.data))throw new Error('Codex 没有返回可核验的模型列表。');
  for(const m of result.data){if(m.hidden||typeof m.model!=='string'||!m.model||m.model.length>200||seen.has(m.model))continue;
   const efforts=(m.supportedReasoningEfforts||[]).map(e=>e.reasoningEffort).filter(e=>typeof e==='string'&&e.length>0&&e.length<50);
   seen.add(m.model);models.push({id:m.model,name:typeof m.displayName==='string'?m.displayName.slice(0,200):m.model,isDefault:m.isDefault===true,efforts:[...new Set(efforts)],defaultEffort:efforts.includes(m.defaultReasoningEffort)?m.defaultReasoningEffort:null});
  }
  cursor=result.nextCursor;if(!cursor)break;if(page===4)throw new Error('模型列表超过核验上限，请检查 CLI 版本。');
 }
 if(!models.length)throw new Error('Codex 没有可用模型，请核对当前账户与 CLI。');
 return{state:'ready',message:'CLI 已连接，已有认证与模型列表可用；实际模型请求仍可能受到额度或网络限制。',models};
}
export function validateModelSelection(selection,capabilities){
 if(!selection||typeof selection!=='object'||Array.isArray(selection)||Object.keys(selection).some(k=>!['model','effort'].includes(k)))throw new Error('模型选择格式无效。');
 if(capabilities.state!=='ready')throw new Error(capabilities.message||'请先连接 Codex。');
 const model=capabilities.models.find(m=>m.id===selection.model);if(!model)throw new Error('所选模型不在当前 Codex 能力列表中，请重新检查。');
 if(selection.effort!==null&&selection.effort!==undefined&&!model.efforts.includes(selection.effort))throw new Error('该模型不支持所选推理强度，请重新选择。');
 return{model:model.id,effort:selection.effort??model.defaultEffort??null};
}
export const connectionFailure=error=>({state:error.code==='ENOENT'?'cli-missing':'error',message:error.code==='ENOENT'?'未找到 Codex CLI。请检查已有安装或 PAPERDESK_CODEX_CLI 路径，然后重新检查。':`连接检查失败：${error.message} 请检查现有 CLI、认证与网络后重试；不会自动重新发送问题。`,models:[]});
