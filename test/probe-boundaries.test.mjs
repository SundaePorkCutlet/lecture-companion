// Narrow DOM doubles exercise source-selection/lifecycle decisions; real browser
// cuechange and MutationObserver mechanics are covered by test:browser.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {installCaptionProbe,captionProbeCommand} from '../src/caption-source.mjs';

function fixture({iframe=false,tracks=[]}={}){
  class TrackList extends EventTarget{*[Symbol.iterator](){yield* tracks;}}
  class Observer{observe(){}disconnect(){}}
  const view={MutationObserver:Observer,getComputedStyle:()=>({visibility:'visible'})};
  const caption={innerText:'visible subtitle',getClientRects:()=>[{}]};
  const doc={defaultView:view,querySelectorAll:s=>s==='video'?[video]:s==='#caption'?[caption]:[]};
  const video=Object.assign(new EventTarget(),{ownerDocument:doc,isConnected:true,textTracks:new TrackList(),currentTime:1.25,paused:true,playbackRate:1,ended:false,duration:20});
  const selected=iframe?{tagName:'IFRAME',isConnected:true,contentDocument:doc}:{tagName:'SECTION',isConnected:true,matches:()=>false,querySelectorAll:doc.querySelectorAll};
  const window={};const context={window,document:{querySelectorAll:()=>[selected]},crypto:{randomUUID:()=> 'fixture-id'},setTimeout,clearTimeout};
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
