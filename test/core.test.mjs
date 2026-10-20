import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '../src/core.mjs';

test('caption observations deduplicate until silence, preserve repetition and seek', () => {
  const c = new core.CaptionTracker();
  assert.deepEqual(c.observe({text:'  Pod  생성 ',mediaTime:1}), {type:'caption',text:'Pod 생성',mediaTime:1});
  assert.equal(c.observe({text:'Pod 생성',mediaTime:2}), null);
  c.observe({text:'',mediaTime:3});
  assert.equal(c.observe({text:'Pod 생성',mediaTime:4}).text, 'Pod 생성');
  assert.equal(c.observe({text:'Pod 생성',mediaTime:0}).type, 'seek');
  assert.equal(c.observe({text:'Pod 생성',mediaTime:0.5}).type, 'caption');
});

test('journal resumes sequence and bounded batches never silently skip an event', () => {
  const dir = mkdtempSync(join(tmpdir(),'lecture-'));
  let j = new core.Journal(dir);
  j.append({type:'caption',text:'first',mediaTime:null});
  j.append({type:'caption',text:'second',mediaTime:null});
  j = new core.Journal(dir);
  assert.equal(j.append({type:'caption',text:'third'}).id, 3);
  const a=j.batch({after:0,maxBytes:512,maxEvents:1});
  assert.equal(a.events.length,1);
  assert.equal(a.nextCursor,1);
  assert.equal(a.hasMore,true);
  const b=j.batch({after:a.nextCursor,maxBytes:1000,maxEvents:10});
  assert.deepEqual(b.events.map(e=>e.text),['second','third']);
  assert.equal(j.batch({after:0,maxBytes:1000}).events.length,3);
  assert.equal(JSON.parse(readFileSync(join(dir,'events.jsonl'),'utf8').split('\n')[0]).id,1);
});

test('oversized evidence is returned as a bounded reference and truncated crash tail is repaired', () => {
  const dir=mkdtempSync(join(tmpdir(),'lecture-'));let j=new core.Journal(dir);
  j.append({type:'caption',text:'한'.repeat(5000)});
  const b=j.batch({after:0,maxBytes:800});
  assert.ok(Buffer.byteLength(JSON.stringify(b))<=800);
  assert.equal(b.nextCursor,1);assert.equal(b.events[0].omitted,true);
  appendFileSync(join(dir,'events.jsonl'),'{"id":2');
  j=new core.Journal(dir);assert.equal(j.append({type:'end'}).id,2);
  assert.equal(j.batch({after:0,maxBytes:20000}).events.length,2);
});

test('a read-only consumer never repairs a concurrent writer tail or creates missing sessions',()=>{
  const dir=mkdtempSync(join(tmpdir(),'lecture-live-'));const j=new core.Journal(dir);j.append({type:'caption',text:'saved'});
  appendFileSync(join(dir,'events.jsonl'),'{"id":2');
  const before=readFileSync(join(dir,'events.jsonl'),'utf8');
  const reader=new core.Journal(dir,{readOnly:true});
  assert.equal(reader.batch().events.length,1);
  assert.equal(readFileSync(join(dir,'events.jsonl'),'utf8'),before);
  assert.throws(()=>reader.append({type:'end'}),/read.only/i);
  assert.throws(()=>new core.Journal(join(dir,'missing'),{readOnly:true}));
});
