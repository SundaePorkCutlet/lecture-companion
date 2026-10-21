// Opt-in native ego verification. Uses only the bundled self-authored sample.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serveDemo} from '../src/demo.mjs';

const demo=await serveDemo(),out=mkdtempSync(join(tmpdir(),'lecture-v010-native-'));
const parent=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<iframe id="player" width="740" height="540" src="${demo.url}"></iframe>`);});
await new Promise(r=>parent.listen(0,'127.0.0.1',r));
const base=new URL('../',import.meta.url).href;
const space=process.env.LECTURE_TEST_SPACE?Number(process.env.LECTURE_TEST_SPACE):`Lecture Companion release verification ${Date.now()}`;
const script=`
const assert=(await import('node:assert/strict')).default;
const {readFileSync,writeFileSync}=await import('node:fs');
const {runCapture}=await import(${JSON.stringify(new URL('src/ego-capture.mjs',base).href)});
const {createCaptionSource}=await import(${JSON.stringify(new URL('src/caption-source.mjs',base).href)});
const {StudySession}=await import(${JSON.stringify(new URL('src/study-session.mjs',base).href)});
const {Journal}=await import(${JSON.stringify(new URL('src/core.mjs',base).href)});
const task=await taskSpace(${JSON.stringify(space)}),page=task.page('p1');
console.log(JSON.stringify({spaceId:task.spaceId,out:${JSON.stringify(out)}}));
const common={page,imageNode:${JSON.stringify(process.execPath)},pollMs:100,frameMs:500,durationSec:20,selector:'#player'};
await page.goto(${JSON.stringify(demo.url)});await page.waitForSelector('#caption');
const dir=${JSON.stringify(join(out,'sample'))};
let ready;const started=new Promise(r=>ready=r);
const capturing=runCapture({...common,out:dir,captionSelector:'#caption',onNotice:n=>{if(n.type==='started')ready();}});
await Promise.race([started,capturing.then(()=>{throw new Error('Capture ended before readiness');})]);
await page.evaluate(async()=>{const v=document.querySelector('video');v.playbackRate=4;await v.play();});
const sample=await capturing,events=new Journal(dir,{readOnly:true}).read();
assert.equal(sample.stopReason,'media-ended');assert.equal(sample.completed,true);assert.equal(sample.captionEvents,6);assert.ok(sample.framesSaved>=2);
const study=new StudySession(dir);study.init();
const context=study.context(),caption=events.find(e=>e.type==='caption'&&e.text.includes('does not rebuild'));
study.qa({key:'synthetic-demo-qa',context,question:{text:'SYNTHETIC TEST: does docker cp rebuild the original image?',evidence:[caption.id]},answer:{text:'SYNTHETIC TEST: no; the sample says copying into an existing container does not rebuild the original image.',evidence:[caption.id]}});
for(;;){const batch=study.next();if(!batch.receipt)break;
const items=batch.events.filter(e=>e.type==='caption').map(e=>({key:'sample-'+e.id,kind:'lecture',text:e.text,evidence:[e.id]}));
study.commit({key:'batch-'+batch.nextCursor,receipt:batch.receipt,items,dispositions:batch.events.map(e=>e.type==='caption'?{eventId:e.id,action:'noted',itemKeys:['sample-'+e.id]}:{eventId:e.id,action:'reviewed',reason:'Synthetic fixture metadata or image inspected by test.'})});}
const exported=study.export();assert.match(readFileSync(exported.notesPath,'utf8'),/SYNTHETIC TEST/);
await page.goto(${JSON.stringify(`http://127.0.0.1:${parent.address().port}/`)});await page.waitForSelector('iframe');
const transitionDir=${JSON.stringify(join(out,'transition'))};
let nextReady;const transitionStarted=new Promise(r=>nextReady=r);
const transitionCapture=runCapture({...common,out:transitionDir,onNotice:n=>{if(n.type==='started')nextReady();}});
await Promise.race([transitionStarted,transitionCapture.then(()=>{throw new Error('Transition ended before readiness');})]);
await page.waitForFunction(()=>!!window.__lectureCompanionSnapshotV1);
await page.evaluate(next=>{setTimeout(()=>{document.querySelector('#player').src=next;},1200);},${JSON.stringify(demo.url+'?next')});
const transition=await transitionCapture;
assert.equal(transition.fallbackReason,'cross-origin-frame');assert.equal(transition.stopReason,'player-changed');assert.equal(transition.completed,false);
assert.ok(transition.captionEvents>=1);assert.ok(transition.framesSaved>=1);
await page.goto(${JSON.stringify(demo.url)});await page.waitForSelector('#caption');
const source=await createCaptionSource(page,{selector:'#player',captionMode:'snapshot'});await source.read();
await page.goto('about:blank');await assert.rejects(()=>source.read());
const summary={ok:true,sample:{captions:sample.captionEvents,frames:sample.framesSaved,stopReason:sample.stopReason,testPlaybackRate:4,qa:'synthetic fixture, not a human chat',notes:exported.notesPath},transition:{captions:transition.captionEvents,frames:transition.framesSaved,stopReason:transition.stopReason,completed:transition.completed},missingProbeRejected:true};
writeFileSync(${JSON.stringify(join(out,'validation.json'))},JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
await task.finish({keep:[]});
`;
try{
  const child=spawn('ego-browser',['nodejs'],{stdio:['pipe','inherit','inherit']});child.stdin.end(script);
  process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
}finally{await demo.close();await new Promise(r=>parent.close(r));}
