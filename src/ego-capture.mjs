import {existsSync,writeFileSync,renameSync,unlinkSync,openSync,closeSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {CaptionTracker,Journal} from './core.mjs';
import {createCaptionSource} from './caption-source.mjs';
import {VisualWorker} from './visual-worker.mjs';
import {capturePlayerFrame} from './player-frame.mjs';

export async function runCapture({page,out,durationSec=1800,pollMs=500,frameMs=2000,batchMs=90000,
  selector='iframe[src*="kollus.com"]',captionSelector=null,captionMode='auto',browser='ego',imageNode=process.execPath,imageRuntime=null,source:providedSource,onNotice=()=>{}}){
  for(const v of [durationSec,pollMs,frameMs,batchMs])if(!Number.isFinite(v)||v<=0)throw new Error('Capture intervals must be positive');
  mkdirSync(out,{recursive:true,mode:0o700});
  const lock=join(out,'.capture.lock');closeSync(openSync(lock,'wx',0o600));
  const started=Date.now(),tracker=new CaptionTracker(),abort=new AbortController();
  const metrics={state:'capturing',browser,adapter:'resolving',fallbackReason:null,startedAt:new Date(started).toISOString(),pollMs,frameMs,
    polls:0,captionEvents:0,frameSamples:0,framesSaved:0,maxPollGapMs:0,maxScreenshotMs:0,maxImageProcessingMs:0,
    captionEventsDropped:0,rawSnapshotBytes:0,modelCalls:0,tokenUsage:null,timestampMode:'source-dependent',imageProcessor:'external-node-process',
    limitations:['No audio captured. No completeness guarantee.','Bottom 20% masked only for comparison; changes confined there may be filtered.']};
  let journal,source,processor,visualTask=Promise.resolve(),fatal=null,lastObserved=started,lastNotice=started,ended=false,lastMediaTime=null;
  const measureGap=now=>{
    const gap=now-lastObserved;metrics.maxPollGapMs=Math.max(metrics.maxPollGapMs,gap);
    if(gap>Math.max(2000,pollMs*4))journal?.append({type:'observation-gap',durationMs:gap,reason:'Caption observation/read delayed; inspect source mode and overflow for coverage uncertainty.',mediaTime:null});
    lastObserved=now;
  };
  const status=()=>{
    metrics.elapsedSec=Math.round((Date.now()-started)/100)/10;metrics.lastEventId=journal?.lastId??0;metrics.updatedAt=new Date().toISOString();
    writeFileSync(join(out,'status.json.tmp'),JSON.stringify(metrics,null,2),{mode:0o600});renameSync(join(out,'status.json.tmp'),join(out,'status.json'));
  };
  const wait=ms=>delay(Math.max(1,ms),undefined,{signal:abort.signal}).catch(error=>{if(error.name!=='AbortError')throw error;});
  const consume=async packet=>{
    if(fatal)throw fatal;
    lastMediaTime=packet.state?.mediaTime??null;
    if((packet.dropped??0)>metrics.captionEventsDropped){
      journal.append({type:'caption-overflow',dropped:packet.dropped-metrics.captionEventsDropped,mediaTime:lastMediaTime});metrics.captionEventsDropped=packet.dropped;
    }
    for(const event of packet.events){
      if(event.type==='caption'){
        const caption=source.kind.startsWith('event:')?event:tracker.observe({text:event.text,mediaTime:event.mediaTime});
        if(caption?.text){journal.append(caption);metrics.captionEvents++;}
        else if(caption&&source.kind.startsWith('event:'))journal.append({...caption,type:'caption-clear'});
        else if(caption?.type==='seek')journal.append(caption);
      }else{journal.append(event);if(event.type==='media-ended')ended=true;}
    }
    if(!packet.healthy&&!ended)throw new Error('Caption source disconnected');
    if(fatal)throw fatal;
    const through=packet.events.at(-1)?.seq;if(through!==undefined)await source.ack(through);
    if(fatal)throw fatal;
  };
  try{
    journal=new Journal(out);
    source=providedSource??await createCaptionSource(page,{selector,captionSelector,captionMode});
    metrics.adapter=source.kind;metrics.fallbackReason=source.fallbackReason;
    metrics.timestampMode=source.kind.startsWith('event:')?'observed media time and wall-clock':'wall-clock; mediaTime unavailable';
    journal.append({type:'start',browser,adapter:source.kind,fallbackReason:source.fallbackReason,mediaTime:null});
    processor=new VisualWorker({nodeExecutable:imageNode,runtime:imageRuntime});status();onNotice({type:'started',out,adapter:source.kind,fallbackReason:source.fallbackReason});
    visualTask=(async()=>{
      while(!abort.signal.aborted){
        const begin=Date.now(),frame=await capturePlayerFrame(page,selector,abort.signal);
        if(!frame||abort.signal.aborted)return;
        metrics.maxScreenshotMs=Math.max(metrics.maxScreenshotMs,Date.now()-begin);metrics.frameSamples++;
        const result=await processor.process(frame);
        metrics.maxImageProcessingMs=Math.max(metrics.maxImageProcessingMs,result.processingMs);
        if(result.selected&&!abort.signal.aborted){
          const file=`frame-${String(journal.lastId+1).padStart(6,'0')}.png`;
          writeFileSync(join(out,file),Buffer.from(result.png),{mode:0o600});
          journal.append({type:'frame',file,mediaTime:null,observationStartedAt:new Date(begin).toISOString()});metrics.framesSaved++;
        }
        await wait(frameMs-(Date.now()-begin));
      }
    })().catch(error=>{fatal=error;abort.abort();});
    while(Date.now()-started<durationSec*1000&&!existsSync(join(out,'STOP'))&&!fatal&&!ended){
      const now=Date.now(),packet=await source.read();measureGap(Date.now());metrics.polls++;
      metrics.rawSnapshotBytes+=packet.rawBytes??0;await consume(packet);
      status();
      if(now-lastNotice>=batchMs){lastNotice=now;onNotice({type:'batch-ready',lastEventId:journal.lastId,captions:metrics.captionEvents,frames:metrics.framesSaved});}
      if(!ended&&!packet.hasMore)await wait(pollMs-(Date.now()-now));
    }
    abort.abort();if(fatal)throw fatal;
    // Freeze/drain and close the source promptly, before joining slow image work.
    if(source.stop){
      let packet=await source.stop();await consume(packet);
      while(packet.hasMore){packet=await source.read();await consume(packet);}
    }
    if(fatal)throw fatal;
    if(ended){try{await source.close();}catch{/* End observed; a reload may already have removed the probe. */}}
    else await source.close();
    await visualTask;if(fatal)throw fatal;await processor.close();
    measureGap(Date.now());
    metrics.state='stopped';journal.append({type:'end',reason:ended?'media-ended':existsSync(join(out,'STOP'))?'stop-request':'duration-limit',mediaTime:lastMediaTime});status();
    onNotice({type:'stopped',lastEventId:journal.lastId});return metrics;
  }catch{
    abort.abort();await visualTask;await processor?.close();
    // No browser calls after observation/control loss; the event probe lease expires locally.
    measureGap(Date.now());metrics.state='error';
    journal?.append({type:'interruption',reason:'Browser, caption source, or image worker failed. Capture stopped; inspect source before restarting.',mediaTime:null});status();
    throw new Error('Capture stopped: browser, caption source, or image worker failed. Inspect the authorized player before restarting.');
  }finally{unlinkSync(lock);}
}
