// Opt-in native Aside test. Only localhost fixture tabs are opened and closed.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {AsideClient} from '../src/aside-browser.mjs';

const began=performance.now(),html=readFileSync(new URL('fixtures/player.html',import.meta.url),'utf8');
const root=process.env.LECTURE_ASIDE_TEST_OUT?resolve(process.env.LECTURE_ASIDE_TEST_OUT):mkdtempSync(join(tmpdir(),'lecture-onboarding-native-'));
if(process.env.LECTURE_ASIDE_TEST_OUT)mkdirSync(root,{mode:0o700});
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(req.url==='/classes'?html.replace('id="player"','class="lecture-screen"').replace('id="caption"','class="subtitle"'):html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const account=process.env.LECTURE_ASIDE_ACCOUNT,profile=process.env.LECTURE_ASIDE_PROFILE;
const client=new AsideClient({account,profile}),targets=[];
const launcher=process.env.LECTURE_TEST_LAUNCHER?resolve(process.env.LECTURE_TEST_LAUNCHER):fileURLToPath(new URL('../bin/lecture',import.meta.url));
const env={...process.env,PATH:'/usr/bin:/bin'};
const run=(...args)=>{const p=spawnSync('/bin/sh',[launcher,...args],{env,encoding:'utf8',timeout:20000});assert.equal(p.status,0,p.stderr);return args[0]==='stop'?p.stdout:JSON.parse(p.stdout);};
const selectArgs=['--browser','aside',...(account?['--account',account]:[]),...(profile?['--profile',profile]:[])];
let child,completed,out;
try{
  await client.start();
  const open=async path=>{
    const id=await client.json(`(async()=>{const tab=await openTab(${JSON.stringify(`http://127.0.0.1:${server.address().port}${path}`)});return tab.targetId;})()`);
    targets.push(id);return id;
  };
  const tab=await open('/'),selectionAt=performance.now();
  const plan=run('setup',...selectArgs,'--tab',tab,'--host','codex');
  assert.equal(plan.step,'ready-to-start');assert.equal(plan.player.selector,'#player');assert.equal(plan.player.captionSelector,'#caption');
  const selectedMs=performance.now()-selectionAt;
  out=join(root,'lecture');let stdout='',stderr='';
  const startAt=performance.now();
  child=spawn('/bin/sh',[launcher,'start',...selectArgs,'--tab',tab,'--host','codex','--out',out,'--duration','8'],{env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});
  completed=new Promise((r,j)=>{child.once('exit',r);child.once('error',j);});
  let handoff,check;
  const until=Date.now()+15000;
  while(Date.now()<until&&child.exitCode===null){
    handoff=stdout.trim().split('\n').map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(n=>n?.type==='question-chat-required');
    if(handoff){check=run('check','--out',out);if(check.capture.captionEvents>0&&check.capture.framesSaved>0)break;}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(handoff,stderr||stdout);assert.equal(check.step,'open-question-chat');assert.equal(check.ready,false);
  assert.equal(handoff.chat.action,'create');assert.ok(readFileSync(handoff.promptFile,'utf8').includes('study context'));
  const evidenceAndHandoffMs=performance.now()-startAt;
  assert.equal(run('study','chat','--out',out).action,'recover','an unbound native opening must not silently allocate another chat');
  run('stop','--out',out);assert.equal(await completed,0,stderr);child=null;
  assert.equal(run('check','--out',out).step,'capture-stopped');
  const classes=await open('/classes');
  const custom=run('setup',...selectArgs,'--tab',classes);
  assert.equal(custom.step,'ready-to-start');assert.equal(custom.player.captionSupport,'dom');assert.equal(custom.player.captionSelector,'div.subtitle');
  assert.ok(custom.player.selector.includes('section'));
  const summary={ok:true,browser:'aside',selectionMs:Math.round(selectedMs),evidenceAndHandoffMs:Math.round(evidenceAndHandoffMs),totalMs:Math.round(performance.now()-began),
    selectorRequiredFromUser:false,captionEvents:check.capture.captionEvents,framesSaved:check.capture.framesSaved,classOnlyCaptions:true,
    questionChat:{prepared:true,nativeOpened:false,bound:false},note:'The native chat opener was not invoked; no model task or synthetic thread ID was used.'};
  writeFileSync(join(root,'validation.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(summary));
}finally{
  if(child&&child.exitCode===null){if(existsSync(out))writeFileSync(join(out,'STOP'),'Test cleanup\n',{mode:0o600});else child.kill();const timer=setTimeout(()=>child.kill('SIGKILL'),3000);try{await completed;}finally{clearTimeout(timer);}}
  if(!client.failure)for(const id of targets)await client.json(`(async()=>{await closeTab(getTabByTargetId(${JSON.stringify(id)}));return true;})()`).catch(()=>{});
  await client.close();await new Promise(r=>server.close(r));
}
