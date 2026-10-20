import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Journal} from '../src/core.mjs';

test('public study CLI runs question, answer, catch-up, grounded commit and combined export',()=>{
  const dir=mkdtempSync(join(tmpdir(),'study-cli-'));
  const run=(...args)=>spawnSync(process.execPath,['bin/lecture.mjs',...args],{encoding:'utf8'});
  const study=(command,...args)=>{
    const r=run('study',command,'--out',dir,...args);assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
  };
  const file=(name,value)=>{const path=join(dir,name);writeFileSync(path,JSON.stringify(value));return path;};
  assert.equal(run('demo','--out',dir).status,0);
  study('init');
  study('mode','--mode','question','--file',file('question.json',{key:'ask',question:{key:'q1',kind:'question',text:'왜 필요한가?',evidence:[2]}}));
  assert.equal(study('next').blocked,true);
  study('note','--file',file('answer.json',{key:'answer',items:[{key:'a1',kind:'answer',questionKey:'q1',text:'질문에 대한 설명',evidence:[2]}]}));
  new Journal(dir).append({type:'caption',text:'질문 중 새로 수집한 내용',mediaTime:null});
  study('mode','--mode','catch-up');
  let b=study('next','--bytes','2048'),n=0;
  while(b.receipt){
    assert.ok(Buffer.byteLength(JSON.stringify(b))<=2048);
    study('commit','--file',file('commit.json',{key:`c${n++}`,receipt:b.receipt,items:[],dispositions:b.events.map(e=>({eventId:e.id,action:'reviewed',reason:'Inspected synthetic fixture.'}))}));
    b=study('next','--bytes','2048');
  }
  assert.equal(study('status').committedCursor,23);
  const output=study('export');
  assert.match(readFileSync(output.notesPath,'utf8'),/왜 필요한가/);
  assert.equal(JSON.parse(readFileSync(output.jsonPath,'utf8')).items.length,2);
  assert.notEqual(run('study','next').status,0);
  assert.notEqual(run('study','next','--out',dir,'--bytes','100').status,0);
  assert.notEqual(run('study','mode','--out',dir,'--mode','broken').status,0);
  assert.notEqual(run('study','commit','--out',dir,'--file',file('bad.json',{})).status,0);
});
