import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCaptionSource} from '../src/caption-source.mjs';

test('unavailable event source is explicit fallback, while event-only mode refuses it',async()=>{
  const page={evaluate:async fn=>fn.name==='installCaptionProbe'?{available:false,reason:'cross-origin-frame'}:fn.name==='installSnapshotProbe'?{token:'fixture'}:{healthy:true},snapshot:async()=>'root\n  region "video player"\n    text "visible caption"'};
  const source=await createCaptionSource(page,{selector:'iframe'});
  assert.equal(source.kind,'ego-accessibility-poll');assert.equal(source.fallbackReason,'cross-origin-frame');
  assert.equal((await source.read()).events[0].text,'visible caption');
  await assert.rejects(()=>createCaptionSource(page,{selector:'iframe',captionMode:'event'}),/unavailable.*cross-origin/);
});

test('browser evaluation failure propagates instead of pretending snapshot fallback is authorized',async()=>{
  const page={evaluate:async()=>{throw new Error('control lost');}};
  await assert.rejects(()=>createCaptionSource(page,{selector:'video'}),/control lost/);
});

test('Aside snapshots cannot bypass a caller-lowered raw snapshot budget',async()=>{
  const page={snapshotKind:'aside-accessibility-poll',evaluate:async fn=>fn.name==='installSnapshotProbe'?{token:'fixture'}:{healthy:true},
    readCaptionSnapshot:async()=>({state:{caption:'small',playerFound:true,mediaTime:null},rawBytes:2048})};
  const source=await createCaptionSource(page,{selector:'video',captionMode:'snapshot',limits:{snapshotBytes:16}});
  await assert.rejects(()=>source.read(),error=>error.code==='RESOURCE_LIMIT');
});
