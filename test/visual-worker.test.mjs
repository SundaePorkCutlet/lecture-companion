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

test('image worker crops viewport coordinates at the observed pixel scale before comparing or publishing',async()=>{
  const image=new PNG({width:240,height:160});image.data.fill(255);
  for(let y=40;y<100;y++)for(let x=20;x<100;x++){const i=(y*240+x)*4;image.data[i]=0;image.data[i+1]=180;image.data[i+2]=0;}
  const processor=new api.VisualWorker(),crop={x:10,y:20,width:40,height:30,viewportWidth:120,viewportHeight:80,pixelRatio:2};
  try{
    const first=await processor.process({png:PNG.sync.write(image),crop}),output=PNG.sync.read(first.png);
    assert.equal(output.width,80);assert.equal(output.height,60);assert.deepEqual([...output.data.subarray(0,4)],[0,180,0,255]);
    image.data[0]=0;
    assert.equal((await processor.process({png:PNG.sync.write(image),crop})).selected,false,'outside-player pixels cannot trigger a new saved frame');
    await assert.rejects(()=>processor.process({png:PNG.sync.write(image),crop:{...crop,x:110}}),/process frame/);
    await assert.rejects(()=>processor.process({png:PNG.sync.write(image),crop:{...crop,pixelRatio:1}}),/process frame/,'a proportional viewport resize must not be accepted as a different DPR');
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
