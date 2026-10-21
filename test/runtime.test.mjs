import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,mkdirSync,symlinkSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {VisualWorker} from '../src/visual-worker.mjs';

function isolated(){
  const root=mkdtempSync(join(tmpdir(),'lecture packaged-')),repo=join(root,'skill repo'),home=join(root,'home');
  mkdirSync(repo);mkdirSync(home);
  for(const name of ['bin','src','skills','package.json','vendor'])if(existsSync(name))cpSync(name,join(repo,name),{recursive:true});
  const env={...process.env,HOME:home,PATH:'/usr/bin:/bin'};delete env.LECTURE_NODE;delete env.LECTURE_RUNTIME;delete env.ASIDE_HOME;
  const run=(args,extra={})=>spawnSync('/bin/sh',[join(repo,'bin/lecture'),...args],{env:{...env,...extra},encoding:'utf8',timeout:10000});
  return {root,repo,home,env,run};
}
function bundledNode(home){
  const path=join(home,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node');mkdirSync(join(path,'..'),{recursive:true});symlinkSync(process.execPath,path);return path;
}

test('app-bundled Node runs a checkout with no node_modules or PATH node, including image processing',()=>{
  const fixture=isolated();bundledNode(fixture.home);
  assert.equal(existsSync(join(fixture.repo,'node_modules')),false);
  const result=fixture.run(['doctor']);assert.equal(result.status,0,result.stderr);
  const doctor=JSON.parse(result.stdout);assert.equal(doctor.ok,true);assert.equal(doctor.runtime.provider,'codex-bundled');assert.equal(doctor.imageWorker.duplicateFiltered,true);
  const dir=join(fixture.root,'private lecture');
  assert.equal(fixture.run(['demo','--out',dir]).status,0);assert.equal(fixture.run(['study','init','--out',dir]).status,0);
  const chat=fixture.run(['study','chat','--out',dir]);assert.equal(chat.status,0,chat.stderr);
  const prompt=JSON.parse(chat.stdout).prompt;
  const command=prompt.split('\n').find(line=>line.includes(' study context '));assert.ok(command);
  const context=spawnSync('/bin/sh',['-c',command],{env:fixture.env,encoding:'utf8',timeout:10000});
  assert.equal(context.status,0,context.stderr);assert.equal(JSON.parse(context.stdout).capturedThrough,22);
});

test('an explicit host runtime is honored and an invalid explicit runtime fails without a silent fallback',()=>{
  const fixture=isolated();bundledNode(fixture.home);
  const success=fixture.run(['doctor'],{LECTURE_NODE:process.execPath});assert.equal(success.status,0,success.stderr);assert.equal(JSON.parse(success.stdout).runtime.provider,'configured');
  const invalid=fixture.run(['help'],{LECTURE_NODE:join(fixture.root,'missing node')});assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/LECTURE_NODE|runtime/i);
});

test('the ego runtime bridge preserves quoted Unicode arguments and runs a separate real image process',()=>{
  const fixture=isolated(),bindir=join(fixture.root,'app bin');mkdirSync(bindir);
  const quote=s=>`'${s.replace(/'/g,"'\\''")}'`;
  // Only the host boundary is replaced: the CLI source runs in a real Node
  // process and its image worker communicates over the actual local socket.
  writeFileSync(join(bindir,'ego-browser'),`#!/bin/sh\n[ "$1" = nodejs ] && [ "$2" = -e ] || exit 97\nexec ${quote(process.execPath)} --input-type=module -e "$3"\n`,{mode:0o700});
  const env={PATH:`${bindir}:/usr/bin:/bin`};
  const result=fixture.run(['doctor'],env);assert.equal(result.status,0,result.stderr);
  const doctor=JSON.parse(result.stdout);assert.equal(doctor.runtime.provider,'ego');assert.equal(doctor.imageWorker.duplicateFiltered,true);
  const dir=join(fixture.root,"강의 ' ${literal} ; $() 폴더");
  const demo=fixture.run(['demo','--out',dir,'--title','인자 " ; $HOME `literal`'],env);assert.equal(demo.status,0,demo.stderr);
  assert.equal(JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8')).title,'인자 " ; $HOME `literal`');
});

test('missing app runtimes fail clearly without installing anything',()=>{
  const fixture=isolated(),result=fixture.run(['help']);
  assert.notEqual(result.status,0);assert.match(result.stderr,/host|runtime/i);assert.equal(existsSync(join(fixture.repo,'node_modules')),false);
});

test('ego image startup failure rejects pending work and removes its private IPC directory on close',async()=>{
  const worker=new VisualWorker({runtime:{provider:'ego',command:'/nonexistent/lecture-test-ego'}}),directory=worker.worker.directory;
  try{await assert.rejects(()=>worker.process(Buffer.from('invalid')),/worker/i);}
  finally{await worker.close();}
  assert.equal(existsSync(directory),false);
});

test('ego image transport timeout terminates a stalled host process and cleans local IPC',async()=>{
  const root=mkdtempSync(join(tmpdir(),'lecture-stalled-host-')),command=join(root,'ego-browser');
  const quote=s=>`'${s.replace(/'/g,"'\\''")}'`;
  writeFileSync(command,`#!/bin/sh\nexec ${quote(process.execPath)} -e 'setInterval(()=>{},1000)'\n`,{mode:0o700});
  const worker=new VisualWorker({runtime:{provider:'ego',command},timeoutMs:200}),directory=worker.worker.directory;
  try{await assert.rejects(()=>worker.process(Buffer.from('invalid')),/timed out/i);}
  finally{await worker.close();}
  assert.equal(worker.worker.child.exitCode!==null||worker.worker.child.signalCode!==null,true);
  assert.equal(existsSync(directory),false);
});

test('an explicit app runtime remains usable by generated question commands in a fresh chat environment',()=>{
  const fixture=isolated(),dir=join(fixture.root,'shared session'),override={LECTURE_NODE:process.execPath};
  assert.equal(fixture.run(['demo','--out',dir],override).status,0);assert.equal(fixture.run(['study','init','--out',dir],override).status,0);
  const result=fixture.run(['study','chat','--out',dir],override);assert.equal(result.status,0,result.stderr);
  const command=JSON.parse(result.stdout).prompt.split('\n').find(line=>line.includes(' study context '));
  const context=spawnSync('/bin/sh',['-c',command],{env:fixture.env,encoding:'utf8',timeout:10000});
  assert.equal(context.status,0,context.stderr);assert.equal(JSON.parse(context.stdout).capturedThrough,22);
});

test('the package launcher resolves relative and absolute symlink chains before finding its entry point',()=>{
  const fixture=isolated();bundledNode(fixture.home);
  const links=join(fixture.root,'package bin');mkdirSync(links);
  const second=join(links,'actual-link'),first=join(links,'lecture-companion');
  symlinkSync(join(fixture.repo,'bin/lecture'),second);symlinkSync(relative(dirname(first),second),first);
  const result=spawnSync('/bin/sh',[first,'doctor'],{env:fixture.env,encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).imageWorker.duplicateFiltered,true);
});

function asideNode(root){
  const path=join(root,'runtime/node/bin/node');mkdirSync(dirname(path),{recursive:true});symlinkSync(process.execPath,path);return path;
}

test('Aside managed Node is selected automatically without PATH Node, npm packages or CLI calls',()=>{
  const fixture=isolated();asideNode(join(fixture.home,'.aside'));bundledNode(fixture.home);
  const result=fixture.run(['doctor']);assert.equal(result.status,0,result.stderr);
  const doctor=JSON.parse(result.stdout);assert.equal(doctor.runtime.provider,'aside');assert.equal(doctor.imageWorker.duplicateFiltered,true);
  assert.equal(existsSync(join(fixture.repo,'node_modules')),false);
});

test('custom Aside home shares its selected runtime with a fresh question chat',()=>{
  const fixture=isolated(),asideHome=join(fixture.root,"Aside ' 사용자 홈"),override={ASIDE_HOME:asideHome};asideNode(asideHome);
  const check=fixture.run(['doctor'],override);assert.equal(check.status,0,check.stderr);assert.equal(JSON.parse(check.stdout).runtime.provider,'aside');
  const dir=join(fixture.root,'private lecture');
  assert.equal(fixture.run(['demo','--out',dir],override).status,0);assert.equal(fixture.run(['study','init','--out',dir],override).status,0);
  const result=fixture.run(['study','chat','--out',dir],override);assert.equal(result.status,0,result.stderr);
  const command=JSON.parse(result.stdout).prompt.split('\n').find(line=>line.includes(' study context '));
  const context=spawnSync('/bin/sh',['-c',command],{env:fixture.env,encoding:'utf8',timeout:10000});
  assert.equal(context.status,0,context.stderr);assert.equal(JSON.parse(context.stdout).capturedThrough,22);
});

test('incompatible Aside runtime falls back without launching its CLI or modifying its installation',()=>{
  const fixture=isolated();bundledNode(fixture.home);
  const nodePath=join(fixture.home,'.aside/runtime/node/bin/node');mkdirSync(dirname(nodePath),{recursive:true});
  writeFileSync(nodePath,'#!/bin/sh\nprintf "v20.0.0\\n"\n',{mode:0o700});
  const before=readFileSync(nodePath,'utf8'),result=fixture.run(['doctor']);
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).runtime.provider,'codex-bundled');assert.equal(readFileSync(nodePath,'utf8'),before);
});
