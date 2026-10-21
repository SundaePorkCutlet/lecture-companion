import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from '../vendor/pngjs/lib/png.js';
import * as api from '../src/visual-worker.mjs';

test('real image worker preserves full image and filters duplicate frames',async()=>{
  const image=new PNG({width:200,height:120});image.data.fill(255);
  const processor=new api.VisualWorker();
  try{
    const first=await processor.process(PNG.sync.write(image));
    assert.equal(first.selected,true);assert.equal(PNG.sync.read(Buffer.from(first.png)).height,120);
    assert.equal((await processor.process(PNG.sync.write(image))).selected,false);
  }finally{await processor.close();}
});

test('worker crash rejects pending work and never leaves a waiter hanging',async()=>{
  const workerURL=new URL('./fixtures/worker-crash.mjs',import.meta.url);
  const processor=new api.VisualWorker({workerURL});
  try{await assert.rejects(()=>processor.process(Buffer.alloc(1)),/worker/i);}
  finally{await processor.close();}
});

test('a stalled worker times out and bounded backpressure rejects a second pending image',async()=>{
  const workerURL=new URL('./fixtures/worker-stall.mjs',import.meta.url);
  const processor=new api.VisualWorker({workerURL,timeoutMs:100});
  try{
    const pending=processor.process(Buffer.alloc(1));
    await assert.rejects(()=>processor.process(Buffer.alloc(1)),/busy/i);
    await assert.rejects(()=>pending,/timed out/i);
  }finally{await processor.close();}
});
