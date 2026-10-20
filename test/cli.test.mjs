import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('demo, bounded batches, stop and export work through the public CLI',()=>{
  const out=mkdtempSync(join(tmpdir(),'lecture-cli-'));
  const run=(...args)=>spawnSync(process.execPath,['bin/lecture.mjs',...args],{encoding:'utf8'});
  let r=run('demo','--out',out);assert.equal(r.status,0,r.stderr);
  r=run('batch','--out',out,'--after','0','--bytes','1000');assert.equal(r.status,0,r.stderr);
  assert.ok(Buffer.byteLength(r.stdout)<=1001);
  const batch=JSON.parse(r.stdout);assert.ok(batch.events.length>0);assert.ok(batch.nextCursor>0);
  const next=JSON.parse(run('batch','--out',out,'--after',String(batch.nextCursor)).stdout);
  assert.ok(next.events.every(e=>e.id>batch.nextCursor));
  r=run('export','--out',out);assert.equal(r.status,0,r.stderr);
  const doc=readFileSync(join(out,'transcript.md'),'utf8');
  assert.match(doc,/DEMO/);assert.match(doc,/mediaTime/);
  assert.equal(run('stop','--out',out).status,0);
  assert.notEqual(run('batch','--out',out,'--after','-1').status,0);
});
