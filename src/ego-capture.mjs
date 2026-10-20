import {existsSync,writeFileSync,renameSync,unlinkSync,openSync,closeSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {CaptionTracker,Journal} from './core.mjs';
import {parseSnapshot} from './snapshot.mjs';
import {VisualGate,prepareFrame} from './visual.mjs';

export async function runCapture({page,out,durationSec=1800,pollMs=500,frameMs=2000,batchMs=90000,selector='iframe[src*="kollus.com"]',onNotice=()=>{}}){
  for(const v of [durationSec,pollMs,frameMs,batchMs])if(!Number.isFinite(v)||v<=0)throw new Error('Capture intervals must be positive');
  mkdirSync(out,{recursive:true,mode:0o700});
  const lock=join(out,'.capture.lock');closeSync(openSync(lock,'wx',0o600));
  const started=Date.now(),tracker=new CaptionTracker(),gate=new VisualGate();
  const metrics={state:'capturing',adapter:'ego-accessibility-poll',startedAt:new Date(started).toISOString(),pollMs,frameMs,polls:0,captionEvents:0,frameSamples:0,framesSaved:0,maxPollGapMs:0,rawSnapshotBytes:0,modelCalls:0,tokenUsage:null,timestampMode:'wall-clock; mediaTime unavailable',limitations:['Polling may miss captions shorter than the observation interval.','No audio captured. No completeness guarantee.','Bottom 20% excluded from images; small annotations may be filtered.']};
  let journal,lastObserved=started,lastFrame=-Infinity,lastNotice=started;
  const measureGap=now=>{const gap=now-lastObserved;metrics.maxPollGapMs=Math.max(metrics.maxPollGapMs,gap);if(gap>Math.max(2000,pollMs*4))journal?.append({type:'observation-gap',durationMs:gap,reason:'collector observation delayed; subtitle coverage unknown',mediaTime:null});lastObserved=now;};
  const status=()=>{metrics.elapsedSec=Math.round((Date.now()-started)/100)/10;metrics.lastEventId=journal?.lastId??0;metrics.updatedAt=new Date().toISOString();writeFileSync(join(out,'status.json.tmp'),JSON.stringify(metrics,null,2),{mode:0o600});renameSync(join(out,'status.json.tmp'),join(out,'status.json'));};
  try{
    journal=new Journal(out);journal.append({type:'start',adapter:metrics.adapter,mediaTime:null});
    status();onNotice({type:'started',out});
    while(Date.now()-started<durationSec*1000 && !existsSync(join(out,'STOP'))){
      const now=Date.now();
      const snapshot=await page.snapshot();measureGap(Date.now());const state=parseSnapshot(snapshot);
      metrics.rawSnapshotBytes+=Buffer.byteLength(snapshot);metrics.polls++;
      if(!state.playerFound)throw new Error('Player not observed');
      const caption=tracker.observe({text:state.caption,mediaTime:state.mediaTime});
      if(caption){journal.append(caption);if(caption.type==='caption')metrics.captionEvents++;}
      if(now-lastFrame>=frameMs){
        lastFrame=now;
        const clip=await page.evaluate(selector=>{
          const nodes=[...document.querySelectorAll(selector)];
          if(nodes.length!==1)throw new Error('Choose exactly one player element');
          if(nodes[0].tagName==='IFRAME'){
            const visible=[...document.querySelectorAll('iframe')].filter(f=>{const r=f.getBoundingClientRect();return r.width>50&&r.height>50&&getComputedStyle(f).visibility!=='hidden'&&getComputedStyle(f).display!=='none';});
            if(visible.length!==1||visible[0]!==nodes[0])throw new Error('Exactly one visible player iframe is supported');
          }
          const r=nodes[0].getBoundingClientRect();
          if(r.x<0||r.y<0||r.width<50||r.height<50||r.right>innerWidth||r.bottom>innerHeight)throw new Error('Player must be fully visible');
          return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};
        },selector);
        const shot=await page.cdp('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:false});
        const {png,pixels}=await prepareFrame(Buffer.from(shot.data,'base64'));metrics.frameSamples++;
        if(gate.observe(pixels)){
          const file=`frame-${String(journal.lastId+1).padStart(6,'0')}.png`;
          writeFileSync(join(out,file),png,{mode:0o600});journal.append({type:'frame',file,mediaTime:state.mediaTime});metrics.framesSaved++;
        }
      }
      status();
      if(now-lastNotice>=batchMs){lastNotice=now;onNotice({type:'batch-ready',lastEventId:journal.lastId,captions:metrics.captionEvents,frames:metrics.framesSaved});}
      await delay(Math.max(1,pollMs-(Date.now()-now)));
    }
    measureGap(Date.now());metrics.state='stopped';journal.append({type:'end',reason:existsSync(join(out,'STOP'))?'stop-request':'duration-limit',mediaTime:null});status();onNotice({type:'stopped',lastEventId:journal.lastId});return metrics;
  }catch{
    measureGap(Date.now());metrics.state='error';journal?.append({type:'interruption',reason:'Browser observation failed or control changed. Capture stopped; coverage after last event is unknown.',mediaTime:null});status();
    throw new Error('Capture stopped: browser observation failed or control changed. Inspect the authorized player before restarting.');
  }finally{unlinkSync(lock);}
}
