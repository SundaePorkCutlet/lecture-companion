import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Journal} from '../src/core.mjs';
import {StudySession} from '../src/study-session.mjs';

function setup(){
  const dir=mkdtempSync(join(tmpdir(),'lecture-question-')),journal=new Journal(dir);
  journal.append({type:'start',mediaTime:null});journal.append({type:'caption',text:'처음 설명',mediaTime:null});
  const session=new StudySession(dir);session.init();
  return {dir,journal,session};
}
const qa=(context,key='qa1')=>({key,context,question:{text:'이게 무슨 뜻이야?',evidence:[2]},answer:{text:'강의 내용을 보충한 답변',evidence:[2]}});

test('question context refreshes without changing the lecture mode, pending receipt or study file',()=>{
  const {dir,journal,session}=setup(),pending=session.next();
  const before=readFileSync(join(dir,'study.json'),'utf8');
  assert.equal(typeof session.context,'function','read-only question context is required');
  let context=session.context({maxBytes:2048});assert.equal(context.capturedThrough,2);
  journal.append({type:'caption',text:'질문 중 새 강의 문맥',mediaTime:null});
  writeFileSync(join(dir,'.study.lock'),'lecture writer active');
  context=session.context({maxBytes:2048});assert.equal(context.capturedThrough,3);
  assert.ok(context.evidence.some(e=>e.text==='질문 중 새 강의 문맥'));
  assert.equal(readFileSync(join(dir,'study.json'),'utf8'),before);
  assert.ok(Buffer.byteLength(JSON.stringify(context))<=2048);
  rmSync(join(dir,'.study.lock'));assert.deepEqual(session.next(),pending);
  assert.equal(existsSync(join(dir,'questions.json')),false);
});

test('independent Q&A persistence works under the study lock and preserves a concurrent pending lecture batch',()=>{
  const {dir,journal,session}=setup(),batch=session.next();
  assert.equal(typeof session.context,'function');const context=session.context();
  const before=readFileSync(join(dir,'study.json'),'utf8');writeFileSync(join(dir,'.study.lock'),'other writer');
  const result=session.qa(qa(context));assert.equal(result.saved,true);
  assert.deepEqual(session.qa(qa(context)),result);
  assert.equal(readFileSync(join(dir,'study.json'),'utf8'),before);
  assert.throws(()=>session.qa({...qa(context),answer:{text:'different answer',evidence:[2]}}),/key|conflict/i);
  rmSync(join(dir,'.study.lock'));journal.append({type:'caption',text:'계속 수집'});
  session.commit({key:'worker',receipt:batch.receipt,items:[],dispositions:batch.events.map(e=>({eventId:e.id,action:'reviewed',reason:'Inspected fixture'}))});
  assert.equal(session.status().committedCursor,2);assert.equal(session.status().mode,'follow');
  assert.equal(session.context().recentQa.length,1);
});

test('Q&A requires the same session and unchanged snapshot, while later capture is allowed',()=>{
  const {dir,journal,session}=setup();assert.equal(typeof session.context,'function');
  journal.append({type:'caption',text:'독립 Q&A가 처음 읽은 근거'});
  const context=session.context();journal.append({type:'caption',text:'later evidence'});
  assert.throws(()=>session.qa({...qa(context),context:{...context,sessionId:'different'}}),/session/i);
  assert.throws(()=>session.qa({...qa(context),answer:{text:'future claim',evidence:[4]}}),/context|snapshot|evidence/i);
  session.qa(qa(context));
  const path=join(dir,'events.jsonl');writeFileSync(path,readFileSync(path,'utf8').replace('독립 Q&A가 처음 읽은 근거','바뀐 근거'));
  assert.throws(()=>session.context(),/journal|evidence|chang/i);
  assert.throws(()=>session.export(),/journal|evidence|chang/i);
});

test('bounded fresh context and read-only fragments handle oversized Unicode evidence',()=>{
  const {dir,journal,session}=setup();assert.equal(typeof session.context,'function');
  const text='큰 자막 🧑‍💻 '.repeat(1000);journal.append({type:'caption',text,mediaTime:null});
  const before=readFileSync(join(dir,'study.json'),'utf8'),context=session.context({maxBytes:2048});
  assert.ok(Buffer.byteLength(JSON.stringify(context))<=2048);assert.ok(context.evidence.find(e=>e.id===3)?.omitted);
  let offset=0,combined='';
  for(;;){const chunk=session.context({eventId:3,offset,maxBytes:2048});
    assert.ok(Buffer.byteLength(JSON.stringify(chunk))<=2048);combined+=chunk.text;offset=chunk.nextOffset;if(chunk.complete)break;
  }
  assert.equal(JSON.parse(combined).text,text);assert.equal(readFileSync(join(dir,'study.json'),'utf8'),before);
  assert.throws(()=>session.context({eventId:999}),/evidence/i);
});

test('question context rejects external frame symlinks on each read',()=>{
  const {dir,journal,session}=setup();assert.equal(typeof session.context,'function');
  writeFileSync(join(dir,'frame.png'),'synthetic');journal.append({type:'frame',file:'frame.png',mediaTime:null});
  assert.ok(session.context().evidence.some(e=>e.type==='frame'));
  const external=mkdtempSync(join(tmpdir(),'external-frame-'));writeFileSync(join(external,'x.png'),'outside');
  rmSync(join(dir,'frame.png'));symlinkSync(join(external,'x.png'),join(dir,'frame.png'));
  assert.throws(()=>session.context(),/frame|outside|session/i);
  assert.throws(()=>session.context({eventId:3}),/frame|outside|session/i);
});

test('native question chat setup is reserved once, bound once, and reused after restart',()=>{
  const {dir,session}=setup();assert.equal(typeof session.prepareChat,'function');
  const first=session.prepareChat({host:'codex',workerThreadId:'worker-1',title:'합성 강의'});
  assert.equal(first.action,'create');assert.ok(first.prompt.includes(dir));assert.ok(first.title.includes(session.status().sessionId.slice(0,8)));
  assert.equal(new StudySession(dir).prepareChat({host:'codex'}).action,'recover');
  assert.throws(()=>session.bindChat({setupId:'wrong',threadId:'q-thread'}),/setup/i);
  session.bindChat({setupId:first.setupId,threadId:'q-thread'});
  assert.equal(new StudySession(dir).prepareChat({host:'codex'}).threadId,'q-thread');
  assert.equal(session.prepareChat({host:'codex'}).action,'reuse');
  assert.throws(()=>session.bindChat({setupId:first.setupId,threadId:'other'}),/bound|conflict/i);
  assert.equal(session.status().mode,'follow');assert.equal(session.status().committedCursor,0);
});

test('final export includes side-chat questions, answers and exact snapshot positions',()=>{
  const {dir,session}=setup();assert.equal(typeof session.context,'function');session.qa(qa(session.context()));
  const result=session.export(),md=readFileSync(result.notesPath,'utf8'),json=JSON.parse(readFileSync(result.jsonPath,'utf8'));
  assert.match(md,/이게 무슨 뜻이야/);assert.match(md,/강의 내용을 보충한 답변/);
  assert.equal(json.sideChatQa.length,1);assert.equal(json.sideChatQa[0].context.capturedThrough,2);
  assert.equal(json.questionRevision,JSON.parse(readFileSync(join(dir,'questions.json'),'utf8')).revision);
  assert.ok(json.items.some(item=>item.kind==='question'));assert.ok(json.items.some(item=>item.kind==='answer'));
  assert.equal(json.evidence.find(e=>e.id===2).text,'처음 설명');
});

test('tight question context keeps a reference to the latest study summary as captions accumulate',()=>{
  const {journal,session}=setup();session.note({key:'summary',items:[{key:'latest-summary',kind:'explanation',text:'이전 개념들을 연결한 중요한 최신 요약',evidence:[2]}]});
  for(let i=0;i<35;i++)journal.append({type:'caption',text:`최근 문맥 ${i} `+'설명 '.repeat(20)});
  const context=session.context({maxBytes:2048});
  assert.ok(context.studyItems.some(item=>item.key==='latest-summary'));
  assert.ok(context.evidence.some(event=>event.id===37));
  assert.ok(Buffer.byteLength(JSON.stringify(context))<=2048);
});

test('Q&A rejects invalid summarized positions and timestamps instead of substituting the later worker cursor',()=>{
  const {session}=setup(),context=session.context();
  for(const summarizedThrough of [undefined,-1,1.5,999999,1])assert.throws(()=>session.qa(qa({...context,summarizedThrough})),/summarized|snapshot/i);
  for(const asOf of [undefined,null,'not-a-date','2026'])assert.throws(()=>session.qa(qa({...context,asOf})),/timestamp/i);
  const pending=session.next();session.commit({key:'advance',receipt:pending.receipt,items:[],dispositions:pending.events.map(e=>({eventId:e.id,action:'reviewed',reason:'Inspected fixture'}))});
  session.qa(qa(context));assert.equal(session.context().recentQa[0].items[0].committedThrough,0);
});

test('a confirmed unsuccessful chat opening can retry its reservation without duplicating a bound or unknown attempt',()=>{
  const {session}=setup(),first=session.prepareChat({host:'codex'});
  const recover=session.prepareChat({host:'codex'});assert.equal(recover.action,'recover');assert.equal(recover.prompt,first.prompt);
  assert.throws(()=>session.prepareChat({host:'codex',retrySetupId:'unknown-attempt'}),/setup|retry/i);
  const retry=session.prepareChat({host:'codex',retrySetupId:first.setupId});
  assert.equal(retry.action,'create');assert.notEqual(retry.setupId,first.setupId);assert.equal(retry.prompt,first.prompt);
  assert.throws(()=>session.bindChat({setupId:first.setupId,threadId:'late-thread'}),/setup/i);
  session.bindChat({setupId:retry.setupId,threadId:'actual-thread'});
  assert.throws(()=>session.prepareChat({host:'codex',retrySetupId:retry.setupId}),/bound|retry/i);
  assert.equal(session.prepareChat({host:'codex'}).threadId,'actual-thread');
});

test('bounded search discovers older study and Q&A items and supports complete read-only pagination',()=>{
  const {dir,session}=setup(),longText='오래된 설명 — 🌏 '.repeat(1000);
  for(let i=0;i<12;i++)session.note({key:`summary-op-${i}`,items:[{key:`older-summary-${i}`,kind:'explanation',text:i===0?longText:`후속 요약 ${i}`,evidence:[2]}]});
  for(let i=0;i<3;i++)session.qa({...qa(session.context(),`older-qa-${i}`),question:{text:`과거 질문 ${i}`,evidence:[2]}});
  const before=readFileSync(join(dir,'study.json'),'utf8');
  const result=session.context({query:'오래된 설명',maxBytes:2048});assert.equal(result.search.totalMatches,1);
  assert.equal(result.matches[0].key,'older-summary-0');assert.equal(result.matches[0].omitted,true);
  let text='',offset=0;
  for(;;){const part=session.context({itemKey:result.matches[0].key,offset,maxBytes:2048});text+=part.text;if(part.complete)break;offset=part.nextOffset;}
  assert.equal(JSON.parse(text).text,longText);
  const found=[];offset=0;
  for(let page=0;page<30;page++){
    const result=session.context({query:'',offset,maxBytes:2048});assert.ok(Buffer.byteLength(JSON.stringify(result))<=2048);
    found.push(...result.matches.map(item=>item.key));if(result.search.complete)break;
    assert.ok(result.search.nextOffset>offset);offset=result.search.nextOffset;
  }
  assert.equal(found.length,18);assert.equal(new Set(found).size,18);assert.ok(found.includes('older-summary-0'));
  assert.equal(session.context({query:'과거 질문 0'}).search.totalMatches,1);
  assert.throws(()=>session.context({query:'',offset:-1}),/offset/i);
  assert.throws(()=>session.context({query:'',eventId:2}),/one|exclusive|combine/i);
  assert.equal(readFileSync(join(dir,'study.json'),'utf8'),before);
});
