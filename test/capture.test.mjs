import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from '../vendor/pngjs/lib/png.js';
import * as capture from '../src/ego-capture.mjs';
import {Journal} from '../src/core.mjs';

// Browser evaluations are real in integration tests; these doubles expose only
// a stable selected player and geometry for collector shutdown tests.
const evaluate=async(fn)=>fn.name==='installSnapshotProbe'?{token:'fixture'}:
  fn.name==='snapshotProbeCommand'?{healthy:true}:{x:0,y:0,width:100,height:100,scale:1};

test('ego collection persists captions and PNGs despite the native page screenshot method',async()=>{
  const out=mkdtempSync(join(tmpdir(),'lecture-capture-'));
  const image=new PNG({width:100,height:100});image.data.fill(255);const png=PNG.sync.write(image);
  let n=0;const notices=[];
  const page={
    snapshot:async()=>`root\n  region "video player"\n    video\n    text "${++n<3?'첫 번째 자막':'두 번째 자막'}"`,
    evaluate,
    screenshot:async()=>{throw new TypeError('page.screenshot received unknown option: x');},
    cdp:async()=>({data:png.toString('base64')})
  };
  await capture.runCapture({page,out,captionMode:'snapshot',durationSec:3,pollMs:10,frameMs:20,batchMs:50,onNotice:x=>{
    notices.push(x);
    if(x.type==='batch-ready'&&x.frames===1&&x.captions===2)writeFileSync(join(out,'STOP'),'Observed expected evidence');
  }});
  const events=new Journal(out).read();
  assert.deepEqual(events.filter(e=>e.type==='caption').map(e=>e.text),['첫 번째 자막','두 번째 자막']);
  assert.equal(events.filter(e=>e.type==='frame').length,1);
  assert.equal(events.at(-1).type,'end');
  const status=JSON.parse(readFileSync(join(out,'status.json'),'utf8'));
  assert.equal(status.state,'stopped');assert.ok(status.polls>=3);
  assert.equal(status.modelCalls,0);assert.equal(status.tokenUsage,null);
  assert.ok(!JSON.stringify(notices).includes('region'));
  assert.equal(existsSync(join(out,'.capture.lock')),false);
});

test('observation failure records interruption and stops instead of continuing blind',async()=>{
  const out=mkdtempSync(join(tmpdir(),'lecture-capture-'));
  const page={evaluate,snapshot:async()=>{throw new Error('user took control: https://example.com/?jwt=SECRET');}};
  await assert.rejects(()=>capture.runCapture({page,out,captionMode:'snapshot',durationSec:1}),/Capture stopped/);
  const events=new Journal(out).read();
  assert.equal(events.at(-1).type,'interruption');
  assert.ok(!JSON.stringify(events).includes('SECRET'));
  assert.equal(JSON.parse(readFileSync(join(out,'status.json'),'utf8')).state,'error');
});

test('a delayed final observation is measured even after the duration expires',async()=>{
  const out=mkdtempSync(join(tmpdir(),'lecture-delay-'));
  const image=new PNG({width:100,height:100});image.data.fill(255);
  const page={snapshot:async()=>{await new Promise(r=>setTimeout(r,2100));return 'root\n  region "video player"\n    text "late caption"';},evaluate,cdp:async()=>({data:PNG.sync.write(image).toString('base64')})};
  // Leave time for worker startup under a parallel test run; the read still
  // exceeds this deadline and must be included in the final gap measurement.
  const result=await capture.runCapture({page,out,captionMode:'snapshot',durationSec:1});
  assert.ok(result.maxPollGapMs>=2000);
  assert.equal(new Journal(out,{readOnly:true}).read().filter(e=>e.type==='observation-gap').length,1);
});

test('slow screenshots do not stop caption observations or produce frames after end',async()=>{
  const out=mkdtempSync(join(tmpdir(),'lecture-parallel-'));
  const image=new PNG({width:100,height:100});image.data.fill(255);let n=0;
  const page={snapshot:async()=>`root\n  region "video player"\n    text "caption ${++n}"`,evaluate,
    cdp:async()=>{await new Promise(r=>setTimeout(r,200));return {data:PNG.sync.write(image).toString('base64')};}};
  const result=await capture.runCapture({page,out,captionMode:'snapshot',durationSec:0.25,pollMs:10,frameMs:20});
  assert.ok(result.captionEvents>=10,`observed only ${result.captionEvents} changes`);
  assert.equal(new Journal(out,{readOnly:true}).read().at(-1).type,'end');
  assert.equal(existsSync(join(out,'.capture.lock')),false);
});

test('queued captions retain media times, report overflow, and media end is normal completion',async()=>{
  const out=mkdtempSync(join(tmpdir(),'lecture-events-'));
  const image=new PNG({width:100,height:100});image.data.fill(255);
  const source={kind:'event:dom-mutation',fallbackReason:null,
    read:async()=>({healthy:true,dropped:2,events:[
      {seq:3,type:'caption',text:'A',mediaTime:1,observedAt:'2026-01-01T00:00:01.000Z'},
      {seq:4,type:'caption',text:'',mediaTime:1.1},
      {seq:5,type:'caption',text:'A',mediaTime:1.2},
      {seq:6,type:'caption',text:'B',mediaTime:1.3},
      {seq:7,type:'media-ended',mediaTime:2}],state:{mediaTime:2,ended:true}}),ack:async()=>{},close:async()=>{}};
  const page={evaluate:async()=>({x:0,y:0,width:100,height:100,scale:1}),cdp:async()=>({data:PNG.sync.write(image).toString('base64')})};
  const result=await capture.runCapture({page,out,source,durationSec:1});
  const events=new Journal(out,{readOnly:true}).read();
  assert.deepEqual(events.filter(e=>e.type==='caption').map(e=>[e.text,e.mediaTime]),[['A',1],['A',1.2],['B',1.3]]);
  assert.ok(events.find(e=>e.type==='caption-overflow'&&e.dropped===2));
  assert.ok(events.find(e=>e.type==='caption-clear'&&e.mediaTime===1.1));
  assert.equal(events.at(-1).reason,'media-ended');assert.equal(result.state,'stopped');assert.equal(result.completed,true);
});

test('visual control loss prevents acknowledgment after a pending caption read',async()=>{
  const out=mkdtempSync(join(tmpdir(),'lecture-cancel-'));let acknowledgments=0;
  const source={kind:'event:dom-mutation',fallbackReason:null,
    read:async()=>{await new Promise(r=>setTimeout(r,50));return{healthy:true,state:{},events:[{type:'caption',seq:1,text:'late',mediaTime:1}]};},
    ack:async()=>{acknowledgments++;},close:async()=>{}};
  const page={evaluate:async()=>({x:0,y:0,width:100,height:100,scale:1}),cdp:async()=>{throw new Error('control lost');}};
  await assert.rejects(()=>capture.runCapture({page,out,source,durationSec:1}),/Capture stopped/);
  assert.equal(acknowledgments,0);
});

test('shutdown drains final caption events and closes source before waiting for image work',async()=>{
  const out=mkdtempSync(join(tmpdir(),'lecture-drain-'));let closed=false;
  const image=new PNG({width:100,height:100});image.data.fill(255);
  const source={kind:'event:dom-mutation',fallbackReason:null,
    read:async()=>({healthy:true,state:{},events:[]}),
    stop:async()=>({healthy:true,state:{},events:[{type:'caption',seq:1,text:'last queued subtitle',mediaTime:2}]}),
    ack:async()=>{},close:async()=>{closed=true;}};
  const page={evaluate:async()=>({x:0,y:0,width:100,height:100,scale:1}),
    cdp:async()=>{await new Promise(r=>setTimeout(r,100));assert.equal(closed,true,'caption source must close before slow image finishes');return{data:PNG.sync.write(image).toString('base64')};}};
  const result=await capture.runCapture({page,out,source,durationSec:0.02,pollMs:10});
  assert.equal(result.state,'stopped');assert.ok(closed);
  assert.equal(new Journal(out,{readOnly:true}).read().find(e=>e.type==='caption').text,'last queued subtitle');
});

test('control loss cancels a pending frame before any further screenshot command',async()=>{
  const out=mkdtempSync(join(tmpdir(),'lecture-cancel-'));let screenshots=0;
  const page={snapshot:async()=>{throw new Error('control lost');},evaluate:async(fn)=>{if(fn.name!=='measurePlayer')return evaluate(fn);await new Promise(r=>setTimeout(r,40));return{x:0,y:0,width:100,height:100,scale:1};},
    cdp:async()=>{screenshots++;throw new Error('unexpected browser command');}};
  await assert.rejects(()=>capture.runCapture({page,out,captionMode:'snapshot',durationSec:1}),/Capture stopped/);
  assert.equal(screenshots,0);
  assert.equal(new Journal(out,{readOnly:true}).read().at(-1).type,'interruption');
});

test('a confirmed player transition stops cleanly, drains old captions and reports an incomplete boundary',async()=>{
  const out=mkdtempSync(join(tmpdir(),'lecture-transition-')),notices=[];
  const source={kind:'event:dom-mutation',fallbackReason:null,
    read:async()=>({healthy:false,failure:'media-source-changed',events:[{type:'caption',seq:1,text:'last old-lecture caption',mediaTime:10}]}),
    stop:async()=>({healthy:false,failure:'media-source-changed',events:[{type:'caption',seq:2,text:'queued before transition',mediaTime:11}]}),
    ack:async()=>{},close:async()=>{}};
  const image=new PNG({width:100,height:100});image.data.fill(255);
  const page={evaluate,cdp:async()=>({data:PNG.sync.write(image).toString('base64')})};
  const result=await capture.runCapture({page,out,source,durationSec:1,onNotice:n=>notices.push(n)});
  const events=new Journal(out,{readOnly:true}).read();
  assert.equal(result.state,'stopped');assert.equal(result.stopReason,'player-changed');
  assert.equal(result.completed,false);assert.equal(events.at(-1).reason,'player-changed');
  assert.match(events.at(-1).detail,/not.*complet/i);
  assert.equal(events.filter(e=>e.type==='caption').length,2);
  assert.equal(notices.at(-1).reason,'player-changed');assert.ok(notices.at(-1).actions.length);
});

test('an unknown source failure still errors instead of being called a lecture transition',async()=>{
  const out=mkdtempSync(join(tmpdir(),'lecture-unknown-'));
  const source={kind:'event:dom-mutation',fallbackReason:null,read:async()=>({healthy:false,failure:'caption-source-unavailable',events:[]}),close:async()=>{}};
  const image=new PNG({width:100,height:100});image.data.fill(255);
  await assert.rejects(()=>capture.runCapture({page:{evaluate,cdp:async()=>({data:PNG.sync.write(image).toString('base64')})},out,source,durationSec:1}),/Capture stopped/);
  assert.equal(JSON.parse(readFileSync(join(out,'status.json'),'utf8')).state,'error');
});

test('a snapshot spanning a player change cannot save captions or images from the next lecture',async()=>{
  const out=mkdtempSync(join(tmpdir(),'lecture-snapshot-change-'));let changed=false;
  const image=new PNG({width:100,height:100});image.data.fill(255);
  const page={evaluate:async fn=>fn.name==='snapshotProbeCommand'?{healthy:!changed,failure:changed?'player-changed':null}:evaluate(fn),
    snapshot:async()=>{changed=true;return 'root\n  region "video player"\n    text "NEXT lecture caption"';},
    cdp:async()=>({data:PNG.sync.write(image).toString('base64')})};
  const result=await capture.runCapture({page,out,captionMode:'snapshot',durationSec:1});
  const events=new Journal(out,{readOnly:true}).read();
  assert.equal(result.stopReason,'player-changed');assert.equal(result.completed,false);
  assert.equal(events.filter(e=>['caption','frame'].includes(e.type)).length,0);
  assert.ok(!JSON.stringify(events).includes('NEXT'));
});

test('event capture rejects a frame when the media source changes during the screenshot',async()=>{
  const out=mkdtempSync(join(tmpdir(),'lecture-event-frame-change-'));let changed=false,acked=false;
  const image=new PNG({width:100,height:100});image.data.fill(255);
  const page={evaluate:async(fn,arg)=>{
    if(fn.name==='installCaptionProbe')return {available:true,source:'dom-mutation',token:'fixture'};
    if(fn.name==='captionProbeCommand'){
      if(arg.action==='ack'){acked=true;return true;}if(arg.action==='close')return true;
      return {healthy:!changed,failure:changed?'media-source-changed':null,events:acked?[]:[{seq:1,type:'caption',text:'old lecture',mediaTime:1}]};
    }
    return evaluate(fn);
  },cdp:async()=>{changed=true;return {data:PNG.sync.write(image).toString('base64')};}};
  const result=await capture.runCapture({page,out,durationSec:3,pollMs:500});
  assert.equal(result.stopReason,'player-changed');assert.equal(result.framesSaved,0);
  assert.equal(new Journal(out,{readOnly:true}).read().filter(e=>e.type==='frame').length,0);
});
