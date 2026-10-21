// Explicit opt-in: a running, connected Aside profile and its CLI are required.
// This opens only synthetic localhost fixtures and closes only those tabs.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {AsideClient,connectAsidePage} from '../src/aside-browser.mjs';
import {runCapture} from '../src/ego-capture.mjs';
import {Journal} from '../src/core.mjs';
import {createCaptionSource} from '../src/caption-source.mjs';
import {capturePlayerFrame} from '../src/player-frame.mjs';
import {PNG} from '../vendor/pngjs/lib/png.js';
import {VisualWorker} from '../src/visual-worker.mjs';

const html=readFileSync(new URL('fixtures/player.html',import.meta.url));
const root=process.env.LECTURE_ASIDE_TEST_OUT?resolve(process.env.LECTURE_ASIDE_TEST_OUT):mkdtempSync(join(tmpdir(),'lecture-aside-native-'));
if(process.env.LECTURE_ASIDE_TEST_OUT)mkdirSync(root,{mode:0o700});
let innerPort;
const serve=(req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(req.url==='/crop')res.end('<!doctype html><style>body{margin:0;background:rgb(210,0,0);height:1800px}#player{position:absolute;left:80px;top:120px;width:320px;height:240px;background:rgb(0,180,0)}</style><div id="player" role="region" aria-label="video player">SELECTED REGION</div>');
  else if(req.url==='/cross')res.end(`<!doctype html><title>Local cross-origin fixture</title><p>OUTSIDE PLAYER MUST NOT BE CAPTURED</p><iframe id="player" width="700" height="500" src="http://127.0.0.1:${innerPort}/"></iframe><iframe width="200" height="30" src="http://127.0.0.1:${innerPort}/private"></iframe>`);
  else if(req.url==='/private')res.end('<p>PRIVATE SIBLING FRAME MUST NOT BE CAPTURED</p>');
  else res.end(html);
};
const server=createServer(serve),inner=createServer(serve);
await new Promise(r=>inner.listen(0,'127.0.0.1',r));innerPort=inner.address().port;
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const options={account:process.env.LECTURE_ASIDE_ACCOUNT,profile:process.env.LECTURE_ASIDE_PROFILE},client=new AsideClient(options);
const sessions=[],targets=new Set(),summary={ok:false,out:root,browser:'aside'};
const open=async(path='/')=>{
  const targetId=await client.json(`(async()=>{const p=await openTab(${JSON.stringify(`http://127.0.0.1:${server.address().port}${path}`)});return p.targetId;})()`);
  targets.add(targetId);const session=await connectAsidePage({...options,targetId});sessions.push(session);return {...session,targetId};
};
const fixtureJson=(dir,name,value)=>{const path=join(dir,name);writeFileSync(path,JSON.stringify(value),{mode:0o600});return path;};
const launcher=fileURLToPath(new URL('../bin/lecture',import.meta.url));
const env={...process.env,PATH:'/usr/bin:/bin'};
const cli=(...args)=>{
  const result=spawnSync('/bin/sh',[launcher,...args],{env,encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
};
const waitForCaption=async out=>{
  const until=Date.now()+5000;
  while(Date.now()<until){
    const batch=cli('batch','--out',out,'--bytes','12000'),event=batch.events.find(e=>e.type==='caption'&&e.text.startsWith('강의'));
    if(event)return event;
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error('Native CLI did not capture the scheduled subtitle');
};
let activeChild,activeCompletion,activeOut;
try{
  await client.start();
  const cropPage=await open('/crop');summary.crops=[];
  for(const scroll of [0,80]){
    await cropPage.page.evaluate(y=>{window.scrollTo(0,y);return scrollY;},scroll);
    const dir=join(root,`crop-${scroll}`);
    const cropped=await runCapture({page:cropPage.page,out:dir,browser:'aside',selector:'#player',captionMode:'snapshot',durationSec:10,pollMs:200,frameMs:400,batchMs:100,
      onNotice:n=>{if(n.type==='batch-ready'&&n.frames>0)writeFileSync(join(dir,'STOP'),'Observed cropped fixture frame\n');}});
    const event=new Journal(dir,{readOnly:true}).read().find(e=>e.type==='frame');assert.ok(event);
    const img=PNG.sync.read(readFileSync(join(dir,event.file)));
    for(const [x,y]of [[0,0],[img.width-1,0],[0,img.height-1],[img.width-1,img.height-1]]){
      const i=(y*img.width+x)*4;assert.ok(img.data[i+1]>img.data[i]+50&&img.data[i+1]>img.data[i+2]+50,'Saved image includes pixels outside the selected green player');
    }
    summary.crops.push({scroll,frames:cropped.framesSaved,width:img.width,height:img.height});
  }
  let session=await open(),out=join(root,'dom');
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
  const verifier=new VisualWorker();
  try{const verified=await verifier.process(await capturePlayerFrame(session.page,'#player'));assert.ok(PNG.sync.read(verified.png).width>=640);}
  finally{await verifier.close();}
  const snapshot=await createCaptionSource(session.page,{selector:'#player',captionMode:'snapshot'});
  assert.match((await snapshot.read()).events[0].text,/C/);await snapshot.close();
  summary.dom={adapter:status.adapter,captions:status.captionEvents,frames:status.framesSaved};

  session=await open();out=join(root,'text-track');
  await session.page.evaluate(()=>window.prepareVideo());
  const trackReady=new Promise(r=>announce=r);
  const trackCapture=runCapture({page:session.page,out,browser:'aside',selector:'#player',captionMode:'event',durationSec:8,pollMs:100,frameMs:200,
    onNotice:notice=>{if(notice.type==='started')announce();}});
  await Promise.race([trackReady,trackCapture.then(()=>{throw new Error('Track capture ended before readiness');})]);
  await session.page.evaluate(async()=>{
    const video=document.querySelector('video');await video.play();
    setTimeout(()=>video.pause(),120);setTimeout(()=>{video.playbackRate=1.5;void video.play();},220);return true;
  });
  const tracks=await trackCapture,trackEvents=new Journal(out,{readOnly:true}).read();
  assert.equal(tracks.adapter,'event:text-track');
  assert.deepEqual(trackEvents.filter(e=>e.type==='caption').map(e=>e.text),['cue one','cue two','cue three']);
  assert.ok(trackEvents.some(e=>e.type==='playback'&&e.action==='pause'));
  assert.ok(trackEvents.some(e=>e.type==='playback'&&e.action==='ratechange'&&e.playbackRate===1.5));
  assert.equal(trackEvents.at(-1).reason,'media-ended');
  summary.textTrack={adapter:tracks.adapter,captions:tracks.captionEvents,frames:tracks.framesSaved,end:trackEvents.at(-1).reason};

  session=await open('/cross');out=join(root,'cross-origin');
  const cross=await runCapture({page:session.page,out,browser:'aside',selector:'#player',durationSec:3,pollMs:200,frameMs:500});
  const crossEvents=new Journal(out,{readOnly:true}).read(),captions=crossEvents.filter(e=>e.type==='caption');
  assert.equal(cross.adapter,'aside-accessibility-poll');assert.equal(cross.fallbackReason,'cross-origin-frame');
  assert.ok(captions.some(e=>e.text.includes('initial')));assert.ok(captions.every(e=>e.mediaTime===null));
  assert.ok(!JSON.stringify(crossEvents).includes('PRIVATE SIBLING'));assert.ok(!JSON.stringify(crossEvents).includes('OUTSIDE PLAYER'));
  summary.crossOrigin={adapter:cross.adapter,fallbackReason:cross.fallbackReason,captions:cross.captionEvents,frames:cross.framesSaved};

  session=await open();out=join(root,'public-cli');
  const captureArgs=['capture','--browser','aside','--tab',session.targetId,'--selector','#player','--caption-selector','#caption','--caption-mode','event','--duration','8','--out',out];
  if(options.account)captureArgs.push('--account',options.account);if(options.profile)captureArgs.push('--profile',options.profile);
  const child=spawn('/bin/sh',[launcher,...captureArgs],{env,stdio:['ignore','pipe','pipe']});activeChild=child;activeOut=out;
  let output='',errors='',readyResolve,readyReject;
  const ready=new Promise((r,j)=>{readyResolve=r;readyReject=j;}),completed=new Promise((r,j)=>{child.once('exit',(code,signal)=>r({code,signal}));child.once('error',j);});
  activeCompletion=completed.catch(()=>{});
  child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.split('\n').some(line=>{try{return JSON.parse(line).type==='started';}catch{return false;}}))readyResolve();});
  child.stderr.on('data',chunk=>{errors+=chunk.toString();});child.once('error',readyReject);
  const startup=setTimeout(()=>readyReject(new Error('Public capture did not announce readiness')),15000);
  try{await Promise.race([ready,completed.then(()=>{throw new Error('Public capture ended before readiness');})]);}finally{clearTimeout(startup);}
  await session.page.evaluate(()=>{void window.captionSeries(['강의 A','강의 B','강의 C','강의 D'],800);return true;});
  const caption=await waitForCaption(out);
  cli('study','init','--out',out);const pending=cli('study','next','--out',out,'--bytes','12000');
  const before=readFileSync(join(out,'study.json'),'utf8'),context=cli('study','context','--out',out,'--bytes','12000');
  const payload={key:'native-aside-question',context,question:{text:'질문을 저장하는 동안에도 Aside 수집이 계속되는가?',evidence:[caption.id]},answer:{text:'수집기와 독립된 Q&A 저장소를 사용하며, 이 테스트에서 이후 자막 수집과 미처리 작업 보존을 확인한다.',evidence:[caption.id]}};
  cli('study','qa','--out',out,'--file',fixtureJson(out,'qa-input.json',payload));
  assert.equal(readFileSync(join(out,'study.json'),'utf8'),before);assert.deepEqual(cli('study','next','--out',out),pending);
  const exited=await completed;activeChild=null;assert.equal(exited.code,0,errors);
  const observed=new Journal(out,{readOnly:true}).read();assert.ok(observed.at(-1).id>context.capturedThrough);
  assert.ok(observed.some(e=>e.type==='caption'&&e.text==='강의 D'));
  let batch=cli('study','next','--out',out),n=0;
  while(batch.receipt){
    const items=batch.events.filter(e=>e.type==='caption').map(e=>({key:`observed-${e.id}`,kind:'lecture',text:`합성 테스트 자막: ${e.text}`,evidence:[e.id]}));
    const commit={key:`native-batch-${n++}`,receipt:batch.receipt,items,dispositions:batch.events.map(e=>e.type==='caption'?{eventId:e.id,action:'noted',itemKeys:[`observed-${e.id}`]}:{eventId:e.id,action:'reviewed',reason:`Native fixture ${e.type} record inspected.`})};
    cli('study','commit','--out',out,'--file',fixtureJson(out,`commit-${n}.json`,commit));batch=cli('study','next','--out',out);
  }
  const exported=cli('study','export','--out',out),notes=JSON.parse(readFileSync(exported.jsonPath,'utf8'));
  assert.equal(notes.sideChatQa.length,1);assert.equal(notes.coverage.committedThrough,observed.at(-1).id);
  assert.match(readFileSync(exported.notesPath,'utf8'),/질문을 저장하는 동안에도 Aside 수집/);assert.equal(existsSync(join(out,'.capture.lock')),false);
  summary.publicCli={provider:cli('doctor').runtime.provider,capturedThrough:observed.at(-1).id,qaSavedWhileCapturing:true,pendingReceiptPreserved:true,notesPath:exported.notesPath};
  assert.equal(summary.publicCli.provider,'aside');
  summary.ok=true;writeFileSync(join(root,'validation.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(summary));
}finally{
  if(activeChild&&activeChild.exitCode===null&&activeChild.signalCode===null){
    if(existsSync(activeOut))writeFileSync(join(activeOut,'STOP'),'Fixture cleanup\n',{mode:0o600});else activeChild.kill();
    const grace=setTimeout(()=>activeChild.kill('SIGKILL'),3000);
    try{await activeCompletion;}finally{clearTimeout(grace);}
  }
  for(const session of sessions)await session.close();
  if(!client.failure)for(const id of targets)await client.json(`(async()=>{await closeTab(getTabByTargetId(${JSON.stringify(id)}));return true;})()`).catch(()=>{});
  await client.close();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>inner.close(r))]);
}
