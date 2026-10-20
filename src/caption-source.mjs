import {parseSnapshot} from './snapshot.mjs';

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
  const observe=()=>{
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
  listen(video,'emptied',()=>{failure='media-source-changed';});
  const observer=new view.MutationObserver(observe);
  if(captionSelector)observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden']});
  const close=()=>{
    if(disposed)return;disposed=true;clearTimeout(timer);observer.disconnect();removers.forEach(remove=>remove());queue.length=0;
    if(window[key]?.token===token)delete window[key];
  };
  const renew=()=>{clearTimeout(timer);timer=setTimeout(close,leaseMs);};
  const freeze=()=>{if(disposed||frozen)return;observe();frozen=true;observer.disconnect();removers.forEach(remove=>remove());renew();};
  window[key]={token,read(){
    renew();
    if(selected.tagName==='IFRAME'){
      try{if(selected.contentDocument!==root)failure='frame-document-changed';}catch{failure='frame-document-changed';}
    }
    if(!chosenTrack()&&!captionSelector)failure='caption-source-unavailable';
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

export async function createCaptionSource(page,{selector,captionSelector=null,captionMode='auto'}={}){
  if(!['auto','event','snapshot'].includes(captionMode))throw new Error('captionMode must be auto, event, or snapshot');
  let fallbackReason=null;
  if(captionMode!=='snapshot'){
    const probe=await page.evaluate(installCaptionProbe,{selector,captionSelector});
    if(probe.available){
      return {kind:`event:${probe.source}`,fallbackReason:null,
        read:()=>page.evaluate(captionProbeCommand,{token:probe.token,action:'read'}),
        ack:through=>page.evaluate(captionProbeCommand,{token:probe.token,action:'ack',through}),
        stop:()=>page.evaluate(captionProbeCommand,{token:probe.token,action:'stop'}),
        close:()=>page.evaluate(captionProbeCommand,{token:probe.token,action:'close'})};
    }
    fallbackReason=probe.reason;
    if(captionMode==='event')throw new Error(`Event caption source unavailable: ${fallbackReason}`);
  }
  return {kind:'ego-accessibility-poll',fallbackReason,
    async read(){const snapshot=await page.snapshot(),state=parseSnapshot(snapshot);return {healthy:state.playerFound,state,events:[{type:'caption',text:state.caption,mediaTime:state.mediaTime}],rawBytes:Buffer.byteLength(snapshot)};},
    async ack(){},async close(){}};
}
