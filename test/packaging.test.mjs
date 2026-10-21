import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,mkdirSync,writeFileSync,readFileSync,readlinkSync,existsSync,lstatSync,rmSync,symlinkSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const quote=s=>`'${s.replace(/'/g,"'\\''")}'`;
function fixture(){
  const root=mkdtempSync(join(tmpdir(),"lecture bundle ' 사용자 ")),home=join(root,'home'),download=join(root,'download/lecture-companion');
  cpSync('skills/lecture-companion',download,{recursive:true});
  const node=join(home,'.aside/runtime/node/bin/node');mkdirSync(join(node,'..'),{recursive:true});symlinkSync(process.execPath,node);
  const cli=join(root,'aside');writeFileSync(cli,`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fileURLToPath(new URL('fixtures/aside-mcp.mjs',import.meta.url)))} "$@"\n`,{mode:0o700});
  const env={...process.env,HOME:home,CODEX_HOME:join(home,'.codex'),PATH:'/usr/bin:/bin',ASIDE_HOME:join(home,'.aside'),LECTURE_ASIDE:cli,LECTURE_COMPANION_DATA_DIR:join(home,'private-data')};delete env.LECTURE_NODE;
  const installed=join(home,'.codex/skills/lecture-companion');
  const run=(...args)=>spawnSync('/bin/sh',[join(installed,'scripts/lecture'),...args],{env,encoding:'utf8',timeout:15000,cwd:home});
  const install=(...args)=>spawnSync('/bin/sh',[join(download,'scripts/install.sh'),...args],{env,encoding:'utf8'});
  return {root,home,download,installed,env,run,install};
}

test('the checked-in skill runtime matches the current source and includes original dependency licenses',()=>{
  const result=spawnSync(process.execPath,['scripts/package-skill.mjs','--check'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.ok(JSON.parse(result.stdout).files>30);
  assert.equal(readFileSync('skills/lecture-companion/scripts/runtime/vendor/pngjs/LICENSE','utf8'),readFileSync('vendor/pngjs/LICENSE','utf8'));
});

test('copying only the skill directory supports real image processing and notes without a repository',()=>{
  const x=fixture();mkdirSync(join(x.installed,'..'),{recursive:true});cpSync(x.download,x.installed,{recursive:true});rmSync(join(x.root,'download'),{recursive:true});
  const doctor=x.run('doctor');assert.equal(doctor.status,0,doctor.stderr);assert.equal(JSON.parse(doctor.stdout).imageWorker.ok,true);
  const out=join(x.home,'demo');assert.equal(x.run('demo','--out',out).status,0);assert.equal(x.run('study','init','--out',out).status,0);
  assert.equal(x.run('study','export','--out',out).status,0);assert.ok(existsSync(join(out,'notes.md')));
  const direct=spawnSync(process.execPath,[join(x.installed,'scripts/lecture.mjs'),'doctor'],{env:x.env,encoding:'utf8'});
  assert.equal(direct.status,0,direct.stderr);
});

test('standalone installer copies both hosts and leaves capture and Q&A usable after the download is removed',()=>{
  const x=fixture(),first=x.install('--host','both');assert.equal(first.status,0,first.stderr);
  assert.equal(lstatSync(x.installed).isSymbolicLink(),false);assert.equal(lstatSync(join(x.home,'.claude/skills/lecture-companion')).isDirectory(),true);
  assert.equal(x.install('--host','both').status,0);
  rmSync(join(x.root,'download'),{recursive:true});
  const capture=x.run('start','--tab','lecture-1','--caption-mode','snapshot','--duration','1');assert.equal(capture.status,0,capture.stderr);
  const notices=capture.stdout.trim().split('\n').map(s=>JSON.parse(s)),created=notices.find(n=>n.type==='session-created'),handoff=notices.find(n=>n.type==='question-chat-required');
  assert.ok(created.out.startsWith(join(x.home,'private-data')));assert.ok(!created.out.startsWith(x.installed));
  const status=JSON.parse(readFileSync(join(created.out,'status.json'),'utf8'));assert.equal(status.framesSaved,1);assert.equal(status.captionEvents,1);
  const prompt=readFileSync(handoff.promptFile,'utf8');
  const contextCommand=prompt.split('\n').find(line=>line.includes('/bin/sh ')&&line.includes(' study context --out '));assert.ok(contextCommand);
  const fromPrompt=spawnSync('/bin/sh',['-c',contextCommand],{env:x.env,encoding:'utf8',timeout:15000});
  assert.equal(fromPrompt.status,0,fromPrompt.stderr);assert.ok(JSON.parse(fromPrompt.stdout).sessionId);
  const context=JSON.parse(x.run('study','context','--out',created.out).stdout),qa=join(x.home,'question.json');
  writeFileSync(qa,JSON.stringify({key:'standalone-question',context,question:{text:'설치 파일 없이 계속 공부할 수 있나?',evidence:[2]},answer:{text:'독립 설치본으로 수집과 기록을 검증했다.',evidence:[2]}}));
  assert.equal(x.run('study','qa','--out',created.out,'--file',qa).status,0);
  const exported=x.run('study','export','--out',created.out);assert.equal(exported.status,0,exported.stderr);
  assert.match(readFileSync(join(created.out,'notes.md'),'utf8'),/설치 파일 없이/);
});

test('a legacy link to this skill can migrate to an independent copy while unrelated skills are preserved',()=>{
  const x=fixture();mkdirSync(join(x.installed,'..'),{recursive:true});symlinkSync(x.download,x.installed);
  const installed=x.install();assert.equal(installed.status,0,installed.stderr);assert.equal(lstatSync(x.installed).isSymbolicLink(),false);
  rmSync(join(x.root,'download'),{recursive:true});assert.equal(x.run('doctor').status,0);
  const y=fixture();mkdirSync(y.installed,{recursive:true});writeFileSync(join(y.installed,'SKILL.md'),'user-owned');
  assert.notEqual(y.install('--host','both').status,0);assert.equal(readFileSync(join(y.installed,'SKILL.md'),'utf8'),'user-owned');
  assert.equal(existsSync(join(y.home,'.claude/skills/lecture-companion')),false);
});

test('a damaged bundle is rejected before any host skill is installed',()=>{
  const x=fixture();writeFileSync(join(x.download,'scripts/lecture'),'damaged');
  const result=x.install('--host','both');assert.notEqual(result.status,0);assert.equal(existsSync(x.installed),false);
});

test('an incomplete manifest cannot install only its surviving files and claim success',()=>{
  const x=fixture(),manifest=join(x.download,'BUNDLE.sha256');
  writeFileSync(manifest,readFileSync(manifest,'utf8').split('\n').find(line=>line.endsWith('  LICENSE'))+'\n');
  assert.notEqual(x.install().status,0);assert.equal(existsSync(x.installed),false);
});

test('sharing the source SKILL document does not make a custom linked skill replaceable',()=>{
  const x=fixture(),custom=join(x.root,'custom');mkdirSync(custom);mkdirSync(join(x.installed,'..'),{recursive:true});
  symlinkSync(join(x.download,'SKILL.md'),join(custom,'SKILL.md'));writeFileSync(join(custom,'custom.txt'),'keep this registration');symlinkSync(custom,x.installed);
  assert.notEqual(x.install().status,0);assert.equal(readlinkSync(x.installed),custom);
});

test('a failed publication restores the previous legacy registration',()=>{
  const x=fixture(),commands=join(x.root,'commands');mkdirSync(commands);mkdirSync(join(x.installed,'..'),{recursive:true});symlinkSync(x.download,x.installed);
  writeFileSync(join(commands,'mv'),'#!/bin/sh\nexit 1\n',{mode:0o700});x.env.PATH=`${commands}:/usr/bin:/bin`;
  assert.notEqual(x.install().status,0);assert.equal(lstatSync(x.installed).isSymbolicLink(),true);assert.equal(readlinkSync(x.installed),x.download);
});

test('build and freshness checks refuse a runtime directory linked outside the skill',()=>{
  const x=fixture(),source=join(x.root,'publisher');mkdirSync(source);
  for(const path of ['bin','src','vendor','scripts','skills','package.json','LICENSE'])cpSync(path,join(source,path),{recursive:true});
  const runtime=join(source,'skills/lecture-companion/scripts/runtime'),external=join(x.root,'external-runtime');renameSync(runtime,external);symlinkSync(external,runtime);
  for(const args of [['--check'],[]]){
    const result=spawnSync(process.execPath,[join(source,'scripts/package-skill.mjs'),...args],{encoding:'utf8'});
    assert.notEqual(result.status,0,'a copied skill must not rely on an external runtime symlink');
  }
});

test('a build rejects generated leaf symlinks without changing their external targets',()=>{
  const x=fixture(),source=join(x.root,'publisher');mkdirSync(source);
  for(const path of ['bin','src','vendor','scripts','skills','package.json','LICENSE'])cpSync(path,join(source,path),{recursive:true});
  for(const name of ['LICENSE','FILES','BUNDLE.sha256']){
    const target=join(source,'skills/lecture-companion',name),original=readFileSync(target),external=join(x.root,`external-${name}`);
    writeFileSync(external,'preserve external contents');rmSync(target);symlinkSync(external,target);
    const result=spawnSync(process.execPath,[join(source,'scripts/package-skill.mjs')],{encoding:'utf8'});
    assert.notEqual(result.status,0,`generated ${name} must not follow a symlink`);
    assert.equal(readFileSync(external,'utf8'),'preserve external contents');
    rmSync(target);writeFileSync(target,original);
  }
});

test('empty data-root configuration uses persistent home storage and relative overrides are refused',()=>{
  const x=fixture();assert.equal(x.install().status,0);x.env.LECTURE_COMPANION_DATA_DIR='';delete x.env.XDG_DATA_HOME;
  const captured=x.run('start','--tab','lecture-1','--caption-mode','snapshot','--duration','0.8');assert.equal(captured.status,0,captured.stderr);
  const created=captured.stdout.trim().split('\n').map(line=>JSON.parse(line)).find(n=>n.type==='session-created');
  assert.ok(created.out.startsWith(join(x.home,'.local/share/lecture-companion/sessions')),'default data must remain outside the installed skill and current directory');
  x.env.LECTURE_COMPANION_DATA_DIR='relative';assert.notEqual(x.run('start','--tab','lecture-1').status,0);
});

test('release ZIP contains only a complete installable skill and works after extraction',()=>{
  const x=fixture(),zip=join(x.root,'lecture.zip');
  const built=spawnSync(process.execPath,['scripts/package-skill.mjs','--check','--archive','--out',zip],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);
  const target=join(x.root,'unpacked');const unpack=spawnSync('unzip',['-q',zip,'-d',target],{encoding:'utf8'});assert.equal(unpack.status,0,unpack.stderr);
  const listing=spawnSync('unzip',['-Z1',zip],{encoding:'utf8'}).stdout;
  assert.ok(!listing.split('\n').some(p=>p.includes('/sessions/')||p.includes('/test/')||p.includes('/.git/')||p.includes('/node_modules/')));
  const doctor=spawnSync('/bin/sh',[join(target,'lecture-companion/scripts/lecture'),'doctor'],{env:x.env,encoding:'utf8'});
  assert.equal(doctor.status,0,doctor.stderr);
});
