import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,statSync,truncateSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Journal} from '../src/core.mjs';
import {runCapture} from '../src/ego-capture.mjs';
import {PNG} from '../vendor/pngjs/lib/png.js';

const directory=()=>mkdtempSync(join(tmpdir(),'lecture-quota-'));
const limitError=error=>error.code==='RESOURCE_LIMIT';

test('journal rejects oversized UTF-8 captions before writing or advancing sequence',()=>{
  const dir=directory(),journal=new Journal(dir,{limits:{captionBytes:8}});
  assert.throws(()=>journal.append({type:'caption',text:'한글자'}),limitError);
  assert.equal(statSync(join(dir,'events.jsonl')).size,0);
  assert.equal(journal.append({type:'caption',text:'한글'}).id,1);
});

test('repeated small captions stop at the journal quota and retain earlier evidence',()=>{
  const dir=directory(),journal=new Journal(dir,{limits:{journalBytes:4096}});
  let accepted=0;
  assert.throws(()=>{for(let i=0;i<100;i++){journal.append({type:'caption',text:`${i}:`+'a'.repeat(300)});accepted++;}},limitError);
  assert.ok(accepted>0&&accepted<100);
  assert.ok(statSync(join(dir,'events.jsonl')).size<=4096);
  assert.equal(journal.read().length,accepted);
});

test('legacy oversized journals are refused by writers and read-only evidence consumers',()=>{
  const dir=directory(),path=join(dir,'events.jsonl');
  const raw=Array.from({length:100},(_,i)=>JSON.stringify({id:i+1,type:'caption',text:'old evidence '.repeat(10)})).join('\n')+'\n';
  writeFileSync(path,raw);
  for(const readOnly of [true,false])assert.throws(()=>new Journal(dir,{readOnly,limits:{journalBytes:4096}}),limitError);
  assert.ok(readFileSync(path,'utf8')===raw,'the existing journal must remain byte-identical');
});

test('the default journal ceiling rejects a large existing file before JSON parsing',()=>{
  const dir=directory(),path=join(dir,'events.jsonl');writeFileSync(path,'');truncateSync(path,17*1024*1024);
  assert.throws(()=>new Journal(dir,{readOnly:true}),limitError);
});

test('legacy oversized caption rows are rejected even inside a small journal',()=>{
  const dir=directory(),path=join(dir,'events.jsonl');
  writeFileSync(path,JSON.stringify({id:1,type:'caption',text:'한'.repeat(23000)})+'\n');
  assert.throws(()=>new Journal(dir,{readOnly:true}),limitError);
});

test('an oversized legacy tail is rejected without repairing or changing the original',()=>{
  const dir=directory(),path=join(dir,'events.jsonl'),raw=JSON.stringify({id:1,type:'caption',text:'한'.repeat(23000)});
  writeFileSync(path,raw);
  assert.throws(()=>new Journal(dir),limitError);
  assert.ok(readFileSync(path,'utf8')===raw,'the rejected tail must remain byte-identical');
});

const image=new PNG({width:100,height:100});image.data.fill(255);const png=PNG.sync.write(image);
const page={evaluate:async()=>({x:0,y:0,width:100,height:100,scale:1}),cdp:async()=>({data:png.toString('base64')})};
test('capture startup distinguishes local evidence from data consumed by the host AI',async()=>{
  const out=directory(),notices=[];
  const source={kind:'event:text-track',read:async()=>({healthy:true,state:{},events:[{seq:1,type:'media-ended'}]}),ack:async()=>{},close:async()=>{}};
  await runCapture({page,out,source,onNotice:notice=>notices.push(notice)});
  const disclosure=notices.find(n=>n.type==='started').dataHandling;
  assert.equal(disclosure.collectorUploads,false);
  assert.ok(disclosure.local.includes('captions'));
  assert.ok(disclosure.hostAI.includes('opened-player-images'));
  assert.ok(disclosure.hostAI.includes('questions-and-answers'));
});

for(const kind of ['event:dom-mutation','aside-accessibility-poll']){
  test(`${kind} refuses oversized captions and reports a recoverable resource stop`,async()=>{
    const out=directory();let closed=false;
    const source={kind,fallbackReason:null,read:async()=>({healthy:true,events:[{type:'caption',seq:1,text:'한'.repeat(6),mediaTime:1}],state:{}}),ack:async()=>{},close:async()=>{closed=true;}};
    const result=await runCapture({page,out,source,durationSec:0.05,pollMs:5,resourceLimits:{captionBytes:16}});
    assert.equal(result.stopReason,'resource-limit');assert.equal(result.completed,false);assert.equal(closed,true);
    assert.equal(existsSync(join(out,'.capture.lock')),false);
    const events=new Journal(out,{readOnly:true}).read();
    assert.equal(events.filter(e=>e.type==='caption').length,0);
    assert.equal(events.at(-1).reason,'resource-limit');
    assert.equal(JSON.parse(readFileSync(join(out,'status.json'),'utf8')).stopReason,'resource-limit');
  });
}

test('small valid caption packets cannot bypass a cumulative capture journal quota',async()=>{
  const out=directory();let seq=0;
  const source={kind:'event:text-track',read:async()=>({healthy:true,hasMore:true,state:{},events:[{seq:++seq,type:'caption',text:`${seq}:`+'x'.repeat(300)}]}),ack:async()=>{},close:async()=>{}};
  const result=await runCapture({page,out,source,durationSec:0.1,resourceLimits:{journalBytes:4096}});
  assert.equal(result.stopReason,'resource-limit');
  const events=new Journal(out,{readOnly:true}).read();
  assert.ok(events.some(e=>e.type==='caption'));assert.equal(events.at(-1).reason,'resource-limit');
  assert.ok(statSync(join(out,'events.jsonl')).size<=4096);
});

test('packet quota rejects many individually valid events before any caption is persisted',async()=>{
  const out=directory();
  const source={kind:'event:text-track',read:async()=>({healthy:true,state:{},events:Array.from({length:8},(_,i)=>({seq:i+1,type:'caption',text:'a'.repeat(200)}))}),ack:async()=>{},close:async()=>{}};
  const result=await runCapture({page,out,source,durationSec:0.03,resourceLimits:{packetBytes:1024}});
  assert.equal(result.stopReason,'resource-limit');
  assert.equal(new Journal(out,{readOnly:true}).read().filter(e=>e.type==='caption').length,0);
});

test('a packet exactly at its inclusive byte budget is accepted',async()=>{
  const out=directory();let acked=false;
  // This single-event JSON array is exactly 39 UTF-8 bytes.
  const source={kind:'event:text-track',read:async()=>({healthy:true,state:{},events:acked?[]:[{type:'caption',seq:1,text:'x'}]}),ack:async()=>{acked=true;},close:async()=>{}};
  const result=await runCapture({page,out,source,durationSec:0.02,pollMs:5,resourceLimits:{packetBytes:39}});
  assert.equal(result.stopReason,'duration-limit');assert.equal(result.captionEvents,1);
});

test('browser metadata cannot bypass event quotas through status serialization',async()=>{
  const out=directory();
  const source={kind:'event:text-track',read:async()=>({healthy:true,rawBytes:'x'.repeat(10000),state:{},events:[]}),ack:async()=>{},close:async()=>{}};
  const result=await runCapture({page,out,source,durationSec:0.02,pollMs:5});
  assert.equal(result.stopReason,'resource-limit');
  assert.ok(statSync(join(out,'status.json')).size<4096);
});

test('shutdown cannot drain an endless stream of empty hasMore packets',async()=>{
  const out=directory();let draining=false,reads=0;
  const source={kind:'event:text-track',read:async()=>({healthy:true,state:{},events:[],hasMore:draining&&++reads<100}),stop:async()=>{draining=true;return {healthy:true,state:{},events:[],hasMore:true};},ack:async()=>{},close:async()=>{}};
  const result=await runCapture({page,out,source,durationSec:0.01,pollMs:5});
  assert.equal(result.stopReason,'resource-limit');assert.ok(reads<100);
});

test('selected image writes also respect the cumulative capture storage budget',async()=>{
  const out=directory();writeFileSync(join(out,'prior-frame.png'),Buffer.alloc(3800));
  const source={kind:'event:text-track',read:async()=>({healthy:true,state:{},events:[]}),ack:async()=>{},close:async()=>{}};
  const result=await runCapture({page,out,source,durationSec:0.15,pollMs:5,frameMs:5,resourceLimits:{sessionBytes:4096}});
  assert.equal(result.stopReason,'resource-limit');assert.equal(result.framesSaved,0);
  assert.equal(readFileSync(join(out,'prior-frame.png')).length,3800);
});
