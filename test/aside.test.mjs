import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,symlinkSync,readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PNG} from '../vendor/pngjs/lib/png.js';
import {AsideClient,connectAsidePage,listAsideTabs,findAsideCommand} from '../src/aside-browser.mjs';
import {capturePlayerFrame} from '../src/player-frame.mjs';
import {createCaptionSource} from '../src/caption-source.mjs';
import {VisualWorker} from '../src/visual-worker.mjs';

const quote=s=>`'${s.replace(/'/g,"'\\''")}'`;
function command(){
  const dir=mkdtempSync(join(tmpdir(),"lecture Aside ' ")),path=join(dir,'aside');
  writeFileSync(path,`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fileURLToPath(new URL('fixtures/aside-mcp.mjs',import.meta.url)))} "$@"\n`,{mode:0o700});return path;
}

test('Aside MCP lists without attaching, pins the selected tab and evaluates quoted Unicode arguments',async()=>{
  const cli=command(),tabs=await listAsideTabs({command:cli});
  assert.equal(tabs[0].targetId,'lecture-1');assert.equal(tabs[1].active,true);
  const session=await connectAsidePage({command:cli,targetId:'lecture-1'});
  try{
    assert.equal(await session.page.evaluate(x=>x,"자막 ' ${literal} ` ;"),"자막 ' ${literal} ` ;");
    await assert.rejects(()=>connectAsidePage({command:cli,targetId:'absent'}),/tab|target/i);
  }finally{await session.close();}
  assert.notEqual(session.client.child.exitCode===null&&session.client.child.signalCode===null,true);
});

test('Aside snapshot fallback scopes to the selected player and excludes control labels',async()=>{
  const session=await connectAsidePage({command:command(),targetId:'lecture-1'});
  try{
    const source=await createCaptionSource(session.page,{selector:'#player',captionMode:'snapshot'});
    assert.equal(source.kind,'aside-accessibility-poll');
    const packet=await source.read();assert.equal(packet.events[0].text,'Pod is a deployment unit');assert.equal(packet.state.mediaTime,null);
  }finally{await session.close();}
});

test('Aside frame capture uses PNG screenshot without CDP, while transport failure closes pending work without secrets',async()=>{
  const session=await connectAsidePage({command:command(),targetId:'lecture-1'});
  const worker=new VisualWorker();
  try{
    const frame=await worker.process(await capturePlayerFrame(session.page,'#player'));
    const img=PNG.sync.read(frame.png);assert.equal(img.width,120);assert.equal(img.height,100);
    assert.deepEqual([...img.data.subarray(0,4)],[0,180,0,255]);
    await assert.rejects(()=>session.page.evaluate(()=>{throw new Error('lost');}),error=>!error.message.includes('PRIVATE')&&/Aside/.test(error.message));
    await assert.rejects(()=>session.page.evaluate(()=>true),/Aside/);
  }finally{await worker.close();await session.close();}
});

test('Aside discovery honors explicit CLI and finds an app-managed CLI outside PATH',()=>{
  const root=mkdtempSync(join(tmpdir(),'aside-discovery-')),path=join(root,'aside');writeFileSync(path,'#!/bin/sh\nexit 0\n',{mode:0o700});
  assert.equal(findAsideCommand({LECTURE_ASIDE:path,PATH:'/nonexistent',HOME:root}),path);
  assert.throws(()=>findAsideCommand({LECTURE_ASIDE:join(root,'missing'),HOME:root}),/LECTURE_ASIDE/);
  const home=mkdtempSync(join(tmpdir(),'aside-home-'));
  const installed=join(home,'.aside/cli/Aside CLI.app/Contents/MacOS/aside');mkdirSync(join(installed,'..'),{recursive:true});writeFileSync(installed,'#!/bin/sh\nexit 0\n',{mode:0o700});
  assert.equal(findAsideCommand({HOME:home,PATH:'/nonexistent'}),installed);
});

test('Aside refuses a frame when viewport resize or scrolling changes geometry during screenshot',async()=>{
  for(const change of ['resize','scroll']){
    const session=await connectAsidePage({command:command(),targetId:'lecture-1'});
    try{
      await session.page.evaluate(change=>{globalThis.fixtureScreenshotChange=change;return true;},change);
      await assert.rejects(()=>capturePlayerFrame(session.page,'#player'),/geometry changed/);
    }finally{await session.close();}
  }
});

test('Aside serializes persistent REPL calls so a frame cannot collide with subtitle reads',async()=>{
  const client=new AsideClient({command:command()});
  try{
    await client.start();
    const values=await Promise.all([client.json('(async()=>{await new Promise(r=>setTimeout(r,40));return "frame";})()'),client.json('"caption"')]);
    assert.deepEqual(values,['frame','caption']);
  }finally{await client.close();}
});

test('an unresponsive Aside MCP process times out and is terminated on close',async()=>{
  const root=mkdtempSync(join(tmpdir(),'aside-stall-')),path=join(root,'aside');
  writeFileSync(path,`#!/bin/sh\nexec ${quote(process.execPath)} -e 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'\n`,{mode:0o700});
  const client=new AsideClient({command:path,timeoutMs:100});
  try{await assert.rejects(()=>client.start(),/timed out/);await assert.rejects(()=>client.json('true'),/timed out/);}
  finally{await client.close();}
  assert.ok(client.child.exitCode!==null||client.child.signalCode!==null);
});

test('public Aside capture runs with only its managed Node and CLI, then exports bounded evidence',()=>{
  const root=mkdtempSync(join(tmpdir(),'aside-only-')),asideHome=join(root,'app-home'),node=join(asideHome,'runtime/node/bin/node'),out=join(root,'lecture');
  mkdirSync(join(node,'..'),{recursive:true});symlinkSync(process.execPath,node);
  const env={...process.env,PATH:'/usr/bin:/bin',ASIDE_HOME:asideHome,LECTURE_ASIDE:command()};delete env.LECTURE_NODE;
  const run=(...args)=>spawnSync('/bin/sh',['bin/lecture',...args],{env,encoding:'utf8',timeout:15000});
  const listed=run('tabs','--browser','aside');assert.equal(listed.status,0,listed.stderr);assert.equal(JSON.parse(listed.stdout)[0].targetId,'lecture-1');
  const result=run('capture','--browser','aside','--tab','lecture-1','--selector','#player','--caption-mode','snapshot','--out',out,'--duration','0.6');
  assert.equal(result.status,0,result.stderr);
  const status=JSON.parse(readFileSync(join(out,'status.json'),'utf8'));assert.equal(status.state,'stopped');assert.equal(status.browser,'aside');assert.equal(status.framesSaved,1);assert.equal(status.captionEvents,1);
  assert.equal(existsSync(join(out,'.capture.lock')),false);
  assert.equal(run('study','init','--out',out).status,0);
  const context=run('study','context','--out',out,'--bytes','12000');assert.equal(context.status,0,context.stderr);assert.ok(Buffer.byteLength(context.stdout)<=12000);
  const snapshot=JSON.parse(context.stdout),qa=join(root,'qa.json'),before=readFileSync(join(out,'study.json'),'utf8');
  writeFileSync(qa,JSON.stringify({key:'aside-question',context:snapshot,question:{text:'Aside로 관찰한 강의인가?',evidence:[2]},answer:{text:'지정한 Aside 탭에서 수집한 근거',evidence:[2]}}));
  const saved=run('study','qa','--out',out,'--file',qa);assert.equal(saved.status,0,saved.stderr);assert.equal(readFileSync(join(out,'study.json'),'utf8'),before);
  assert.equal(run('study','export','--out',out).status,0);assert.match(readFileSync(join(out,'notes.md'),'utf8'),/Aside로 관찰한 강의인가/);assert.equal(JSON.parse(readFileSync(join(out,'study-notes.json'),'utf8')).sideChatQa.length,1);
  const bad=run('capture','--browser','aside','--out',join(root,'bad'),'--tab','lecture-1');assert.notEqual(bad.status,0);assert.match(bad.stderr,/selector/);
});
