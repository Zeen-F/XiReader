const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const pattern=new RegExp(`xireader-message://([0-9a-f]{64})/(${UUID})/(${UUID})/(${UUID})`,'gi');
export function codexMessageSources(text){return [...String(text||'').matchAll(pattern)].map(m=>({libraryId:m[1],documentId:m[2],sessionId:m[3],requestId:m[4],url:m[0]})).filter((value,index,list)=>list.findIndex(item=>item.url===value.url)===index);}
export function codexMessageSource(value){const url=`xireader-message://${value.libraryId}/${value.documentId}/${value.sessionId}/${value.requestId}`;if(codexMessageSources(url)[0]?.url!==url)throw new Error('Invalid Codex message source');return url;}
