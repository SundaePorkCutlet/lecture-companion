import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,appendFileSync,rmSync,mkdirSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Journal} from '../src/core.mjs';
const {StudySession} = await import('../src/study-session.mjs').catch(()=>({}));

function setup(){
  assert.equal(typeof StudySession,'function','StudySession must be implemented');
  const dir=mkdtempSync(join(tmpdir(),'study-'));
  const journal=new Journal(dir);journal.append({type:'start',mediaTime:null});
  journal.append({type:'caption',text:'첫 강의 내용',mediaTime:null});
  const session=new StudySession(dir);session.init();
  return {dir,journal,session};
}
const reviewed=b=>({receipt:b.receipt,key:`commit-${b.receipt}`,items:[],dispositions:b.events.map(e=>({eventId:e.id,action:'reviewed',reason:'Inspected in this test; no separate annotation.'}))});

test('question preserves pending receipt and new capture until catch-up commits saved work',()=>{
  const {dir,journal,session}=setup();const batch=session.next();
  assert.equal(session.status().committedCursor,0);
  session.setMode('question',{key:'q1',question:{key:'q1',kind:'question',text:'이게 왜 필요해?'}});
  journal.append({type:'caption',text:'질문 중 지나간 내용',mediaTime:null});
  assert.equal(session.next().blocked,true);assert.equal(session.status().capturedCursor,3);
  assert.equal(session.status().committedCursor,0);
  const restarted=new StudySession(dir);restarted.setMode('catch-up');
  assert.deepEqual(restarted.next(),batch);
  restarted.commit(reviewed(batch));
  const later=restarted.next();assert.deepEqual(later.events.map(e=>e.id),[3]);
  restarted.commit(reviewed(later));
  assert.equal(restarted.status().caughtUpThrough,3);
  journal.append({type:'caption',text:'판단 직후 새 내용'});
  assert.equal(restarted.status().caughtUpThrough,null);
  assert.equal(restarted.status().backlogEvents,1);
});

test('commit retries are idempotent and stale/conflicting writes preserve source and state',()=>{
  const {dir,session}=setup();const batch=session.next(),payload=reviewed(batch);
  const first=session.commit({...payload,expectedRevision:session.status().revision});
  assert.deepEqual(new StudySession(dir).commit({...payload,expectedRevision:0}),first);
  const before=readFileSync(join(dir,'study.json'),'utf8');
  assert.throws(()=>session.commit({...payload,items:[],dispositions:[]}),/key|conflict/i);
  assert.throws(()=>session.setMode('question',{key:'q-stale',question:{key:'q-stale',kind:'question',text:'Q'},expectedRevision:0}),/revision/i);
  assert.equal(readFileSync(join(dir,'study.json'),'utf8'),before);
  writeFileSync(join(dir,'.study.lock'),'another writer');
  assert.throws(()=>session.setMode('follow'),/lock|EEXIST/i);
  assert.equal(readFileSync(join(dir,'.study.lock'),'utf8'),'another writer');
  rmSync(join(dir,'.study.lock'));
});

test('journal replacement, truncation and an incomplete capture tail never alter evidence',()=>{
  const {dir,journal,session}=setup();const batch=session.next();session.commit(reviewed(batch));
  const original=readFileSync(join(dir,'events.jsonl'),'utf8');
  appendFileSync(join(dir,'events.jsonl'),'{"id":3');
  assert.equal(session.status().capturedCursor,2);
  assert.equal(readFileSync(join(dir,'events.jsonl'),'utf8'),original+'{"id":3');
  writeFileSync(join(dir,'events.jsonl'),original.split('\n')[0]+'\n');
  assert.throws(()=>session.status(),/truncat|journal|evidence/i);
  writeFileSync(join(dir,'events.jsonl'),original.replace('첫 강의 내용','다른 강의 내용'));
  assert.throws(()=>session.status(),/chang|journal|evidence/i);
  writeFileSync(join(dir,'events.jsonl'),original);journal.append({type:'end'});
  assert.equal(session.status().capturedCursor,3);
});

test('receipts respect serialized byte budgets, preserve order and do not silently change on retry',()=>{
  const {journal,session}=setup();
  for(let i=0;i<25;i++)journal.append({type:'caption',text:'한글 설명 '.repeat(35)});
  const first=session.next({maxBytes:2048});
  assert.ok(Buffer.byteLength(JSON.stringify(first))<=2048);assert.equal(first.hasMore,true);
  assert.deepEqual(session.next({maxBytes:12000}),first);
  let ids=[];let b=first;
  while(b.receipt){ids.push(...b.events.map(e=>e.id));session.commit(reviewed(b));b=session.next({maxBytes:2048});}
  assert.deepEqual(ids,Array.from({length:27},(_,i)=>i+1));
  assert.equal(b.caughtUpThrough,27);
  assert.throws(()=>session.next({maxBytes:2047}),/2048|byte/i);
});

test('unreadable state cannot advance the durable cursor',()=>{
  const {dir,session}=setup();const batch=session.next();
  const original=readFileSync(join(dir,'study.json'),'utf8');
  // A filesystem replacement failure is independent of annotation validation.
  rmSync(join(dir,'study.json'));mkdirSync(join(dir,'study.json'));
  assert.throws(()=>session.commit(reviewed(batch)));
  rmSync(join(dir,'study.json'),{recursive:true});writeFileSync(join(dir,'study.json'),original);
  assert.equal(new StudySession(dir).status().committedCursor,0);
  assert.deepEqual(new StudySession(dir).next(),batch);
});

test('atomic file replacement failure preserves the target and removes its temporary file',async()=>{
  const {atomicWrite}=await import('../src/study-store.mjs');
  const dir=mkdtempSync(join(tmpdir(),'study-atomic-')),target=join(dir,'target');
  mkdirSync(target);writeFileSync(join(target,'keep'),'original');
  assert.throws(()=>atomicWrite(target,'replacement'),/EISDIR|directory/i);
  assert.equal(readFileSync(join(target,'keep'),'utf8'),'original');
  assert.deepEqual(readdirSync(dir),['target']);
});
