import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReadingSnapshot,readingPrompt } from '../server/codex-reading-context.mjs';
const doc={id:'synthetic-pdf',sha256:'synthetic-hash',page_count:9,title:'Synthetic reading test'};
function fixture(){
 const calls=[],request={libraryId:'synthetic-library',documentId:doc.id,pdfSha256:doc.sha256,capturedAt:1000,page:1,visible:[{page:1,rect:{x:0,y:.2,width:1,height:.4}}],selection:{documentId:doc.id,page:1,kind:'text',quote:'Bounded evidence.'},includeContext:true,mode:'follow'};
 const options={request,libraryId:'synthetic-library',document:doc,now:1000,verifyDocument:async()=>{calls.push('verify');},readPage:async n=>{calls.push(n);return n===2?'':'Bounded evidence. '+ 'x'.repeat(4100);},readAnnotation:async id=>id==='a'?{id,document_id:doc.id,page:3,kind:'text',quote:'Original quote',comment:'User interpretation'}:null};
 return{request,options,calls,run:()=>buildReadingSnapshot(options)};
}
test('frozen snapshot is bounded, PDF verified, rectangle distinguished from page text',async()=>{
 const f=fixture(),snapshot=await f.run();assert.equal(f.calls[0],'verify');assert.equal(snapshot.pages[0].text.length,4000);assert.equal(snapshot.pages[0].truncated,true);
 f.request.selection.quote='changed';f.request.visible[0].rect.y=.8;assert.equal(snapshot.selection.quote,'Bounded evidence.');assert.equal(snapshot.visible[0].rect.y,.2);
 assert.match(snapshot.limitations.join(' '),/不等于矩形/);assert.equal(snapshot.digest.length,64);assert.equal(JSON.parse(readingPrompt('Explain here',snapshot)).readingSnapshot.digest,snapshot.digest);
});
test('wrong PDF, wrong library, stale snapshot and foreign selection fail before model use',async()=>{
 for(const patch of [{libraryId:'other'},{pdfSha256:'other'},{capturedAt:-20000},{selection:{documentId:'other',kind:'text',page:1,quote:'x'}}]){
 const f=fixture();Object.assign(f.request,patch);await assert.rejects(f.run(),e=>e.status===409);}
});
test('unchecked or fabricated selection cannot be represented as PDF evidence',async()=>{
 const f=fixture();f.request.selection.quote='Not in the PDF';await assert.rejects(f.run(),/不一致/);
 f.request.selection.quote='x'.repeat(4001);await assert.rejects(f.run(),/4000/);
});
test('context excluded means no page or annotation content is read',async()=>{
 const f=fixture();f.request.includeContext=false;const s=await f.run();assert.deepEqual(f.calls,['verify']);assert.deepEqual(s.pages,[]);assert.equal(s.selection,null);assert.equal(s.annotation,null);assert.deepEqual(JSON.parse(readingPrompt('No reading context',s)).readingSnapshot,{included:false});
});
test('fixed annotation uses its own page while follow mode stays explicit',async()=>{
 const f=fixture();f.request.mode='annotation';f.request.annotationId='a';const s=await f.run();assert.equal(s.page,3);assert.equal(s.selection,null);assert.deepEqual(s.visible,[]);assert.deepEqual(s.pages.map(p=>p.page),[3]);assert.equal(s.annotation.comment,'User interpretation');
 f.request.annotationId='missing';await assert.rejects(f.run(),e=>e.status===409);
});
test('scanned/region pages expose missing text and never imply OCR or image transmission',async()=>{
 const f=fixture();f.request.page=2;f.request.visible=[];f.request.selection={documentId:doc.id,page:2,kind:'region'};const s=await f.run();assert.equal(s.pages[0].textAvailable,false);assert.equal(s.selection.ocr,false);assert.match(s.limitations.join(' '),/没有执行 OCR/);
});
test('page count, rectangle boundaries and unknown fields are rejected',async()=>{
 for(const patch of [{page:99},{visible:[{page:1,rect:{x:.9,y:0,width:.5,height:1}}]},{path:'/private/file'},{visible:[1,2,3,4].map(page=>({page,rect:{x:0,y:0,width:1,height:1}}))}]){
  const f=fixture();Object.assign(f.request,patch);await assert.rejects(f.run(),e=>e.status===400);
 }
});
test('actual PDF verification failure propagates, no index text is read',async()=>{
 const f=fixture();f.options.verifyDocument=async()=>{throw new Error('PDF changed');};await assert.rejects(f.run(),/PDF changed/);assert.deepEqual(f.calls,[]);
});
