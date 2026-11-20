import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { deniedApproval, readingThreadParams } from './codex-rpc.mjs';
import { readingPrompt } from './codex-reading-context.mjs';
import {READING_TOOL} from './codex-document-tool.mjs';
import { readingTurnInput } from './codex-input.mjs';

const ACTIVE = new Set(['preparing','sending','running','stopping','approval']);
const MAX_ANSWER = 100_000;
export class CodexReadingSession extends EventEmitter {
  constructor({ rpc, cwd, state, save, readPages }) {
    super(); this.readPages=readPages;this.toolWork=new Map(); this.rpc=rpc; this.cwd=cwd; this.save=save; this.state=structuredClone(state); this.bound=false; this.binding=null;
    this.cancelRequested=false; this.interrupted=new Set(); this.stopTimers=new Map(); this.operation=false; this.disposed=false;
    this.notification=message=>this.receive(message);
    this.request=message=>{
      try{this.receiveRequest(message);}
      catch{
        this.disposed=true;
        // A failed approval write cannot crash the service or silently grant it.
        try{this.rpc.rejectRequest(message.id,'Approval could not be safely saved; no permission granted.');}catch{}
        const turn=this.active();if(turn?.turnId)void this.rpc.request('turn/interrupt',{threadId:this.state.threadId,turnId:turn.turnId}).catch(()=>{});
      }
    };
    this.disconnect=()=>{const turn=this.active();if(turn){turn.status='uncertain';turn.error='Codex 连接中断；请核对本会话，不能自动重发。';turn.approvals=[];try{this.persist();}catch{this.disposed=true;}}this.bound=false;};
    rpc.on('notification',this.notification);rpc.on('request',this.request);rpc.on('disconnect',this.disconnect);
  }
  view(){return structuredClone(this.state);}
  active(){return this.state.turns.findLast(turn=>ACTIVE.has(turn.status));}
  persist(){
    try{this.save(structuredClone(this.state));this.emit('change',this.view());}
    catch{this.disposed=true;this.emit('storageFailure',new Error('会话保存失败，请保留窗口并停止当前回答。'));throw new Error('会话保存失败，未自动重发。');}
  }
  assertSnapshot(snapshot){
    const b=this.state.binding;
    if(!snapshot||snapshot.libraryId!==b.libraryId||snapshot.documentId!==b.documentId||snapshot.pdfSha256!==b.pdfSha256)throw new Error('阅读快照与当前会话不匹配。');
  }
  async bind(){
    if(this.bound)return;
    if(this.binding)return this.binding;
    this.binding=(async()=>{
      await this.rpc.start();
      const params={...readingThreadParams(this.cwd),dynamicTools:[READING_TOOL]};
      const response=this.state.threadId
        ?await this.rpc.request('thread/resume',{threadId:this.state.threadId,cwd:this.cwd,sandbox:params.sandbox,approvalPolicy:params.approvalPolicy,approvalsReviewer:params.approvalsReviewer,developerInstructions:params.developerInstructions,excludeTurns:true})
        :await this.rpc.request('thread/start',params);
      if(!response?.thread?.id||this.state.threadId&&response.thread.id!==this.state.threadId)throw new Error('Codex 返回了不匹配的会话身份。');
      if(response.sandbox?.type!=='readOnly'||response.approvalsReviewer!=='user')throw new Error('Codex 未确认所需只读权限；没有发送问题。');
      if(!this.state.threadId)this.state.readingToolVersion=1;this.state.threadId=response.thread.id;this.persist();
      await this.rpc.verifyReadingThread?.(response.thread.id);this.bound=true;
    })();
    try{await this.binding;}finally{this.binding=null;}
  }
  async send({requestId,question,snapshot,previewId,beforeDispatch,modelSelection}){
    if(this.disposed)throw new Error('会话不可用，请先恢复本机存储。');
    this.assertSnapshot(snapshot);
    if(typeof requestId!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(requestId))throw new Error('缺少有效发送标识。');
    const prompt=readingPrompt(question,snapshot),fingerprint=createHash('sha256').update(modelSelection?JSON.stringify({prompt,modelSelection}):prompt).digest('hex');
    const existing=this.state.turns.find(t=>t.requestId===requestId);
    if(existing){if(existing.fingerprint!==fingerprint)throw new Error('同一请求不能携带不同内容。');return this.view();}
    if(this.operation||this.active()||this.state.turns.some(t=>t.status==='uncertain'))throw new Error('请先等待或核对上一轮回答。');
    if(this.state.turns.length>=100)throw new Error('本会话已达 100 轮，请另开会话；原记录保留。');
    this.operation=true;this.cancelRequested=false;
    const turn={requestId,...(previewId?{previewId}:{}),fingerprint,question,snapshot:structuredClone(snapshot),...(modelSelection?{modelSelection}:{}),status:'preparing',turnId:null,items:[],approvals:[],toolReads:[],createdAt:new Date().toISOString()};
    this.state.turns.push(turn);
    let dispatched=false;
    try{
      this.persist();await this.bind();
      if(this.cancelRequested){turn.status='interrupted';this.persist();return this.view();}
      await beforeDispatch?.();
      if(this.cancelRequested){turn.status='interrupted';this.persist();return this.view();}
      turn.status='sending';this.persist();dispatched=true;
      const response=await this.rpc.request('turn/start',{threadId:this.state.threadId,...(modelSelection?{model:modelSelection.model,effort:modelSelection.effort}:{}),...readingTurnInput(question,snapshot,requestId),environments:[],approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:{type:'readOnly',networkAccess:false}});
      if(!response?.turn?.id)throw new Error('Codex 未返回轮次身份。');
      if(turn.turnId&&turn.turnId!==response.turn.id)throw new Error('Codex 返回了不匹配的轮次身份。');
      turn.turnId=response.turn.id;
      // Notifications may have completed before the turn/start response.
      if(ACTIVE.has(turn.status))turn.status=this.cancelRequested?'stopping':'running';
      this.persist();if(this.cancelRequested&&ACTIVE.has(turn.status))await this.interrupt(turn);
      return this.view();
    }catch(error){turn.status=dispatched?'uncertain':'failed';turn.error=error.message;this.persist();throw error;}
    finally{this.operation=false;}
  }
  receive({method,params:p}){
    if(this.disposed||!p||p.threadId!==this.state.threadId)return;
    const turn=this.active();if(!turn)return;
    const id=p.turnId||p.turn?.id;
    if(!id||turn.turnId&&id!==turn.turnId)return;
    if(!turn.turnId){if(!['sending','stopping'].includes(turn.status))return;turn.turnId=id;}
    try{
      if(method==='turn/started'){
        turn.started=true;if(this.cancelRequested)void this.interrupt(turn).catch(()=>{});
      }else if(method==='item/agentMessage/delta'){
        turn.started=true;
        if(typeof p.delta!=='string'||typeof p.itemId!=='string')return;
        let item=turn.items.find(i=>i.id===p.itemId);
        if(!item){if(turn.items.length>=100)throw new Error('回答条目过多。');item={id:p.itemId,text:''};turn.items.push(item);}
        const total=turn.items.reduce((n,i)=>n+i.text.length,0);
        item.text+=p.delta.slice(0,Math.max(0,MAX_ANSWER-total));
        if(total+p.delta.length>MAX_ANSWER){turn.error='回答达到本机容量上限，已请求停止。';void this.stop().catch(()=>{});}
      }else if(method==='item/completed'&&p.item?.type==='agentMessage'){
        const text=typeof p.item.text==='string'?p.item.text:'';
        let item=turn.items.find(i=>i.id===p.item.id);
        if(!item){if(turn.items.length>=100)throw new Error('回答条目过多。');item={id:p.item.id,text:''};turn.items.push(item);}
        const other=turn.items.filter(i=>i!==item).reduce((n,i)=>n+i.text.length,0);item.text=text.slice(0,Math.max(0,MAX_ANSWER-other));
      }else if(method==='turn/completed'){
        clearTimeout(this.stopTimers.get(turn.requestId));this.stopTimers.delete(turn.requestId);
        turn.status=['completed','interrupted','failed'].includes(p.turn.status)?p.turn.status:'uncertain';turn.approvals=[];
        if(p.turn.error)turn.error='Codex 未完成这一轮；输入和已收到内容保留。';
      }else if(method==='error'){
        turn.error='Codex 报告错误；请核对连接或本轮状态。';if(!p.willRetry)turn.status='failed';
      }else return;
      this.persist();
    }catch{this.disposed=true;void this.rpc.request('turn/interrupt',{threadId:this.state.threadId,turnId:turn.turnId}).catch(()=>{});}
  }
  receiveRequest(message){
    const p=message.params,turn=this.active();
    if(p?.threadId!==this.state.threadId)return;
    if(!turn||!p.turnId||turn.turnId&&p.turnId!==turn.turnId){this.rpc.rejectRequest(message.id,'Request is outside this XiReader conversation.');return;}
    if(!turn.turnId)turn.turnId=p.turnId;
    if(message.method==='item/tool/call'){turn.started=true;void this.handleReadingTool(message,turn);return;}
    const denial=deniedApproval(message.method);
    if(!denial){this.rpc.rejectRequest(message.id);turn.error='Codex 请求了当前只读聊天未支持的操作；未授予权限。';this.persist();return;}
    turn.approvals.push({id:message.id,method:message.method,description:'此请求需要额外权限。XiReader 阅读聊天不授予命令、写入或外部访问权限；可拒绝并继续，或停止回答。'});
    turn.status='approval';this.persist();
  }
  async handleReadingTool(message,turn){
    const p=message.params,key=`${turn.requestId}:${p.callId}`;
    const respond=result=>{try{this.rpc.respond(message.id,result);}catch{}};
    const failure=text=>({success:false,contentItems:[{type:'inputText',text}]});
    if(p.tool!=='xireader_read_pages'||typeof p.callId!=='string'||p.callId.length>200){respond(failure('不支持的工具；未读取资料。'));return;}
    const signature=JSON.stringify(p.arguments),existing=(turn.toolReads||[]).find(t=>t.id===p.callId);
    if(existing&&existing.signature!==signature){respond(failure('同一工具调用不能改变页码。'));return;}
    if(this.toolWork.has(key)){respond(await this.toolWork.get(key));return;}
    if(existing){respond(existing.status==='completed'?{success:true,contentItems:[{type:'inputText',text:JSON.stringify(existing.output)}]}:failure(existing.error||'上次补读结果未确认，不自动重读。'));return;}
    turn.toolReads??=[];
    if(turn.toolReads.length>=12){respond(failure('本轮工具请求过多，未读取资料。'));return;}
    const record={id:p.callId,name:p.tool,signature,pages:Array.isArray(p.arguments?.pages)?p.arguments.pages.filter(Number.isInteger).slice(0,3):[],status:'running',output:null};turn.toolReads.push(record);
    const work=(async()=>{
      try{
        if(this.disposed||this.cancelRequested||!ACTIVE.has(turn.status))throw new Error('本轮已停止，未补读。');
        if(!turn.snapshot.included||turn.snapshot.allowDocumentRead!==true){record.status='denied';throw new Error('用户没有允许本轮补读文献；请在后续消息明确勾选允许后再请求。');}
        if(turn.toolReads.filter(t=>t.status==='completed'||t.status==='running').length>4)throw new Error('本轮最多补读 4 次，未继续读取。');
        this.persist();if(!this.readPages)throw new Error('当前运行环境没有可用的本篇文献读取接口。');
        const output=await this.readPages(p.arguments,this.state.binding);
        if(this.cancelRequested||!ACTIVE.has(turn.status)||this.disposed)throw new Error('补读期间本轮已停止；结果未发送给模型。');
        record.output=output;record.status='completed';this.persist();return{success:true,contentItems:[{type:'inputText',text:JSON.stringify(output)}]};
      }catch(error){record.status=record.status==='denied'?'denied':'failed';record.error=error.message;try{this.persist();}catch{}return failure(record.error);}
    })();this.toolWork.set(key,work);respond(await work);
  }
  deny(id){
    const turn=this.active(),approval=turn?.approvals.find(a=>a.id===id);
    if(!approval)throw new Error('审批已失效。');
    this.rpc.respond(id,deniedApproval(approval.method));turn.approvals=turn.approvals.filter(a=>a.id!==id);turn.status=turn.approvals.length?'approval':'running';this.persist();
  }
  async interrupt(turn){
    if(!turn.turnId||this.interrupted.has(turn.turnId))return;
    if(!turn.started){
      if(!this.stopTimers.has(turn.requestId)){const timer=setTimeout(()=>{this.stopTimers.delete(turn.requestId);if(ACTIVE.has(turn.status)){turn.status='uncertain';turn.error='尚未确认轮次开始，停止结果需核对；没有重发问题。';try{this.persist();}catch{}}},10000);timer.unref?.();this.stopTimers.set(turn.requestId,timer);}
      return;
    }
    clearTimeout(this.stopTimers.get(turn.requestId));this.stopTimers.delete(turn.requestId);
    this.interrupted.add(turn.turnId);
    try{await this.rpc.request('turn/interrupt',{threadId:this.state.threadId,turnId:turn.turnId});}
    catch(error){
      this.interrupted.delete(turn.turnId);
      // Completion can win the race after the user clicks Stop. Confirm via the
      // public owned-thread endpoint instead of overwriting a completed result.
      try{const result=await this.rpc.request('thread/read',{threadId:this.state.threadId,includeTurns:true});const remote=result.thread?.id===this.state.threadId&&result.thread.turns?.find(t=>t.id===turn.turnId);if(remote&&['completed','interrupted','failed'].includes(remote.status)){turn.status=remote.status;turn.approvals=[];this.persist();return;}}catch{}
      turn.status='uncertain';turn.error='停止结果尚未确认，请核对当前会话。';this.persist();throw error;
    }
  }
  async stop(){
    const turn=this.active();if(!turn)return this.view();
    this.cancelRequested=true;
    for(const approval of [...turn.approvals])this.deny(approval.id);
    turn.status='stopping';this.persist();await this.interrupt(turn);return this.view();
  }
  async recover(){
    if(this.active()||this.operation)throw new Error('当前回答仍在进行。');
    if(!this.state.threadId)return this.view();
    await this.bind();
    const result=await this.rpc.request('thread/read',{threadId:this.state.threadId,includeTurns:true});
    if(result.thread?.id!==this.state.threadId)throw new Error('恢复的会话身份不匹配。');
    for(const turn of this.state.turns.filter(t=>t.status==='uncertain')){
      // No position-based inference: an unacknowledged send must remain uncertain.
      const remote=turn.turnId&&result.thread.turns?.find(t=>t.id===turn.turnId);
      if(!remote)continue;
      let remaining=MAX_ANSWER;
      turn.items=(remote.items||[]).filter(i=>i.type==='agentMessage').slice(0,100).map(i=>{const text=(typeof i.text==='string'?i.text:'').slice(0,remaining);remaining-=text.length;return{id:i.id,text};});
      if(remote.status==='inProgress'){turn.status='running';turn.started=true;}
      if(['completed','interrupted','failed'].includes(remote.status)){turn.status=remote.status;turn.approvals=[];delete turn.error;}
    }
    this.persist();return this.view();
  }
  dispose(){for(const timer of this.stopTimers.values())clearTimeout(timer);this.stopTimers.clear();this.disposed=true;this.rpc.off('notification',this.notification);this.rpc.off('request',this.request);this.rpc.off('disconnect',this.disconnect);}
}
