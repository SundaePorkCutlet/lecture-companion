// Narrow DOM doubles exercise source-selection/lifecycle decisions; real browser
// cuechange and MutationObserver mechanics are covered by test:browser.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {installCaptionProbe,captionProbeCommand} from '../src/caption-source.mjs';
import * as sources from '../src/caption-source.mjs';

function fixture({iframe=false,tracks=[]}={}){
  class TrackList extends EventTarget{*[Symbol.iterator](){yield* tracks;}}
  class Observer{observe(){}disconnect(){}}
  const view={MutationObserver:Observer,getComputedStyle:()=>({visibility:'visible'})};
  const caption={innerText:'visible subtitle',getClientRects:()=>[{}]};
  const doc={defaultView:view,querySelectorAll:s=>s==='video'?[video]:s==='#caption'?[caption]:[]};
  const video=Object.assign(new EventTarget(),{ownerDocument:doc,isConnected:true,textTracks:new TrackList(),currentSrc:'original.webm',currentTime:1.25,paused:true,playbackRate:1,ended:false,duration:20});
  const selected=iframe?{tagName:'IFRAME',isConnected:true,contentDocument:doc}:{tagName:'SECTION',isConnected:true,matches:()=>false,querySelectorAll:doc.querySelectorAll};
  const window={};const context={window,document:{querySelectorAll:()=>[selected]},crypto:{randomUUID:()=> 'fixture-id'},setTimeout,clearTimeout,TextEncoder};
  const install=args=>runInNewContext(`(${installCaptionProbe.toString()})(${JSON.stringify(args)})`,context);
  const command=args=>runInNewContext(`(${captionProbeCommand.toString()})(${JSON.stringify(args)})`,context);
  return {install,command,selected,doc,video,caption};
}

test('hidden metadata track cannot override visible DOM subtitles',()=>{
  const f=fixture({tracks:[Object.assign(new EventTarget(),{kind:'metadata',mode:'hidden',activeCues:[]})]});
  const p=f.install({selector:'#player',captionSelector:'#caption'});
  try{assert.equal(p.source,'dom-mutation');assert.equal(f.command({token:p.token,action:'read'}).events[0].text,'visible subtitle');}
  finally{f.command({token:p.token,action:'close'});}
});

test('browser probe refuses oversized UTF-8 text rather than queueing or silently truncating it',()=>{
  const f=fixture();f.caption.innerText='한글';
  const p=f.install({selector:'#player',captionSelector:'#caption',maxCaptionBytes:16});
  try{
    f.caption.innerText='한'.repeat(6);f.video.dispatchEvent(new Event('timeupdate'));
    const packet=f.command({token:p.token,action:'read'});
    assert.equal(packet.failure,'resource-limit');assert.equal(packet.healthy,false);
    assert.ok(!packet.events.some(e=>e.text==='한'.repeat(6)));
  }finally{f.command({token:p.token,action:'close'});}
});

test('browser queue and returned packets are byte bounded while reporting dropped evidence',()=>{
  const f=fixture(),p=f.install({selector:'#player',captionSelector:'#caption',maxQueueBytes:1200,maxPacketBytes:800});
  try{
    for(let i=0;i<20;i++){f.caption.innerText=`${i}:`+'a'.repeat(200);f.video.dispatchEvent(new Event('timeupdate'));}
    let packet=f.command({token:p.token,action:'read'}),count=0;
    assert.ok(packet.dropped>0);
    while(packet.events.length){
      assert.ok(Buffer.byteLength(JSON.stringify(packet.events))<=800);
      count+=packet.events.length;
      f.command({token:p.token,action:'ack',through:packet.events.at(-1).seq});
      packet=f.command({token:p.token,action:'read'});
    }
    assert.ok(count<20);
  }finally{f.command({token:p.token,action:'close'});}
});

test('navigation to a new iframe document invalidates an old still-connected video',()=>{
  const f=fixture({iframe:true});const p=f.install({selector:'#player',captionSelector:'#caption'});
  try{f.selected.contentDocument={};assert.equal(f.command({token:p.token,action:'read'}).healthy,false);}
  finally{f.command({token:p.token,action:'close'});}
});

test('freezing observes the final DOM value before listeners are detached',()=>{
  const f=fixture();const p=f.install({selector:'#player',captionSelector:'#caption'});
  try{f.caption.innerText='final value';const packet=f.command({token:p.token,action:'stop'});assert.equal(packet.events.at(-1).text,'final value');}
  finally{f.command({token:p.token,action:'close'});}
});

test('play, pause and playback rate changes retain their observed state in the acknowledged queue',()=>{
  const f=fixture(),p=f.install({selector:'#player',captionSelector:'#caption'});
  try{
    f.video.paused=false;f.video.dispatchEvent(new Event('play'));
    f.video.playbackRate=1.5;f.video.currentTime=4;f.video.dispatchEvent(new Event('ratechange'));
    f.video.paused=true;f.video.currentTime=5;f.video.dispatchEvent(new Event('pause'));
    const packet=f.command({token:p.token,action:'read'}),playback=packet.events.filter(e=>e.type==='playback');
    assert.deepEqual(Array.from(playback,e=>e.action),['play','ratechange','pause']);
    assert.equal(playback[0].paused,false);assert.equal(playback[1].playbackRate,1.5);assert.equal(playback[2].mediaTime,5);
    assert.equal(packet.state.playbackRate,1.5);
    f.command({token:p.token,action:'ack',through:packet.events.at(-1).seq});
    assert.equal(f.command({token:p.token,action:'read'}).events.length,0);
  }finally{f.command({token:p.token,action:'close'});}
});

test('snapshot fallback detects a changed iframe without returning its signed URL',()=>{
  const selected=Object.assign(new EventTarget(),{tagName:'IFRAME',isConnected:true,src:'https://course.test/a?jwt=PRIVATE',contentDocument:null});
  const window={},context={window,document:{querySelectorAll:()=>[selected]},crypto:{randomUUID:()=> 'snapshot-id'},setTimeout,clearTimeout};
  const p=runInNewContext(`(${sources.installSnapshotProbe?.toString()})({selector:'#player'})`,context);
  const command=action=>runInNewContext(`(${sources.snapshotProbeCommand?.toString()})(${JSON.stringify({token:p.token,action})})`,context);
  try{
    assert.equal(command('read').healthy,true);
    selected.src='https://course.test/b?jwt=PRIVATE';
    const packet=command('read');assert.equal(packet.healthy,false);assert.equal(packet.failure,'player-changed');
    assert.ok(!JSON.stringify(packet).includes('PRIVATE'));
  }finally{command('close');}
});

test('an emptied media element freezes captions before the next lecture can enter the queue',()=>{
  const f=fixture(),p=f.install({selector:'#player',captionSelector:'#caption'});
  try{
    f.video.dispatchEvent(new Event('emptied'));f.caption.innerText='caption from NEXT lecture';
    f.video.dispatchEvent(new Event('loadedmetadata'));
    const packet=f.command({token:p.token,action:'read'});
    assert.equal(packet.failure,'media-source-changed');
    assert.ok(!packet.events.some(e=>e.text?.includes('NEXT')));
  }finally{f.command({token:p.token,action:'close'});}
});

test('snapshot binding accepts initial media loading and then detects replacement of that same video',()=>{
  const video=Object.assign(new EventTarget(),{tagName:'VIDEO',isConnected:true,currentSrc:'',matches:()=>true});
  const window={},context={window,document:{querySelectorAll:()=>[video]},crypto:{randomUUID:()=> 'loading-id'},setTimeout,clearTimeout};
  const p=runInNewContext(`(${sources.installSnapshotProbe.toString()})({selector:'video'})`,context);
  const command=action=>runInNewContext(`(${sources.snapshotProbeCommand.toString()})(${JSON.stringify({token:p.token,action})})`,context);
  try{
    assert.equal(command('read').healthy,true);
    video.dispatchEvent(new Event('emptied'));video.currentSrc='original.webm';
    assert.equal(command('read').healthy,true,'the original resource loading is not a lecture transition');
    video.currentSrc='next.webm';assert.equal(command('read').failure,'player-changed');
  }finally{command('close');}
});
