import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,mkdirSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {Journal} from '../src/core.mjs';
import {StudySession} from '../src/study-session.mjs';

function setup(){
  const dir=mkdtempSync(join(tmpdir(),'study-notes-')),journal=new Journal(dir);
  journal.append({type:'start',mediaTime:null});journal.append({type:'caption',text:'Pod 네트워크',mediaTime:12.5});
  const session=new StudySession(dir);session.init();return {dir,journal,session};
}
const review=(packet)=>packet.events.map(e=>({eventId:e.id,action:'reviewed',reason:'Reviewed without a separate note.'}));

test('commit validates evidence/dispositions and atomically saves distinct lecture and explanation records',()=>{
  const {dir,session}=setup(),b=session.next();
  const payload={key:'c1',receipt:b.receipt,items:[
    {key:'l1',kind:'lecture',text:'강의: Pod 네트워크',evidence:[2]},
    {key:'x1',kind:'explanation',text:'AI가 덧붙인 설명',evidence:[2]}],
    dispositions:[{eventId:1,action:'reviewed',reason:'Capture starts.'},{eventId:2,action:'noted',itemKeys:['l1','x1']}]};
  const before=readFileSync(join(dir,'study.json'),'utf8');
  assert.throws(()=>session.commit({...payload,items:[{...payload.items[0],evidence:[99]}]}),/evidence/i);
  assert.throws(()=>session.commit({...payload,dispositions:[]}),/disposition/i);
  assert.throws(()=>session.commit({...payload,dispositions:[{eventId:1,action:'reviewed',reason:'Start'},{eventId:2,action:'noted',itemKeys:['missing']}]}),/item|noted/i);
  assert.equal(readFileSync(join(dir,'study.json'),'utf8'),before);
  session.commit(payload);
  const saved=JSON.parse(readFileSync(join(dir,'study.json'),'utf8'));
  assert.deepEqual(saved.items.map(n=>n.kind),['lecture','explanation']);
  assert.equal(saved.commits[0].dispositions[1].action,'noted');
  assert.equal(saved.committedCursor,2);
  assert.deepEqual(new StudySession(dir).commit(payload),session.commit(payload));
});

test('questions, linked answers and unverified corrections keep their source and do not move capture cursor',()=>{
  const {dir,journal,session}=setup();
  session.setMode('question',{key:'ask',question:{key:'q1',kind:'question',text:'왜 필요해?',evidence:[2]}});
  session.note({key:'answer',items:[{key:'a1',kind:'answer',questionKey:'q1',text:'답변',evidence:[2]}]});
  assert.equal(session.status().committedCursor,0);
  session.note({key:'fix',items:[{key:'fix1',kind:'correction',text:'검증이 더 필요함',evidence:[2],unverified:true}]});
  assert.throws(()=>session.note({key:'bad-fix',items:[{key:'fix2',kind:'correction',text:'확실함',evidence:[2]}]}),/unverified|source|correction/i);
  journal.append({type:'observation-gap',durationMs:3000,mediaTime:null});
  assert.throws(()=>session.note({key:'bad-source',items:[{key:'bad',kind:'lecture',text:'주장',evidence:[3]}]}),/caption|frame|evidence/i);
  const notes=JSON.parse(readFileSync(join(dir,'study.json'),'utf8')).items;
  assert.equal(notes.find(n=>n.key==='q1').capturedThrough,2);assert.equal(notes.find(n=>n.key==='a1').questionKey,'q1');
});

test('oversized Korean evidence requires contiguous complete reads and every response fits its byte limit',()=>{
  const {journal,session}=setup();journal.append({type:'caption',text:'강의🧑‍💻설명 '.repeat(900),mediaTime:null});
  let b=session.next();session.commit({key:'initial',receipt:b.receipt,items:[],dispositions:review(b)});
  b=session.next({maxBytes:2048});
  // The initial 12k batch may also contain the large event as a reference.
  assert.equal(b.events[0].omitted,true);
  const payload={key:'large',receipt:b.receipt,items:[],dispositions:review(b)};
  assert.throws(()=>session.commit(payload),/oversized|complete|read/i);
  const tail=session.evidence({receipt:b.receipt,eventId:3,offset:500,maxBytes:2048});
  assert.ok(Buffer.byteLength(JSON.stringify(tail))<=2048);
  assert.throws(()=>session.commit(payload),/complete|read/i);
  let offset=0,text='';
  do{const part=session.evidence({receipt:b.receipt,eventId:3,offset,maxBytes:2048});
    assert.ok(Buffer.byteLength(JSON.stringify(part))<=2048);text+=part.text;offset=part.nextOffset;if(part.complete)break;
  }while(true);
  assert.equal(JSON.parse(text).text,'강의🧑‍💻설명 '.repeat(900));
  session.commit(payload);assert.equal(session.status().committedCursor,3);
});

test('frame references must be real files inside the session, including after receipt creation',()=>{
  const {dir,journal,session}=setup();const external=mkdtempSync(join(tmpdir(),'study-external-'));
  writeFileSync(join(external,'secret.png'),'private external file');
  symlinkSync(join(external,'secret.png'),join(dir,'frame.png'));
  journal.append({type:'frame',file:'frame.png',mediaTime:null});
  assert.throws(()=>session.next(),/frame|session|outside/i);
  rmSync(join(dir,'frame.png'));writeFileSync(join(dir,'frame.png'),'synthetic image');
  const b=session.next();rmSync(join(dir,'frame.png'));symlinkSync(join(external,'secret.png'),join(dir,'frame.png'));
  assert.throws(()=>new StudySession(dir).next(),/frame|session|outside/i);
  assert.throws(()=>new StudySession(dir).evidence({receipt:b.receipt,eventId:3,offset:0}),/frame|session|outside/i);
  assert.throws(()=>session.commit({key:'frames',receipt:b.receipt,items:[],dispositions:review(b)}),/frame|session|outside/i);
  assert.equal(session.status().committedCursor,0);
});

test('export preserves manual notes, includes uncertainty/source IDs and detects edits to generated files',()=>{
  const {dir,journal,session}=setup();journal.append({type:'observation-gap',durationMs:3500,mediaTime:null});
  journal.append({type:'seek',from:90,mediaTime:12.5});
  journal.append({type:'caption-overflow',dropped:4,mediaTime:null});
  session.note({key:'explain',items:[{key:'x1',kind:'explanation',text:'설명 <script> & 내용',evidence:[2]}]});
  writeFileSync(join(dir,'notes.md'),'manual notes');
  assert.throws(()=>session.export(),/existing|manual|owned/i);
  assert.equal(readFileSync(join(dir,'notes.md'),'utf8'),'manual notes');
  const output=session.export({notesPath:join(dir,'generated.md')});
  const md=readFileSync(output.notesPath,'utf8');
  assert.match(md,/explanation|부연설명/);assert.match(md,/#2|evidence-2/);assert.match(md,/observation-gap/);assert.match(md,/caption-overflow/);
  assert.match(md,/3500/);assert.match(md,/seek/);assert.match(md,/unknown|null|불명/);
  assert.doesNotMatch(md,/<script>/);assert.equal(JSON.parse(readFileSync(output.jsonPath,'utf8')).items.length,1);
  writeFileSync(output.notesPath,'user edited this');
  assert.throws(()=>session.export({notesPath:output.notesPath}),/modified|edit|owned/i);
  assert.equal(readFileSync(output.notesPath,'utf8'),'user edited this');
});

test('a partial export failure leaves saved work and a retry can recover generated outputs',()=>{
  const {dir,journal,session}=setup();session.note({key:'note',items:[{key:'q',kind:'open-question',text:'검토할 점',evidence:[2]}]});
  const blocked=join(dir,'blocked');writeFileSync(blocked,'parent is a file');
  assert.throws(()=>session.export({jsonPath:join(blocked,'notes.json')}));
  assert.equal(JSON.parse(readFileSync(join(dir,'study.json'),'utf8')).items.length,1);
  assert.equal(existsSync(join(dir,'notes.md')),true);
  journal.append({type:'caption',text:'내보내기 실패 후 새 강의 내용'});
  rmSync(blocked);mkdirSync(blocked);
  const result=session.export({jsonPath:join(blocked,'notes.json')});
  assert.equal(JSON.parse(readFileSync(result.jsonPath,'utf8')).items[0].text,'검토할 점');
});

test('note-only evidence cannot be replaced while keeping the first journal row and IDs',()=>{
  const {dir,session}=setup();session.note({key:'note',items:[{key:'l1',kind:'lecture',text:'원문을 기록함',evidence:[2]}]});
  const path=join(dir,'events.jsonl'),original=readFileSync(path,'utf8');
  writeFileSync(path,original.replace('Pod 네트워크','교체된 내용'));
  assert.throws(()=>session.status(),/journal|evidence|chang/i);
  assert.throws(()=>session.export(),/journal|evidence|chang/i);
});

test('an interrupted first export publishes no partial output and can be retried',()=>{
  const script=`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module';
    import {tmpdir} from 'node:os';
    import {join} from 'node:path';
    import {StudySession} from ${JSON.stringify(new URL('../src/study-session.mjs',import.meta.url).href)};
    import {Journal} from ${JSON.stringify(new URL('../src/core.mjs',import.meta.url).href)};
    const dir=fs.mkdtempSync(join(tmpdir(),'study-write-failure-')),notes=join(dir,'notes.md');
    new Journal(dir).append({type:'caption',text:'Synthetic source'});
    const session=new StudySession(dir);session.init();
    const original=fs.writeFileSync;
    fs.writeFileSync=(path,text,...args)=>{
      if(String(path)===notes||String(path).startsWith(notes+'.')){
        original(path,String(text).slice(0,20),...args);throw new Error('Injected write interruption');
      }
      return original(path,text,...args);
    };
    syncBuiltinESMExports();
    try{assert.throws(()=>session.export(),/interruption/);}finally{fs.writeFileSync=original;syncBuiltinESMExports();}
    assert.equal(fs.existsSync(notes),false,'A partially written note must not be published');
    session.export();assert.match(fs.readFileSync(notes,'utf8'),/함께 공부한/);
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
