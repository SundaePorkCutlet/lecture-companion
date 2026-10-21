import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,lstatSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PNG} from '../vendor/pngjs/lib/png.js';
import {Journal} from '../src/core.mjs';
import {StudySession} from '../src/study-session.mjs';

const quote=s=>`'${s.replace(/'/g,"'\\''")}'`;
function environment(){
  const root=mkdtempSync(join(tmpdir(),"lecture first ' 사용자 ")),home=join(root,'home'),asideHome=join(home,'.aside');
  const node=join(asideHome,'runtime/node/bin/node');mkdirSync(join(node,'..'),{recursive:true});symlinkSync(process.execPath,node);
  const cli=join(root,'aside');
  writeFileSync(cli,`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fileURLToPath(new URL('fixtures/aside-mcp.mjs',import.meta.url)))} "$@"\n`,{mode:0o700});
  const env={...process.env,HOME:home,CODEX_HOME:join(home,'.codex'),PATH:'/usr/bin:/bin',ASIDE_HOME:asideHome,LECTURE_ASIDE:cli};delete env.LECTURE_NODE;
  const run=(...args)=>spawnSync('/bin/sh',['bin/lecture',...args],{env,encoding:'utf8',timeout:15000});
  return {root,home,env,run};
}

test('one installer copies both hosts without Node or npm and is safe to repeat',()=>{
  const {home,env}=environment();
  const run=()=>spawnSync('/bin/sh',['install.sh','--host','both'],{env:{...env,ASIDE_HOME:join(home,'no-runtime')},encoding:'utf8'});
  const first=run();assert.equal(first.status,0,first.stderr);
  for(const host of ['.codex','.claude']){
    const installed=join(home,host,'skills/lecture-companion');
    assert.equal(lstatSync(installed).isDirectory(),true);assert.equal(lstatSync(installed).isSymbolicLink(),false);
    const help=spawnSync('/bin/sh',[join(installed,'scripts/lecture'),'help'],{env,encoding:'utf8'});
    assert.equal(help.status,0,help.stderr);
  }
  assert.equal(run().status,0);
});

test('installer preserves an existing skill and does not partially install another host',()=>{
  const {home,env}=environment(),existing=join(home,'.claude/skills/lecture-companion');
  mkdirSync(existing,{recursive:true});writeFileSync(join(existing,'SKILL.md'),'user-owned skill');
  const result=spawnSync('/bin/sh',['install.sh','--host','both'],{env,encoding:'utf8'});
  assert.notEqual(result.status,0);assert.equal(readFileSync(join(existing,'SKILL.md'),'utf8'),'user-owned skill');
  assert.equal(existsSync(join(home,'.codex/skills/lecture-companion')),false);
});

test('setup offers lecture titles, discovers the player and omits signed URL details',()=>{
  const {run}=environment();
  const listed=run('setup');assert.equal(listed.status,0,listed.stderr);
  const choice=JSON.parse(listed.stdout);assert.equal(choice.step,'choose-lecture');
  assert.equal(choice.lectures[0].tab,'lecture-1');assert.equal(choice.lectures[0].title,'Synthetic lecture');
  assert.ok(!listed.stdout.includes('PRIVATE'));
  const selected=run('setup','--tab','lecture-1');assert.equal(selected.status,0,selected.stderr);
  const plan=JSON.parse(selected.stdout);assert.equal(plan.step,'ready-to-start');
  assert.equal(plan.player.selector,'#player');assert.equal(plan.player.captionSelector,'#caption');
  assert.ok(!selected.stdout.includes('PRIVATE'));
  const claude=JSON.parse(run('setup','--tab','lecture-1','--host','claude-code').stdout);
  assert.ok(claude.startArgs.includes('claude-code'),'the selected question host must survive the recommended start command');
});

test('setup requires a player choice when the selected tab contains two players',()=>{
  const {run,env,root}=environment();env.LECTURE_FIXTURE_TWO_PLAYERS='1';
  const result=run('setup','--tab','lecture-1');assert.equal(result.status,0,result.stderr);
  const plan=JSON.parse(result.stdout);assert.equal(plan.step,'choose-player');assert.equal(plan.players.length,2);
  const out=join(root,'untouched');
  const start=run('start','--tab','lecture-1','--out',out);
  assert.notEqual(start.status,0);assert.equal(existsSync(out),false,'ambiguous selection must not create a capture session');
});

test('missing Aside gives an actionable setup result without changing profiles or creating sessions',()=>{
  const {run,env,root}=environment();env.LECTURE_ASIDE=join(root,'absent');
  const result=run('setup');assert.notEqual(result.status,0);
  assert.ok(result.stdout.trim(),result.stderr);
  const packet=JSON.parse(result.stdout);assert.equal(packet.step,'needs-browser');
  assert.ok(packet.actions.length>0);assert.equal(existsSync(join(root,'sessions')),false);
});

test('auto discovery excludes offscreen media and refuses a resource iframe without video',()=>{
  const {run,env}=environment();env.LECTURE_FIXTURE_TWO_PLAYERS='1';env.LECTURE_FIXTURE_OFFSCREEN='1';
  let result=run('setup','--tab','lecture-1');assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).step,'ready-to-start','offscreen media must not force an unrelated player choice');
  env.LECTURE_FIXTURE_RESOURCE_FRAME='1';
  result=run('setup','--tab','lecture-1');assert.notEqual(result.status,0);
  assert.equal(JSON.parse(result.stdout).step,'needs-player','resource text in an iframe is not evidence of a player');
});

test('check requires a saved player image and a live capture owner rather than only counters',()=>{
  const {root,run}=environment(),out=join(root,'check');mkdirSync(out);
  const journal=new Journal(out);journal.append({type:'start'});journal.append({type:'caption',text:'Observed caption'});journal.append({type:'frame',file:'frame.png'});
  const study=new StudySession(out);study.init();const chat=study.prepareChat();study.bindChat({setupId:chat.setupId,threadId:'fixture-thread'});
  writeFileSync(join(out,'status.json'),JSON.stringify({state:'capturing',captionEvents:1,framesSaved:1,updatedAt:new Date().toISOString()}));
  writeFileSync(join(out,'.capture.lock'),'');writeFileSync(join(out,'manifest.json'),JSON.stringify({capturePid:process.pid}));
  assert.equal(JSON.parse(run('check','--out',out).stdout).ready,false,'a missing saved frame must block readiness');
  const image=new PNG({width:100,height:100});image.data.fill(255);writeFileSync(join(out,'frame.png'),PNG.sync.write(image));
  assert.equal(JSON.parse(run('check','--out',out).stdout).ready,true);
  const exited=spawnSync(process.execPath,['-e','']);assert.equal(exited.status,0);
  writeFileSync(join(out,'manifest.json'),JSON.stringify({capturePid:exited.pid}));
  assert.equal(JSON.parse(run('check','--out',out).stdout).ready,false,'a dead capture process must block readiness even with fresh counters and a stale lock');
});

test('a stopped session explains player changes and offers export without suggesting a blind restart',()=>{
  const {root,run}=environment(),out=join(root,'changed');mkdirSync(out);
  const journal=new Journal(out);journal.append({type:'start'});journal.append({type:'end',reason:'player-changed'});
  writeFileSync(join(out,'status.json'),JSON.stringify({state:'stopped',stopReason:'player-changed',completed:false,updatedAt:new Date().toISOString()}));
  const result=JSON.parse(run('check','--out',out).stdout);
  assert.equal(result.step,'capture-stopped');assert.equal(result.capture.stopReason,'player-changed');
  assert.equal(result.capture.completed,false);assert.match(result.actions.join(' '),/export/i);
  assert.match(result.actions.join(' '),/choose.*lecture/i);
});

test('a discovered on-screen iframe remains capturable when another iframe is offscreen',()=>{
  const {run,env,root}=environment();env.LECTURE_FIXTURE_TWO_PLAYERS='1';env.LECTURE_FIXTURE_OFFSCREEN='1';env.LECTURE_FIXTURE_IFRAMES='1';
  const setup=run('setup','--tab','lecture-1');assert.equal(JSON.parse(setup.stdout).step,'ready-to-start');
  const out=join(root,'iframe');
  const started=run('start','--tab','lecture-1','--out',out,'--caption-mode','snapshot','--duration','0.8');
  assert.equal(started.status,0,started.stderr);
  assert.equal(JSON.parse(readFileSync(join(out,'status.json'),'utf8')).framesSaved,1);
});

test('start initializes shared study and reserves one real-host chat handoff while capture continues',async()=>{
  const {run,env,root}=environment(),out=join(root,'session');
  const child=spawn('/bin/sh',['bin/lecture','start','--tab','lecture-1','--out',out,'--caption-mode','snapshot','--duration','4'],{env,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',x=>{stdout+=x;});child.stderr.on('data',x=>{stderr+=x;});
  const completed=new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
  const until=Date.now()+10000;let request;
  try{
    while(Date.now()<until&&child.exitCode===null){
      request=stdout.trim().split('\n').map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(x=>x?.type==='question-chat-required');
      if(request&&JSON.parse(readFileSync(join(out,'status.json'),'utf8')).framesSaved>0)break;
      await new Promise(r=>setTimeout(r,30));
    }
    assert.ok(request,stderr||stdout);assert.equal(request.chat.action,'create');assert.equal(request.chat.host,'codex');
    assert.equal(existsSync(join(out,'study.json')),true);
    assert.match(readFileSync(request.promptFile,'utf8'),/study context/);
    let check=JSON.parse(run('check','--out',out).stdout);assert.equal(check.step,'open-question-chat');assert.equal(check.ready,false);
    const bind=join(root,'binding.json');writeFileSync(bind,JSON.stringify({setupId:request.chat.setupId,threadId:'fixture-native-thread'}));
    assert.equal(run('study','chat-bind','--out',out,'--file',bind).status,0);
    check=JSON.parse(run('check','--out',out).stdout);assert.equal(check.ready,true);assert.equal(check.questionChat.threadId,'fixture-native-thread');
    assert.equal(run('study','chat','--out',out).status,0);
    assert.equal(JSON.parse(run('study','chat','--out',out).stdout).action,'reuse');
    assert.equal(await completed,0,stderr);
    assert.equal(existsSync(join(out,'.capture.lock')),false);
    assert.equal(JSON.parse(run('check','--out',out).stdout).step,'capture-stopped');
    assert.notEqual(run('start','--tab','lecture-1','--out',out).status,0,'existing sessions must be protected');
  }finally{if(child.exitCode===null){if(existsSync(out))run('stop','--out',out);else child.kill();await completed;}}
});
