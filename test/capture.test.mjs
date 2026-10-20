import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import * as capture from '../src/ego-capture.mjs';
import {Journal} from '../src/core.mjs';

test('collector persists actual caption changes and frames without sending raw snapshots',async()=>{
  const out=mkdtempSync(join(tmpdir(),'lecture-capture-'));
  const image=new PNG({width:100,height:100});image.data.fill(255);const png=PNG.sync.write(image);
  let n=0;const notices=[];
  const page={
    snapshot:async()=>`root\n  region "video player"\n    video\n    text "${++n<3?'첫 번째 자막':'두 번째 자막'}"`,
    evaluate:async()=>({x:0,y:0,width:100,height:100,scale:1}),
    cdp:async()=>({data:png.toString('base64')})
  };
  await capture.runCapture({page,out,durationSec:0.09,pollMs:10,frameMs:20,batchMs:50,onNotice:x=>notices.push(x)});
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
  const page={snapshot:async()=>{throw new Error('user took control: https://example.com/?jwt=SECRET');}};
  await assert.rejects(()=>capture.runCapture({page,out,durationSec:1}),/Capture stopped/);
  const events=new Journal(out).read();
  assert.equal(events.at(-1).type,'interruption');
  assert.ok(!JSON.stringify(events).includes('SECRET'));
  assert.equal(JSON.parse(readFileSync(join(out,'status.json'),'utf8')).state,'error');
});

test('a delayed final observation is measured even after the duration expires',async()=>{
  const out=mkdtempSync(join(tmpdir(),'lecture-delay-'));
  const image=new PNG({width:100,height:100});image.data.fill(255);
  const page={snapshot:async()=>{await new Promise(r=>setTimeout(r,2100));return 'root\n  region "video player"\n    text "late caption"';},evaluate:async()=>({x:0,y:0,width:100,height:100,scale:1}),cdp:async()=>({data:PNG.sync.write(image).toString('base64')})};
  const result=await capture.runCapture({page,out,durationSec:0.01});
  assert.ok(result.maxPollGapMs>=2000);
  assert.equal(new Journal(out,{readOnly:true}).read().filter(e=>e.type==='observation-gap').length,1);
});
