import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from '../vendor/pngjs/lib/png.js';
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

test('Aside snapshot reads collapsed text leaves as well as text nodes, excluding inline controls and page metadata',()=>{
  const snapshot='- title: "private page" [url=https://secret/]\n- region "video player" [ref=e1]:\n  - generic [ref=e2]: "Pod는 \\"배포\\" 단위"\n  - paragraph [ref=e3]: "두 번째 자막"\n  - button "Pause" [ref=e4]: "control label"\n  - group [ref=e5]:\n    - text: "0:00:31"\n  - text: "끝"';
  assert.deepEqual(adapter.parseAsideSnapshot(snapshot),{caption:'Pod는 "배포" 단위 두 번째 자막 끝',mediaTime:null,playerFound:true,paused:null});
});

test('Aside caption text preserves literal backslashes used in code and paths',()=>{
  assert.equal(adapter.parseAsideSnapshot('- generic [ref=e2]: "C:\\temp\\notes \\d+"').caption,'C:\\temp\\notes \\d+');
});

test('Aside snapshot reads text merged into native leaf names without repeating named parent text',()=>{
  const tree='- region "video player" [ref=e1]:\n  - generic "merged subtitle" [ref=e2]\n  - paragraph "parent subtitle" [ref=e3]:\n    - text: "parent subtitle"\n  - button "Pause" [ref=e4]\n  - heading "lesson topic" [ref=e5] [level=2]';
  assert.equal(adapter.parseAsideSnapshot(tree).caption,'merged subtitle parent subtitle lesson topic');
});

test('Aside snapshot discards orphan frame trees outside the selected player',()=>{
  const tree='- region "video player" [ref=e1]:\n  - text: "authorized subtitle"\n- iframe (other.example):\n  - generic [ref=f2e1]: "PRIVATE sibling content"\n- iframe [ref=e5]:\n  - text: "selected frame subtitle"\n  - iframe (nested-orphan.example):\n    - text: "PRIVATE nested content"';
  assert.equal(adapter.parseAsideSnapshot(tree).caption,'authorized subtitle selected frame subtitle');
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

test('comparison ignores subtitles while saved player image retains bottom content',async()=>{
  const image=new PNG({width:100,height:100});image.data.fill(255);image.data.fill(0,100*80*4);
  const input=PNG.sync.write(image);
  const result=await visual.prepareFrame(input);
  assert.equal(PNG.sync.read(result.png).height,100);
  assert.equal(PNG.sync.read(result.png).data[100*90*4],0);
  assert.ok(result.pixels.every(v=>v===255));
});
