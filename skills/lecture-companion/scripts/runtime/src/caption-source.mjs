import {parseSnapshot} from './snapshot.mjs';

function requireCurrent(packet){
  if(packet.healthy)return;
  const error=new Error('Selected player source is no longer available');
  if(['player-changed','media-source-changed','frame-document-changed'].includes(packet.failure))error.code='PLAYER_CHANGED';
  throw error;
}

// Serialized into the selected page. Keep this function self-contained.
export function installCaptionProbe({selector,captionSelector=null,capacity=2048,leaseMs=5000}){
  if(!Number.isInteger(capacity)||capacity<1||capacity>10000||leaseMs<1000||leaseMs>60000)throw new Error('Invalid caption probe limits');
  const key='__lectureCompanionProbeV2';
  if(window[key])throw new Error('A caption collector is already installed on this page');
  const nodes=document.querySelectorAll(selector);
  if(nodes.length!==1)throw new Error('Choose exactly one player element');
  const selected=nodes[0];let root=selected;
  if(selected.tagName==='IFRAME'){
    try{root=selected.contentDocument;if(!root)return {available:false,reason:'cross-origin-frame'};}
    catch{return {available:false,reason:'cross-origin-frame'};}
  }
  const videos=root.matches?.('video')?[root]:[...root.querySelectorAll('video')];
  if(videos.length!==1)return {available:false,reason:'video-not-found-or-ambiguous'};
  const video=videos[0],view=video.ownerDocument.defaultView;
  let mediaSrc=video.currentSrc,requestedSrc=video.src;
  const chosenTrack=()=>{
    const tracks=[...video.textTracks].filter(t=>t.kind==='captions'||t.kind==='subtitles');
    return tracks.find(t=>t.mode==='showing')??tracks.find(t=>t.mode==='hidden');
  };
  if(!chosenTrack()&&!captionSelector)return {available:false,reason:'no-enabled-text-track-or-caption-selector'};
  if(captionSelector&&root.querySelectorAll(captionSelector).length!==1)return {available:false,reason:'caption-element-not-found-or-ambiguous'};
  const token=crypto.randomUUID(),queue=[],removers=[];let seq=0,dropped=0,disposed=false,frozen=false,timer,lastText,lastTime=null,failure=null;
  const media=()=>({mediaTime:Number.isFinite(video.currentTime)?video.currentTime:null,paused:video.paused,playbackRate:Number.isFinite(video.playbackRate)?video.playbackRate:null,ended:video.ended,duration:Number.isFinite(video.duration)?video.duration:null});
  const push=event=>{
    if(disposed||frozen)return;
    if(queue.length===capacity){queue.shift();dropped++;}
    queue.push({...event,seq:++seq,observedAt:new Date().toISOString()});
  };
  const source=()=>chosenTrack()?'text-track':'dom-mutation';
  const checkMedia=()=>{
    if(!mediaSrc&&video.currentSrc){mediaSrc=video.currentSrc;requestedSrc=video.src;}
    else if(mediaSrc&&(video.currentSrc!==mediaSrc||video.src!==requestedSrc)){failure??='media-source-changed';frozen=true;}
  };
  const observe=()=>{
    checkMedia();
    if(disposed||frozen)return;
    const track=chosenTrack();let text='';
    if(track)text=[...(track.activeCues??[])].map(c=>c.getCueAsHTML?c.getCueAsHTML().textContent:c.text).join(' ');
    else if(captionSelector){
      const captions=root.querySelectorAll(captionSelector);
      if(captions.length>1){failure='ambiguous-caption';return;}
      const node=captions[0];
      if(node&&node.getClientRects().length&&view.getComputedStyle(node).visibility!=='hidden')text=node.innerText??node.textContent??'';
    }
    text=text.replace(/\s+/g,' ').trim();
    if(text!==lastText){push({type:'caption',text,mediaTime:media().mediaTime,source:source()});lastText=text;}
    lastTime=media().mediaTime;
  };
  const listen=(target,name,fn)=>{target.addEventListener(name,fn);removers.push(()=>target.removeEventListener(name,fn));};
  const tracked=new Set();
  const attachTracks=()=>{
    for(const track of video.textTracks)if(!tracked.has(track)){tracked.add(track);listen(track,'cuechange',observe);}
    observe();
  };
  listen(video.textTracks,'addtrack',attachTracks);listen(video.textTracks,'change',attachTracks);
  for(const event of ['timeupdate','loadedmetadata','seeked'])listen(video,event,observe);
  for(const action of ['play','pause','ratechange'])listen(video,action,()=>push({type:'playback',action,...media()}));
  listen(video,'seeking',()=>{push({type:'seek',from:lastTime,mediaTime:media().mediaTime});lastText=undefined;observe();});
  listen(video,'ended',()=>{observe();push({type:'media-ended',mediaTime:media().mediaTime});});
  listen(video,'emptied',()=>{if(mediaSrc){failure='media-source-changed';frozen=true;}});
  const observer=new view.MutationObserver(observe);
  if(captionSelector)observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden']});
  const close=()=>{
    if(disposed)return;disposed=true;clearTimeout(timer);observer.disconnect();removers.forEach(remove=>remove());queue.length=0;
    if(window[key]?.token===token)delete window[key];
  };
  const renew=()=>{clearTimeout(timer);timer=setTimeout(close,leaseMs);};
  const freeze=()=>{if(disposed||frozen)return;observe();frozen=true;observer.disconnect();removers.forEach(remove=>remove());renew();};
  window[key]={token,read(){
    renew();checkMedia();
    if(selected.tagName==='IFRAME'){
      try{if(selected.contentDocument!==root)failure='frame-document-changed';}catch{failure='frame-document-changed';}
    }
    if(!chosenTrack()&&!captionSelector)failure??='caption-source-unavailable';
    if(!selected.isConnected||!video.isConnected)failure??='player-changed';
    return {events:queue.slice(0,256),hasMore:queue.length>256,dropped,healthy:!failure&&selected.isConnected&&video.isConnected,failure,source:source(),state:media()};
  },ack(through){
    if(!Number.isInteger(through)||through<0||through>seq)throw new Error('Invalid caption acknowledgment');
    while(queue.length&&queue[0].seq<=through)queue.shift();renew();
  },stop(){freeze();return this.read();},close};
  renew();attachTracks();return {available:true,token,source:source()};
}

export function captionProbeCommand({token,action,through}){
  const probe=window.__lectureCompanionProbeV2;
  if(!probe||probe.token!==token)throw new Error('Caption source disconnected or lease expired');
  if(action==='read')return probe.read();
  if(action==='stop')return probe.stop();
  if(action==='ack'){probe.ack(through);return true;}
  if(action==='close'){probe.close();return true;}
  throw new Error('Unknown caption source command');
}

// Snapshot fallback still binds to the originally selected player. Keep source
// URLs and DOM references inside the browser; return only a boundary code.
export function installSnapshotProbe({selector,leaseMs=60000}){
  const key='__lectureCompanionSnapshotV1';
  if(window[key])throw new Error('A snapshot collector is already installed on this page');
  const nodes=document.querySelectorAll(selector);
  if(nodes.length!==1)throw new Error('Choose exactly one player element');
  const selected=nodes[0],token=crypto.randomUUID(),src=selected.src;
  const frameDocument=()=>{try{return selected.contentDocument??null;}catch{return null;}};
  const originalDocument=frameDocument(),root=selected.tagName==='IFRAME'?originalDocument:selected;
  const videos=root?.matches?.('video')?[root]:[...(root?.querySelectorAll('video')??[])];
  const video=videos.length===1?videos[0]:null;
  let mediaSrc=video?.currentSrc,requestedSrc=video?.src,changed=false,timer;
  const markChanged=()=>{changed=true;};
  const mediaEmptied=()=>{if(mediaSrc)markChanged();};
  if(selected.tagName==='IFRAME')selected.addEventListener('load',markChanged);
  video?.addEventListener('emptied',mediaEmptied);
  const close=()=>{
    clearTimeout(timer);selected.removeEventListener('load',markChanged);video?.removeEventListener('emptied',mediaEmptied);
    if(window[key]?.token===token)delete window[key];
  };
  const renew=()=>{clearTimeout(timer);timer=setTimeout(close,leaseMs);};
  window[key]={token,read(){
    renew();const current=document.querySelectorAll(selector);
    if(!mediaSrc&&video?.currentSrc){mediaSrc=video.currentSrc;requestedSrc=video.src;}
    changed||=current.length!==1||current[0]!==selected||!selected.isConnected||selected.tagName==='IFRAME'&&selected.src!==src||frameDocument()!==originalDocument||Boolean(video&&(!video.isConnected||mediaSrc&&(video.currentSrc!==mediaSrc||video.src!==requestedSrc)));
    return {healthy:!changed,failure:changed?'player-changed':null};
  },close};
  renew();return {token};
}

export function snapshotProbeCommand({token,action}){
  const probe=window.__lectureCompanionSnapshotV1;
  if(!probe||probe.token!==token)return {healthy:false,failure:'snapshot-probe-unavailable'};
  if(action==='read')return probe.read();
  if(action==='close'){probe.close();return true;}
  throw new Error('Unknown snapshot probe command');
}

export async function createCaptionSource(page,{selector,captionSelector=null,captionMode='auto'}={}){
  if(!['auto','event','snapshot'].includes(captionMode))throw new Error('captionMode must be auto, event, or snapshot');
  let fallbackReason=null;
  if(captionMode!=='snapshot'){
    const probe=await page.evaluate(installCaptionProbe,{selector,captionSelector,...(page.captionLeaseMs?{leaseMs:page.captionLeaseMs}:{})});
    if(probe.available){
      return {kind:`event:${probe.source}`,fallbackReason:null,
        assertCurrent:async()=>requireCurrent(await page.evaluate(captionProbeCommand,{token:probe.token,action:'read'})),
        read:()=>page.evaluate(captionProbeCommand,{token:probe.token,action:'read'}),
        ack:through=>page.evaluate(captionProbeCommand,{token:probe.token,action:'ack',through}),
        stop:()=>page.evaluate(captionProbeCommand,{token:probe.token,action:'stop'}),
        close:()=>page.evaluate(captionProbeCommand,{token:probe.token,action:'close'})};
    }
    fallbackReason=probe.reason;
    if(captionMode==='event')throw new Error(`Event caption source unavailable: ${fallbackReason}`);
  }
  const probe=await page.evaluate(installSnapshotProbe,{selector});
  if(!probe.token)throw new Error('Snapshot player binding unavailable');
  const assertCurrent=async()=>{
    const state=await page.evaluate(snapshotProbeCommand,{token:probe.token,action:'read'});
    requireCurrent(state);
  };
  return {kind:page.snapshotKind??'ego-accessibility-poll',fallbackReason,assertCurrent,
    async read(){
      await assertCurrent();
      const observed=page.readCaptionSnapshot?await page.readCaptionSnapshot(selector):null;
      const snapshot=observed?null:await page.snapshot(),state=observed?.state??parseSnapshot(snapshot);
      await assertCurrent();
      return {healthy:state.playerFound,state,events:[{type:'caption',text:state.caption,mediaTime:state.mediaTime}],rawBytes:observed?.rawBytes??Buffer.byteLength(snapshot)};
    },
    async ack(){},close:()=>page.evaluate(snapshotProbeCommand,{token:probe.token,action:'close'})};
}
