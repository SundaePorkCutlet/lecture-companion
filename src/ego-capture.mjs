import {existsSync,writeFileSync,renameSync,unlinkSync,openSync,closeSync,mkdirSync,readdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {CaptionTracker,Journal} from './core.mjs';
import {createCaptionSource} from './caption-source.mjs';
import {VisualWorker} from './visual-worker.mjs';
import {capturePlayerFrame} from './player-frame.mjs';
import {resourceLimits as resolveLimits,ResourceLimitError,TERMINAL_BYTES,checkPacket} from './resource-limits.mjs';

export async function runCapture({page,out,durationSec=1800,pollMs=500,frameMs=2000,batchMs=90000,
  selector='iframe[src*="kollus.com"]',captionSelector=null,captionMode='auto',browser='ego',imageNode=process.execPath,imageRuntime=null,source:providedSource,resourceLimits={},onNotice=()=>{}}){
  for(const v of [durationSec,pollMs,frameMs,batchMs])if(!Number.isFinite(v)||v<=0)throw new Error('Capture intervals must be positive');
  const limits=resolveLimits(resourceLimits);
  mkdirSync(out,{recursive:true,mode:0o700});
  const lock=join(out,'.capture.lock');closeSync(openSync(lock,'wx',0o600));
  const started=Date.now(),tracker=new CaptionTracker(),abort=new AbortController();
  const metrics={state:'capturing',browser,adapter:'resolving',fallbackReason:null,startedAt:new Date(started).toISOString(),pollMs,frameMs,
    polls:0,captionEvents:0,frameSamples:0,framesSaved:0,maxPollGapMs:0,maxScreenshotMs:0,maxImageProcessingMs:0,
    captionEventsDropped:0,rawSnapshotBytes:0,modelCalls:0,tokenUsage:null,timestampMode:'source-dependent',imageProcessor:'external-node-process',
    resourceLimits:limits,limitations:['No audio captured. No completeness guarantee.','Bottom 20% masked only for comparison; changes confined there may be filtered.']};
  let journal,source,processor,visualTask=Promise.resolve(),fatal=null,lastObserved=started,lastNotice=started,ended=false,boundary=null,lastMediaTime=null,lastSeq=0,storedBytes=0;
  const checkStorage=(bytes,terminal=false)=>{if(storedBytes+bytes>limits.sessionBytes-(terminal?0:TERMINAL_BYTES))throw new ResourceLimitError('session-bytes');};
  const append=(event,options={})=>{
    const prepared=journal.prepare(event,options);checkStorage(prepared.bytes,options.terminal);
    const row=journal.append(event,options);storedBytes+=prepared.bytes;return row;
  };
  const changed=reason=>{boundary??=reason;abort.abort();};
  const measureGap=now=>{
    const gap=now-lastObserved;metrics.maxPollGapMs=Math.max(metrics.maxPollGapMs,gap);
    if(gap>Math.max(2000,pollMs*4)&&journal)append({type:'observation-gap',durationMs:gap,reason:'Caption observation/read delayed; inspect source mode and overflow for coverage uncertainty.',mediaTime:null});
    lastObserved=now;
  };
  const status=()=>{
    metrics.elapsedSec=Math.round((Date.now()-started)/100)/10;metrics.lastEventId=journal?.lastId??0;metrics.updatedAt=new Date().toISOString();
    writeFileSync(join(out,'status.json.tmp'),JSON.stringify(metrics,null,2),{mode:0o600});renameSync(join(out,'status.json.tmp'),join(out,'status.json'));
  };
  const wait=ms=>delay(Math.max(1,ms),undefined,{signal:abort.signal}).catch(error=>{if(error.name!=='AbortError')throw error;});
  const consume=async packet=>{
    if(fatal)throw fatal;
    const nextSeq=checkPacket(packet,limits,{eventMode:source.kind.startsWith('event:'),afterSeq:lastSeq});
    metrics.rawSnapshotBytes+=packet.rawBytes??0;
    if(!packet.healthy&&['media-source-changed','frame-document-changed','player-changed'].includes(packet.failure))changed(packet.failure);
    if(boundary&&!source.kind.startsWith('event:'))return;
    lastMediaTime=packet.state?.mediaTime??null;
    if((packet.dropped??0)>metrics.captionEventsDropped){
      append({type:'caption-overflow',dropped:packet.dropped-metrics.captionEventsDropped,mediaTime:lastMediaTime});metrics.captionEventsDropped=packet.dropped;
    }
    for(const event of packet.events){
      if(event.type==='caption'){
        const caption=source.kind.startsWith('event:')?event:tracker.observe({text:event.text,mediaTime:event.mediaTime});
        if(caption?.text){append(caption);metrics.captionEvents++;}
        else if(caption&&source.kind.startsWith('event:'))append({...caption,type:'caption-clear'});
        else if(caption?.type==='seek')append(caption);
      }else{append(event);if(event.type==='media-ended')ended=true;}
    }
    if(!packet.healthy&&!ended&&!boundary)throw new Error('Caption source disconnected');
    if(fatal)throw fatal;
    const through=packet.events.at(-1)?.seq;if(through!==undefined)await source.ack(through);
    lastSeq=nextSeq;
    if(fatal)throw fatal;
  };
  try{
    storedBytes=readdirSync(out).filter(name=>name==='events.jsonl'||name.endsWith('.png')).reduce((sum,name)=>{const info=lstatSync(join(out,name));return sum+(info.isFile()?info.size:0);},0);
    journal=new Journal(out,{limits});
    source=providedSource??await createCaptionSource(page,{selector,captionSelector,captionMode,limits});
    metrics.adapter=source.kind;metrics.fallbackReason=source.fallbackReason;
    metrics.timestampMode=source.kind.startsWith('event:')?'observed media time and wall-clock':'wall-clock; mediaTime unavailable';
    append({type:'start',browser,adapter:source.kind,fallbackReason:source.fallbackReason,mediaTime:null});
    processor=new VisualWorker({nodeExecutable:imageNode,runtime:imageRuntime});status();onNotice({type:'started',out,adapter:source.kind,fallbackReason:source.fallbackReason,
      dataHandling:{local:['captions','player-images','capture-metadata','notes-and-qa'],
        hostAI:['caption-batches','opened-player-images','summaries','questions-and-answers'],collectorUploads:false,
        explanation:'Host reads enter your configured AI provider context under its account retention/training settings. Visible sensitive data is not automatically redacted. Local files persist until deleted; local deletion does not delete host chat history.'}});
    visualTask=(async()=>{
      while(!abort.signal.aborted){
        await source.assertCurrent?.();
        if(abort.signal.aborted)return;
        const begin=Date.now(),frame=await capturePlayerFrame(page,selector,abort.signal);
        if(!frame||abort.signal.aborted)return;
        await source.assertCurrent?.();
        if(abort.signal.aborted)return;
        metrics.maxScreenshotMs=Math.max(metrics.maxScreenshotMs,Date.now()-begin);metrics.frameSamples++;
        const result=await processor.process(frame);
        metrics.maxImageProcessingMs=Math.max(metrics.maxImageProcessingMs,result.processingMs);
        if(result.selected&&!abort.signal.aborted){
          const file=`frame-${String(journal.lastId+1).padStart(6,'0')}.png`;
          const event={type:'frame',file,mediaTime:null,observationStartedAt:new Date(begin).toISOString()},bytes=result.png.length;
          const prepared=journal.prepare(event);checkStorage(bytes+prepared.bytes);
          writeFileSync(join(out,file),Buffer.from(result.png),{mode:0o600});storedBytes+=bytes;
          try{append(event);}catch(error){unlinkSync(join(out,file));storedBytes-=bytes;throw error;}
          metrics.framesSaved++;
        }
        await wait(frameMs-(Date.now()-begin));
      }
    })().catch(error=>{if(error.code==='PLAYER_CHANGED')changed('player-changed');else{fatal=error;abort.abort();}});
    while(Date.now()-started<durationSec*1000&&!existsSync(join(out,'STOP'))&&!fatal&&!ended&&!boundary){
      const now=Date.now();let packet;
      try{packet=await source.read();}catch(error){if(error.code==='PLAYER_CHANGED'){changed('player-changed');break;}throw error;}
      measureGap(Date.now());metrics.polls++;
      await consume(packet);
      status();
      if(now-lastNotice>=batchMs){lastNotice=now;onNotice({type:'batch-ready',lastEventId:journal.lastId,captions:metrics.captionEvents,frames:metrics.framesSaved});}
      if(!ended&&!packet.hasMore)await wait(pollMs-(Date.now()-now));
    }
    abort.abort();if(fatal)throw fatal;
    // Freeze/drain and close the source promptly, before joining slow image work.
    if(source.stop){
      let packet=await source.stop();await consume(packet);
      let drained=0;const deadline=Date.now()+2000;
      while(packet.hasMore){
        if(++drained>32||Date.now()>deadline)throw new ResourceLimitError('shutdown-drain');
        packet=await source.read();await consume(packet);
      }
    }
    if(fatal)throw fatal;
    if(ended||boundary){try{await source.close();}catch{/* A confirmed boundary may already have removed the probe. */}}
    else await source.close();
    await visualTask;if(fatal)throw fatal;await processor.close();
    measureGap(Date.now());
    metrics.state='stopped';metrics.stopReason=ended?'media-ended':boundary?'player-changed':existsSync(join(out,'STOP'))?'stop-request':'duration-limit';
    metrics.completed=ended;
    const detail=boundary&&!ended?'The selected player changed. This does not prove lecture completion; choose the next lecture explicitly.':null;
    append({type:'end',reason:metrics.stopReason,...(detail?{detail,boundary}:{}),mediaTime:lastMediaTime},{terminal:true});status();
    onNotice({type:'stopped',lastEventId:journal.lastId,reason:metrics.stopReason,completed:metrics.completed,
      actions:['Drain remaining study batches and export saved notes and Q&A.',...(boundary&&!ended?['Choose the intended lecture before starting a fresh session.']:[])]});return metrics;
  }catch(error){
    abort.abort();await visualTask;await processor?.close();
    const resource=error.code==='RESOURCE_LIMIT'||fatal?.code==='RESOURCE_LIMIT';
    if(resource){
      // Never drain more untrusted evidence after a quota failure. Close only;
      // if browser control was lost, its existing probe lease expires locally.
      try{await source?.close();}catch{}
      metrics.state='stopped';metrics.stopReason='resource-limit';metrics.completed=false;
      metrics.resourceLimit=(fatal?.code==='RESOURCE_LIMIT'?fatal:error).limit;
      try{if(journal)append({type:'end',reason:'resource-limit',limit:metrics.resourceLimit,mediaTime:null},{terminal:true});}catch{/* Existing oversized sessions remain untouched. */}
      status();onNotice({type:'stopped',reason:'resource-limit',completed:false,limit:metrics.resourceLimit,
        actions:['Capture stopped at a safety limit. Export already saved evidence and Q&A; inspect the selected source before starting a fresh session.']});return metrics;
    }
    // No browser calls after observation/control loss; the event probe lease expires locally.
    metrics.state='error';metrics.stopReason='observation-error';metrics.completed=false;
    try{if(journal)append({type:'interruption',reason:'Browser, caption source, or image worker failed. Capture stopped; inspect source before restarting.',mediaTime:null},{terminal:true});}finally{status();}
    throw new Error('Capture stopped: browser, caption source, or image worker failed. Inspect the authorized player before restarting.');
  }finally{unlinkSync(lock);}
}
