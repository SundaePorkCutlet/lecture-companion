// Explicit opt-in: a running, connected Aside profile and its CLI are required.
// This opens only synthetic localhost fixtures and closes only those tabs.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AsideClient,connectAsidePage} from '../src/aside-browser.mjs';
import {runCapture} from '../src/ego-capture.mjs';
import {Journal} from '../src/core.mjs';
import {createCaptionSource} from '../src/caption-source.mjs';
import {capturePlayerFrame} from '../src/player-frame.mjs';
import {PNG} from '../vendor/pngjs/lib/png.js';

const html=readFileSync(new URL('fixtures/player.html',import.meta.url));
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const options={account:process.env.LECTURE_ASIDE_ACCOUNT,profile:process.env.LECTURE_ASIDE_PROFILE},client=new AsideClient(options);
let targetId,session;
try{
  await client.start();
  targetId=await client.json(`(async()=>{const p=await openTab(${JSON.stringify(`http://127.0.0.1:${server.address().port}/`)});return p.targetId;})()`);
  session=await connectAsidePage({...options,targetId});
  const out=mkdtempSync(join(tmpdir(),'lecture-aside-native-'));
  let announce;const started=new Promise(r=>announce=r);
  const capturing=runCapture({page:session.page,out,browser:'aside',selector:'#player',captionSelector:'#caption',captionMode:'event',durationSec:3,pollMs:100,frameMs:400,
    onNotice:notice=>{if(notice.type==='started')announce();}});
  // Do not leave an unobserved capture rejection while waiting for readiness.
  await Promise.race([started,capturing.then(()=>{throw new Error('Capture ended before readiness');})]);
  await session.page.evaluate(()=>{void window.captionSeries(['A','','A','B','C'],25);return true;});
  const status=await capturing,events=new Journal(out,{readOnly:true}).read();
  assert.equal(status.browser,'aside');assert.equal(status.adapter,'event:dom-mutation');
  assert.deepEqual(events.filter(e=>e.type==='caption').map(e=>e.text),['initial','A','A','B','C']);
  assert.ok(events.some(e=>e.type==='caption-clear'));assert.ok(status.framesSaved>=1);assert.equal(status.state,'stopped');
  const png=await capturePlayerFrame(session.page,'#player');assert.ok(PNG.sync.read(png).width>=640);
  const snapshot=await createCaptionSource(session.page,{selector:'#player',captionMode:'snapshot'});
  assert.match((await snapshot.read()).events[0].text,/C/);await snapshot.close();
  console.log(JSON.stringify({ok:true,out,browser:'aside',adapter:status.adapter,captions:status.captionEvents,frames:status.framesSaved,modelCalls:status.modelCalls}));
}finally{
  await session?.close();
  if(targetId&&!client.failure)await client.json(`(async()=>{await closeTab(getTabByTargetId(${JSON.stringify(targetId)}));return true;})()`).catch(()=>{});
  await client.close();await new Promise(r=>server.close(r));
}
