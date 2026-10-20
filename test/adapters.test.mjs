import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import * as adapter from '../src/snapshot.mjs';
import * as visual from '../src/visual.mjs';

test('extract only captions in the video region, excluding course chrome and controls',()=>{
  const s=`root
  text "unrelated private page"
  iframe [ref=22]
    root
      region "video player" [ref=23]
        video [ref=24]
        text "Pod는 실행 단위입니다."
        button "일시정지" [ref=25]
          text "일시정지"
        group
          text "0:00:31"
          slider "progress bar"
  text "course title"`;
  assert.deepEqual(adapter.parseSnapshot(s),{caption:'Pod는 실행 단위입니다.',mediaTime:null,playerFound:true,paused:false});
  assert.equal(adapter.parseSnapshot('root\n  text "some page"').playerFound,false);
  assert.throws(()=>adapter.parseSnapshot('root\n  region "video player"\n  region "video player"'),/one video player/i);
});

test('visual gate ignores cursor noise, requires stable visual change and suppresses duplicates',()=>{
  const gate=new visual.VisualGate({changedFraction:0.01,stableSamples:2});
  const white=Buffer.alloc(10000,255),cursor=Buffer.from(white),slide=Buffer.from(white);
  cursor.fill(0,1,8);slide.fill(0,0,3000);
  assert.equal(gate.observe(white),true);
  assert.equal(gate.observe(cursor),false);
  assert.equal(gate.observe(slide),false);
  assert.equal(gate.observe(slide),true);
  assert.equal(gate.observe(slide),false);
});

test('cropping excludes subtitles and controls from comparison and stored image',async()=>{
  const image=new PNG({width:100,height:100});image.data.fill(255);image.data.fill(0,100*80*4);
  const input=PNG.sync.write(image);
  const result=await visual.prepareFrame(input);
  assert.equal(PNG.sync.read(result.png).height,80);
  assert.ok(result.pixels.every(v=>v===255));
});
