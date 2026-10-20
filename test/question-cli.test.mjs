import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('public CLI prepares a native question chat, shares fresh context and exports Q&A without consuming the worker batch',()=>{
  const dir=mkdtempSync(join(tmpdir(),'question-cli-'));
  const run=(...args)=>spawnSync(process.execPath,['bin/lecture.mjs',...args],{encoding:'utf8'});
  const command=(...args)=>{const r=run('study',...args,'--out',dir);assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
  const file=(name,data)=>{const path=join(dir,name);writeFileSync(path,JSON.stringify(data));return path;};
  assert.equal(run('demo','--out',dir).status,0);command('init');const batch=command('next');
  const before=readFileSync(join(dir,'study.json'),'utf8');
  const context=command('context','--bytes','2048');assert.ok(Buffer.byteLength(JSON.stringify(context))<=2048);
  let chat=command('chat','--host','codex','--worker-thread','worker-id','--title','강의');assert.equal(chat.action,'create');
  assert.equal(command('chat').action,'recover');chat=command('chat','--retry-setup',chat.setupId);assert.equal(chat.action,'create');
  command('chat-bind','--file',file('binding.json',{setupId:chat.setupId,threadId:'question-id'}));
  assert.equal(command('chat','--host','codex').action,'reuse');
  command('qa','--file',file('qa.json',{key:'user-question-1',context,question:{text:'실시간 문맥 공유?',evidence:[2]},answer:{text:'최신 문맥을 확인한 답변',evidence:[2]}}));
  assert.equal(command('context','--query','실시간 문맥').search.totalMatches,1);
  assert.equal(command('context','--query','').matches.length,2);
  assert.equal(readFileSync(join(dir,'study.json'),'utf8'),before);
  assert.deepEqual(command('next'),batch);assert.equal(command('status').mode,'follow');
  const output=command('export');assert.match(readFileSync(output.notesPath,'utf8'),/실시간 문맥 공유/);
  assert.equal(JSON.parse(readFileSync(output.jsonPath,'utf8')).sideChatQa.length,1);
});
