import {test} from 'node:test';
import assert from 'node:assert/strict';

test('the bundled synthetic lecture serves locally without exposing session files',async()=>{
  const {serveDemo}=await import('../src/demo.mjs');
  const demo=await serveDemo();
  try{
    assert.match(demo.url,/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const page=await fetch(demo.url),html=await page.text();
    assert.match(page.headers.get('content-type'),/text\/html/);
    assert.match(html,/Synthetic/);assert.match(html,/id="player"/);assert.match(html,/id="caption"/);
    const video=await fetch(new URL('lecture.webm',demo.url));
    assert.equal(video.status,200);assert.match(video.headers.get('content-type'),/video\/webm/);
    assert.ok((await video.arrayBuffer()).byteLength>1000);
    assert.equal((await fetch(new URL('events.jsonl',demo.url))).status,404);
    assert.equal((await fetch(demo.url,{method:'POST'})).status,405);
  }finally{await demo.close();}
});
