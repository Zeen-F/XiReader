// Original implementation against the installed app-server schema. Context is
// explicitly untrusted; application instructions never contain PDF text.
export function readingTurnInput(question,snapshot,requestId){
 const value=JSON.stringify(snapshot.included===false?{included:false}:snapshot);
 const chunks=[];let chunk='',bytes=0;
 for(const character of value){const size=Buffer.byteLength(character);if(bytes+size>2800){chunks.push(chunk);chunk='';bytes=0;}chunk+=character;bytes+=size;}
 if(chunk)chunks.push(chunk);
 if(chunks.length>8)throw new Error('阅读快照超过 22400 字节，请缩小参考范围。');
 return{input:[{type:'text',text:question}],additionalContext:Object.fromEntries(chunks.map((value,index)=>[`xireader-${requestId}-${index}`,{kind:'untrusted',value}]))};
}
