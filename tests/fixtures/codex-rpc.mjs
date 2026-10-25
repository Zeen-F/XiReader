import {EventEmitter} from 'node:events';
export function mockCodex(){
 const rpc=new EventEmitter(),calls=[];let threads=0,turns=0;const history=new Map();rpc.start=async()=>{};rpc.close=async()=>{rpc.emit('disconnect');};rpc.verifyReadingThread=async()=>{};
 rpc.request=async(method,params)=>{calls.push({method,params});
  if(method==='thread/start'||method==='thread/resume')return{thread:{id:params.threadId||`thread-${++threads}`},sandbox:{type:'readOnly'},approvalsReviewer:'user'};
  if(method==='turn/start'){const turn={id:`turn-${++turns}`,status:'inProgress',items:[]};history.set(params.threadId,[...(history.get(params.threadId)||[]),turn]);queueMicrotask(()=>rpc.emit('notification',{method:'turn/started',params:{threadId:params.threadId,turn}}));return{turn};}
  if(method==='turn/interrupt'){const turn=history.get(params.threadId)?.find(t=>t.id===params.turnId);if(turn){turn.status='interrupted';rpc.emit('notification',{method:'turn/completed',params:{threadId:params.threadId,turn}});}return{};}
  if(method==='thread/read')return{thread:{id:params.threadId,turns:history.get(params.threadId)||[]}};return{};
 };
 rpc.respond=(id,result)=>calls.push({id,result});rpc.rejectRequest=id=>calls.push({id,rejected:true});
 const finish=(threadId,text='Synthetic streamed answer')=>{const turn=history.get(threadId).at(-1);turn.status='completed';turn.items=[{type:'agentMessage',id:'a',text}];rpc.emit('notification',{method:'item/agentMessage/delta',params:{threadId,turnId:turn.id,itemId:'a',delta:text}});rpc.emit('notification',{method:'turn/completed',params:{threadId,turn}});};
 return{rpc,calls,finish};
}
