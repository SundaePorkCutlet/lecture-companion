export const RESOURCE_LIMITS=Object.freeze({captionBytes:64*1024,eventBytes:128*1024,packetBytes:256*1024,
  queueBytes:512*1024,snapshotBytes:1024*1024,journalBytes:16*1024*1024,sessionBytes:128*1024*1024});
export const TERMINAL_BYTES=1024;
export class ResourceLimitError extends Error{
  constructor(limit){super(`Lecture resource limit reached: ${limit}`);this.code='RESOURCE_LIMIT';this.limit=limit;}
}
// Callers may lower a budget, but cannot disable the hard safety ceilings.
export function resourceLimits(overrides={}){
  const limits={...RESOURCE_LIMITS};
  for(const [key,value] of Object.entries(overrides)){
    if(!Object.hasOwn(limits,key)||!Number.isSafeInteger(value)||value<=0||value>limits[key])throw new Error('Invalid resource limits');
    limits[key]=value;
  }
  if(limits.journalBytes<=TERMINAL_BYTES||limits.sessionBytes<=TERMINAL_BYTES)throw new Error('Storage limits must leave room for terminal metadata');
  return limits;
}
export function checkText(text,maxBytes,limit='caption-bytes'){
  if(typeof text!=='string'||text.length>maxBytes||Buffer.byteLength(text)>maxBytes)throw new ResourceLimitError(limit);
}
const fields=new Set(['type','text','seq','observedAt','mediaTime','source','action','paused','playbackRate','ended','duration','from']);
export function checkedEvent(event,limits){
  if(!event||typeof event!=='object'||Array.isArray(event)||!['caption','playback','seek','media-ended','caption-clear','start','end','interruption','observation-gap','caption-overflow','frame'].includes(event.type))throw new ResourceLimitError('invalid-event');
  if(event.type==='caption'||event.type==='caption-clear')checkText(event.text,limits.captionBytes);
  // Journal also accepts trusted local metadata; every serialized row is bounded.
  const encoded=JSON.stringify(event);
  checkText(encoded,limits.eventBytes,'event-bytes');
  return encoded;
}
export function checkPacket(packet,limits,{eventMode=false,afterSeq=0}={}){
  if(!packet||!Array.isArray(packet.events)||packet.events.length>256)throw new ResourceLimitError('packet-events');
  if(packet.failure==='resource-limit')throw new ResourceLimitError('browser-caption-bytes');
  for(const key of ['rawBytes','dropped'])if(packet[key]!==undefined&&(!Number.isSafeInteger(packet[key])||packet[key]<0))throw new ResourceLimitError('packet-metadata');
  if(typeof packet.healthy!=='boolean'||packet.hasMore!==undefined&&typeof packet.hasMore!=='boolean')throw new ResourceLimitError('packet-metadata');
  if(packet.state?.mediaTime!==undefined&&packet.state.mediaTime!==null&&!Number.isFinite(packet.state.mediaTime))throw new ResourceLimitError('packet-metadata');
  let size=2,lastSeq=afterSeq;
  for(const event of packet.events){
    if(!event||!['caption','playback','seek','media-ended'].includes(event.type))throw new ResourceLimitError('invalid-event');
    for(const [key,value] of Object.entries(event)){
      if(!fields.has(key)||value!==null&&!['string','number','boolean'].includes(typeof value))throw new ResourceLimitError('invalid-event');
      if(typeof value==='string')checkText(value,limits.captionBytes);
      if(typeof value==='number'&&!Number.isFinite(value))throw new ResourceLimitError('invalid-event');
    }
    if(eventMode){
      if(!Number.isSafeInteger(event.seq)||event.seq<=lastSeq)throw new ResourceLimitError('event-sequence');
      lastSeq=event.seq;
    }
    size+=Buffer.byteLength(checkedEvent(event,limits))+(size>2?1:0);
    if(size>limits.packetBytes)throw new ResourceLimitError('packet-bytes');
  }
  if(packet.hasMore&&!packet.events.length)throw new ResourceLimitError('packet-progress');
  return lastSeq;
}
