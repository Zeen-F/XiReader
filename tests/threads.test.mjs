import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.mjs';

const sample = await readFile(new URL('../public/examples/reading-demo.pdf',import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(t,vault=false) {
  const root = await mkdtemp(path.join(tmpdir(),'paperdesk-discussions-')),dataDir=path.join(root,'cache'),vaultDir=vault?path.join(root,'vault'):undefined;
  let runtime,server,libraryId;
  const start=async()=>{
    runtime=createApp({dataDir,vaultDir}); await runtime.ready;
    server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');
    libraryId=(await json('/plugin/status')).libraryId;
  };
  const stop=async()=>{ server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));if(runtime)await runtime.close();runtime=server=null; };
  t.after(async()=>{try{await stop();}finally{await rm(root,{recursive:true,force:true});}});
  const request=(route,method='GET',body,headers={})=>fetch(`http://127.0.0.1:${server.address().port}/api${route}`,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const json=async(route,method='GET',body,status=200)=>{const res=await request(route,method,body);assert.equal(res.status,status,await res.clone().text());return res.json();};
  if(vault)await mkdir(path.join(vaultDir,'.obsidian'),{recursive:true});await start();
  const upload=async(extra='')=>{const form=new FormData();form.append('file',new Blob([sample,extra]),'synthetic.pdf');const res=await fetch(`http://127.0.0.1:${server.address().port}/api/documents`,{method:'POST',body:form});assert.equal(res.status,201,await res.clone().text());return(await res.json()).document;};
  const annotate=async(doc,{kind='text',page=1}={})=>(await json(`/documents/${doc.id}/annotations`,'POST',{page,kind,quote:kind==='text'?'A bounded synthetic quotation.':'',comment:'original comment',color:'yellow',rects:[{x:.1,y:.2,width:.3,height:.04}],requestId:randomUUID()},201)).annotation;
  const binding=doc=>({libraryId,pdfSha256:doc.pdfSha256});
  const route=doc=>`/documents/${doc.id}/threads`;
  const read=route=>json(`${route}?libraryId=${libraryId}`);
  const create=async(doc,annotation,requestId=randomUUID())=>(await json(route(doc),'POST',{...binding(doc),annotationId:annotation.id,requestId},201)).thread;
  const preview=async(doc,thread,scope='selection',pages)=>(await json(`${route(doc)}/${thread.id}/context`,'POST',{...binding(doc),scope,...(pages?{pages}:{})})).context;
  const question=async(doc,thread,scope='selection',pages)=>{const context=await preview(doc,thread,scope,pages);return{...binding(doc),expectedRevision:thread.revision,requestId:randomUUID(),role:'user',content:'Explain this synthetic evidence.',scope,...(pages?{pages}:{}),contextDigest:context.digest};};
  const sqlite=(work,name='discussions.sqlite')=>{const db=new DatabaseSync(path.join(dataDir,name));try{return work(db);}finally{db.close();}};
  return {root,dataDir,vaultDir,request,json,upload,annotate,binding,route,read,create,preview,question,sqlite,start,stop,
    get libraryId(){return libraryId;},pdfPath:id=>path.join(vault?vaultDir:dataDir,vault?'Paperdesk/PDFs':'pdfs',`${id}.pdf`),
    notePath:id=>path.join(vaultDir,'Paperdesk','Notes',`${id}.md`),sidecar:id=>path.join(vaultDir,'Paperdesk','Discussions',`${id}.json`)};
}

for (const vault of [false,true]) {
  const mode=vault?'vault':'standalone';
  test(`${mode} discussions freeze source/context, manually save answers, replay exactly and survive restart without changing notes/PDF`,async t=>{
    const h=await fixture(t,vault),doc=await h.upload(),annotation=await h.annotate(doc);
    const original=(await h.json(`/documents/${doc.id}`)).document,note=vault?await readFile(h.notePath(doc.id)):null;
    const thread=await h.create(doc,annotation),url=`${h.route(doc)}/${thread.id}`;
    assert.equal(thread.sourceStatus,'verified');assert.equal(thread.revision,0);assert.equal(thread.libraryId,h.libraryId);
    assert.equal((await h.create(doc,annotation)).id,thread.id,'Opening an annotation reuses its thread');
    const selected=await h.preview(doc,thread);assert.deepEqual(selected.pages,[{page:1,text:annotation.quote}]);assert.equal(selected.characterCount,annotation.quote.length);
    const adjacent=await h.preview(doc,thread,'adjacent');assert.deepEqual(adjacent.pages.map(row=>row.page),[1,2]);assert.notEqual(adjacent.digest,selected.digest);
    const custom=await h.preview(doc,thread,'custom',[2,1]);assert.deepEqual(custom.pages.map(row=>row.page),[1,2]);
    const body=await h.question(doc,thread),first=await h.json(`${url}/messages`,'POST',body,201);
    assert.equal(first.message.status,'saved');assert.equal(first.message.provenance,'user');assert.deepEqual(first.message.context,selected);
    const replay=await h.json(`${url}/messages`,'POST',body);assert.equal(replay.replayed,true);assert.equal(replay.message.id,first.message.id);assert.equal(replay.thread.revision,1);
    await h.json(`${url}/messages`,'POST',{...body,content:'Different content with same requestId'},409);
    await h.json(`${url}/messages`,'POST',{...body,requestId:randomUUID()},409);
    const answer={...h.binding(doc),expectedRevision:1,requestId:randomUUID(),role:'assistant',content:'I reviewed this answer myself.',reviewed:true};
    const saved=await h.json(`${url}/messages`,'POST',answer,201);assert.equal(saved.message.provenance,'manual-answer');assert.equal(saved.message.context,null);
    assert.equal(saved.thread.revision,2);assert.equal(saved.thread.messageCount,2);
    assert.deepEqual((await h.json(`/documents/${doc.id}`)).document,original);assert.deepEqual(await readFile(h.pdfPath(doc.id)),sample);
    if(vault){assert.deepEqual(await readFile(h.notePath(doc.id)),note);assert.equal(JSON.parse(await readFile(h.sidecar(doc.id),'utf8')).schemaVersion,1);}
    await h.stop();await h.start();assert.deepEqual((await h.read(url)).thread,saved.thread);
    assert.equal((await h.json(`${url}/messages`,'POST',answer)).message.id,saved.message.id);
    assert.equal((await h.read(h.route(doc))).threads.length,1);
    assert.equal(h.sqlite(db=>db.prepare('PRAGMA user_version').get().user_version,'paperdesk.sqlite'),5,'Main schema stays unchanged');
  });

  test(`${mode} discussion requests reject stale sources, foreign libraries/documents, unreviewed answers and stale context before saving`,async t=>{
    const h=await fixture(t,vault),doc=await h.upload(),other=await h.upload('\n% other\n'),a=await h.annotate(doc),foreign=await h.annotate(other),thread=await h.create(doc,a),url=`${h.route(doc)}/${thread.id}`;
    await h.json(h.route(doc),'POST',{...h.binding(doc),annotationId:foreign.id,requestId:randomUUID()},404);
    await h.json(h.route(doc),'POST',{...h.binding(doc),pdfSha256:'0'.repeat(64),annotationId:a.id,requestId:randomUUID()},409);
    await h.json(h.route(doc),'POST',{...h.binding(doc),libraryId:'f'.repeat(64),annotationId:a.id,requestId:randomUUID()},409);
    await h.json(h.route(doc),'GET',undefined,400);
    await h.json(`${h.route(doc)}?libraryId=${'f'.repeat(64)}`,'GET',undefined,409);
    await h.json(`${h.route(other)}/${thread.id}?libraryId=${h.libraryId}`,'GET',undefined,404);
    const body=await h.question(doc,thread);
    for(const update of [{contextDigest:'0'.repeat(64)},{scope:'entire-document'},{scope:'custom',pages:[0]},{scope:'custom',pages:[1,1]},{scope:'page',pages:[1]},{scope:'custom',pages:Array(11).fill(1)},{content:' '},{role:'system'},{reviewed:true},{expectedRevision:-1},{context:{text:'injected'}}]) {
      await h.json(`${url}/messages`,'POST',{...body,...update},update.contextDigest?409:400);
    }
    const answer={...h.binding(doc),expectedRevision:0,requestId:randomUUID(),role:'assistant',content:'not reviewed'};
    await h.json(`${url}/messages`,'POST',answer,400);await h.json(`${url}/messages`,'POST',{...answer,reviewed:false},400);
    await h.json(`${url}/messages`,'POST',{...answer,reviewed:true,scope:'selection'},400);
    assert.equal((await h.read(url)).thread.revision,0);
    assert.equal((await h.request(h.route(doc),'POST',{...h.binding(doc),annotationId:a.id,requestId:randomUUID()},{Origin:'https://untrusted.invalid'})).status,403);
    const bytes=await readFile(h.pdfPath(doc.id));const replaced=Buffer.from(bytes);replaced[replaced.length-2]^=1;await writeFile(h.pdfPath(doc.id),replaced);
    await h.json(`${url}/messages`,'POST',body,409);await writeFile(h.pdfPath(doc.id),bytes);
    assert.equal((await h.read(url)).thread.revision,0);
  });

  test(`${mode} deleted annotations preserve readable discussion history and refuse new context or appends`,async t=>{
    const h=await fixture(t,vault),doc=await h.upload(),a=await h.annotate(doc),thread=await h.create(doc,a),url=`${h.route(doc)}/${thread.id}`,body=await h.question(doc,thread);
    const saved=await h.json(`${url}/messages`,'POST',body,201);
    await h.json(`/documents/${doc.id}/annotations/${a.id}`,'DELETE');
    const history=(await h.read(url)).thread;assert.equal(history.sourceStatus,'annotation-missing');assert.deepEqual(history.messages,saved.thread.messages);
    await h.json(`${url}/context`,'POST',{...h.binding(doc),scope:'selection'},409);
    await h.json(`${url}/messages`,'POST',{...body,expectedRevision:1,requestId:randomUUID()},409);
    assert.equal((await h.json(`${url}/messages`,'POST',body)).message.id,saved.message.id,'Lost-response replay remains available for preserved history');
    await h.stop();await h.start();assert.equal((await h.read(url)).thread.sourceStatus,'annotation-missing');
  });

  test(`${mode} empty region selection is explicit, context limits never truncate, and failed SQLite writes are recoverable`,async t=>{
    const h=await fixture(t,vault),doc=await h.upload(),a=await h.annotate(doc,{kind:'region'}),thread=await h.create(doc,a),url=`${h.route(doc)}/${thread.id}`;
    const empty=await h.preview(doc,thread);assert.equal(empty.characterCount,0);assert.deepEqual(empty.emptyPages,[1]);
    h.sqlite(db=>db.prepare('UPDATE pages SET text=? WHERE document_id=? AND page=1').run('x'.repeat(50_001),doc.id),'paperdesk.sqlite');
    await h.json(`${url}/context`,'POST',{...h.binding(doc),scope:'page'},413);
    const body=await h.question(doc,thread);
    h.sqlite(db=>db.exec("CREATE TRIGGER reject_discussion BEFORE UPDATE ON discussion_documents BEGIN SELECT RAISE(ABORT,'synthetic save failure'); END;"));
    await h.json(`${url}/messages`,'POST',body,500);
    h.sqlite(db=>db.exec('DROP TRIGGER reject_discussion'));
    const current=(await h.read(url)).thread;
    assert.equal(current.revision,vault?1:0,'A committed authoritative sidecar survives a later cache failure');
    const retried=await h.json(`${url}/messages`,'POST',body,vault?200:201);assert.equal(retried.thread.revision,1);assert.equal(retried.thread.messages.length,1);
  });
}

test('vault sidecar is authoritative across cache rebuild; malformed/missing/external revisions are never silently overwritten',async t=>{
  const h=await fixture(t,true),doc=await h.upload(),a=await h.annotate(doc),thread=await h.create(doc,a),url=`${h.route(doc)}/${thread.id}`,body=await h.question(doc,thread);
  const saved=await h.json(`${url}/messages`,'POST',body,201),sidecar=h.sidecar(doc.id),source=await readFile(sidecar,'utf8'),note=await readFile(h.notePath(doc.id));
  await h.stop();
  for(const name of ['paperdesk.sqlite','paperdesk.sqlite-wal','paperdesk.sqlite-shm','discussions.sqlite','discussions.sqlite-wal','discussions.sqlite-shm'])await rm(path.join(h.dataDir,name),{force:true});
  await h.start();assert.deepEqual((await h.read(url)).thread,saved.thread);assert.deepEqual(await readFile(h.notePath(doc.id)),note);
  await rm(sidecar);await h.json(`${url}?libraryId=${h.libraryId}`,'GET',undefined,409);
  await h.json(h.route(doc),'POST',{...h.binding(doc),annotationId:a.id,requestId:randomUUID()},409);
  await writeFile(sidecar,'{"schemaVersion":2}');await h.json(`${url}?libraryId=${h.libraryId}`,'GET',undefined,409);assert.equal(await readFile(sidecar,'utf8'),'{"schemaVersion":2}');
  await writeFile(sidecar,source);
  const changed=JSON.parse(source);changed.threads[0].messages[0].context.pages[0].text='tampered context';await writeFile(sidecar,JSON.stringify(changed));
  await h.json(`${url}?libraryId=${h.libraryId}`,'GET',undefined,409);await writeFile(sidecar,source);
  assert.equal((await h.read(url)).thread.revision,1);assert.deepEqual(await readFile(h.notePath(doc.id)),note);
  const recoveries=await readdir(path.join(h.dataDir,'recoveries','originals'));assert.ok(recoveries.length>0,'Atomic sidecar replacements retain recoverable originals');
});

test('standalone discussions reject malformed/future established schemas and do not erase original data',async t=>{
  const h=await fixture(t),doc=await h.upload(),a=await h.annotate(doc);await h.create(doc,a);await h.stop();
  const file=path.join(h.dataDir,'discussions.sqlite');h.sqlite(db=>db.exec('PRAGMA user_version=2;'));
  assert.throws(()=>createApp({dataDir:h.dataDir}),/较新版本/);assert.equal(h.sqlite(db=>db.prepare('SELECT COUNT(*) AS count FROM discussion_documents').get().count),1);
  h.sqlite(db=>db.exec('PRAGMA user_version=1;ALTER TABLE discussion_documents RENAME TO preserved_discussions;'));
  assert.throws(()=>createApp({dataDir:h.dataDir}),/结构不完整/);assert.equal(h.sqlite(db=>db.prepare('SELECT COUNT(*) AS count FROM preserved_discussions').get().count),1);
  assert.ok((await readFile(file)).length>0);
});

test('discussion sidecars reject symlinks without reading or overwriting external files',async t=>{
  const h=await fixture(t,true),doc=await h.upload(),a=await h.annotate(doc),thread=await h.create(doc,a),sidecar=h.sidecar(doc.id),original=await readFile(sidecar),external=path.join(h.root,'external.json');
  await writeFile(external,original);await rm(sidecar);await symlink(external,sidecar);
  await h.json(`${h.route(doc)}/${thread.id}?libraryId=${h.libraryId}`,'GET',undefined,409);
  assert.deepEqual(await readFile(external),original);
});

test('optional document identity guard rejects old-library reads, saves and conflict copies without changing data',async t=>{
  const h=await fixture(t,true),doc=await h.upload(),note=await readFile(h.notePath(doc.id)),foreign='0'.repeat(64);
  for(const [route,method,body] of [[`/documents/${doc.id}?expectedLibraryId=${foreign}`,'GET',undefined],[`/documents/${doc.id}`,'PATCH',{notesZh:'wrong library',expectedNotesRevision:doc.notesRevision,expectedLibraryId:foreign}],[`/documents/${doc.id}/vault-conflict`,'POST',{text:'wrong library',expectedLibraryId:foreign}]]) {
    const result=await h.json(route,method,body,409);assert.equal(result.code,'LIBRARY_IDENTITY_MISMATCH');
  }
  assert.deepEqual(await readFile(h.notePath(doc.id)),note);
  const result=await h.json(`/documents/${doc.id}`,'PATCH',{notesZh:'right library',expectedNotesRevision:doc.notesRevision,expectedLibraryId:h.libraryId});assert.equal(result.document.notesZh,'right library');
  assert.equal((await h.json(`/documents/${doc.id}?expectedLibraryId=${h.libraryId}`)).document.notesZh,'right library');
});

for(const vault of [false,true]) test(`${vault?'vault':'standalone'} simultaneous request retries are single-save and competing revisions preserve one winner`,async t=>{
  const h=await fixture(t,vault),doc=await h.upload(),a=await h.annotate(doc),thread=await h.create(doc,a),url=`${h.route(doc)}/${thread.id}`;
  const body=await h.question(doc,thread);
  const repeated=await Promise.all([h.request(`${url}/messages`,'POST',body),h.request(`${url}/messages`,'POST',body)]);
  assert.deepEqual(repeated.map(res=>res.status).sort(),[200,201]);
  const current=(await h.read(url)).thread;assert.equal(current.revision,1);
  const next=await h.question(doc,current);
  const contested=await Promise.all([h.request(`${url}/messages`,'POST',next),h.request(`${url}/messages`,'POST',{...next,requestId:randomUUID(),content:'a different concurrent question'})]);
  assert.deepEqual(contested.map(res=>res.status).sort(),[201,409]);
  assert.equal((await h.read(url)).thread.revision,2);
});

test('vault recovery-backup failure never replaces the authoritative sidecar and the same request can be retried',async t=>{
  const h=await fixture(t,true),doc=await h.upload(),a=await h.annotate(doc),thread=await h.create(doc,a),url=`${h.route(doc)}/${thread.id}`,before=await readFile(h.sidecar(doc.id));
  const recovery=path.join(h.dataDir,'recoveries','originals');
  await rename(recovery,`${recovery}-retained`);await writeFile(recovery,'synthetic blocked directory');
  const body=await h.question(doc,thread);assert.equal((await h.json(`${url}/messages`,'POST',body,503)).code,'DISCUSSION_SAVE_UNCERTAIN');
  assert.deepEqual(await readFile(h.sidecar(doc.id)),before);assert.equal((await h.read(url)).thread.revision,0);
  await rm(recovery);await rename(`${recovery}-retained`,recovery);assert.equal((await h.json(`${url}/messages`,'POST',body,201)).thread.revision,1);
});

test('changed page context after preview requires explicit new confirmation and never rewrites the saved snapshot',async t=>{
  const h=await fixture(t),doc=await h.upload(),a=await h.annotate(doc),thread=await h.create(doc,a),url=`${h.route(doc)}/${thread.id}`,body=await h.question(doc,thread,'page');
  h.sqlite(db=>db.prepare('UPDATE pages SET text=? WHERE document_id=? AND page=1').run('Changed indexed page text.',doc.id),'paperdesk.sqlite');
  await h.json(`${url}/messages`,'POST',body,409);assert.equal((await h.read(url)).thread.revision,0);
  const refreshed=await h.question(doc,thread,'page'),saved=await h.json(`${url}/messages`,'POST',refreshed,201);
  h.sqlite(db=>db.prepare('UPDATE pages SET text=? WHERE document_id=? AND page=1').run('Later index text.',doc.id),'paperdesk.sqlite');
  const persisted=(await h.read(url)).thread.messages[0].context;
  assert.deepEqual(persisted,saved.message.context);assert.equal(persisted.pages[0].text,'Changed indexed page text.');
  assert.equal((await h.json(`${url}/messages`,'POST',refreshed)).message.id,saved.message.id,'Replaying a confirmed old request does not rebuild its context');
});

for(const vault of [false,true]) test(`${vault?'vault':'standalone'} discussion JSON export includes saved contexts and answers while enforcing the library boundary`,async t=>{
  const h=await fixture(t,vault),doc=await h.upload(),a=await h.annotate(doc),thread=await h.create(doc,a),url=`${h.route(doc)}/${thread.id}`;
  const question=await h.json(`${url}/messages`,'POST',await h.question(doc,thread,'adjacent'),201);
  const answer=await h.json(`${url}/messages`,'POST',{...h.binding(doc),expectedRevision:1,requestId:randomUUID(),role:'assistant',content:'Reviewed answer retained in export.',reviewed:true},201);
  const response=await h.request(`${h.route(doc)}/export?libraryId=${h.libraryId}`);assert.equal(response.status,200);assert.match(response.headers.get('Content-Disposition'),/attachment.*discussions-.*\.json/);
  const exported=await response.json();assert.equal(exported.schemaVersion,1);assert.equal(exported.documentId,doc.id);
  assert.deepEqual(exported.threads[0].messages,[question.message,answer.message]);assert.ok(exported.requests.some(row=>row.messageId===answer.message.id));
  await h.json(`${h.route(doc)}/export?libraryId=${'f'.repeat(64)}`,'GET',undefined,409);
  await h.json(`/documents/${randomUUID()}/threads/export?libraryId=${h.libraryId}`,'GET',undefined,404);
});

test('identity-bound document reads verify real PDF bytes rather than only trusting the stored hash',async t=>{
  const h=await fixture(t),doc=await h.upload(),route=`/documents/${doc.id}?expectedLibraryId=${h.libraryId}&expectedPdfSha256=${doc.pdfSha256}`;
  await h.json(route);await h.json(`/documents/${doc.id}?expectedPdfSha256=${doc.pdfSha256}`,'GET',undefined,400);
  await h.json(`/documents/${doc.id}?expectedLibraryId=${h.libraryId}&expectedPdfSha256=${'0'.repeat(64)}`,'GET',undefined,409);
  const bytes=Buffer.from(sample);bytes[bytes.length-2]^=1;await writeFile(h.pdfPath(doc.id),bytes);
  await h.json(route,'GET',undefined,409);await writeFile(h.pdfPath(doc.id),sample);await h.json(route);
});

test('discussion byte limit reserves the sidecar newline and every accepted boundary write can be read back',async t=>{
  const {createDiscussionStore,MAX_DISCUSSION_BYTES}=await import('../server/discussion-store.mjs');
  const dataDir=await mkdtemp(path.join(tmpdir(),'paperdesk-discussion-boundary-'));let saved;
  class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
  const store=createDiscussionStore({dataDir,HttpError,validate(){},vaultStore:{readDiscussions(){return saved;},writeDiscussions(_id,source){saved={source,token:hash(source)};return saved;}}});
  t.after(async()=>{store.close();await rm(dataDir,{recursive:true,force:true});});
  const id=randomUUID();
  store.mutate(id,state=>{state.padding='';state.padding='x'.repeat(MAX_DISCUSSION_BYTES-1-Buffer.byteLength(JSON.stringify(state),'utf8'));});
  assert.equal(Buffer.byteLength(saved.source,'utf8'),MAX_DISCUSSION_BYTES);assert.ok(store.read(id).padding.length>0);
  const before=saved.source;assert.throws(()=>store.mutate(id,state=>{state.padding+='x';}),error=>error.status===413);
  assert.equal(saved.source,before);assert.equal(Buffer.byteLength(JSON.stringify(store.read(id)),'utf8'),MAX_DISCUSSION_BYTES-1);
});

test('a sidecar readback failure after atomic publication reports an uncertain save and preserves the authoritative record',async t=>{
  const {createDiscussionStore}=await import('../server/discussion-store.mjs');
  const dataDir=await mkdtemp(path.join(tmpdir(),'paperdesk-discussion-uncertain-'));let saved,fail=true;
  class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
  const store=createDiscussionStore({dataDir,HttpError,validate(){},vaultStore:{readDiscussions(){return saved;},writeDiscussions(_id,source){saved={source,token:hash(source)};if(fail)throw new Error('synthetic readback failure after publish');return saved;}}});
  t.after(async()=>{store.close();await rm(dataDir,{recursive:true,force:true});});
  const id=randomUUID();
  assert.throws(()=>store.mutate(id,state=>{state.savedRequest=randomUUID();}),error=>error.status===503&&error.code==='DISCUSSION_SAVE_UNCERTAIN');
  const first=JSON.parse(saved.source);fail=false;
  assert.equal(store.read(id).savedRequest,first.savedRequest,'Next read recovers the committed sidecar even after SQLite rollback');
});
