import {mkdirSync,existsSync,writeFileSync,appendFileSync,openSync,readSync,closeSync,fstatSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {resourceLimits,ResourceLimitError,TERMINAL_BYTES,checkedEvent,checkText} from './resource-limits.mjs';

function readJournal(path,maxBytes){
  const fd=openSync(path,'r');
  try{
    const size=fstatSync(fd).size;
    if(size>maxBytes)throw new ResourceLimitError('journal-bytes');
    // A concurrent append cannot turn a small stat into an unbounded read.
    const chunks=[];let total=0;
    for(;;){
      const chunk=Buffer.alloc(Math.min(64*1024,maxBytes+1-total)),n=readSync(fd,chunk,0,chunk.length,null);
      if(!n)break;total+=n;
      if(total>maxBytes)throw new ResourceLimitError('journal-bytes');
      chunks.push(chunk.subarray(0,n));
    }
    return Buffer.concat(chunks,total).toString('utf8');
  }finally{closeSync(fd);}
}

export class CaptionTracker {
  lastText=''; lastTime=null;
  observe({text='',mediaTime=null}) {
    text=text.replace(/\s+/g,' ').trim();
    if (Number.isFinite(mediaTime) && Number.isFinite(this.lastTime) && mediaTime<this.lastTime-1) {
      const from=this.lastTime;this.lastTime=mediaTime;this.lastText='';
      return {type:'seek',from,mediaTime};
    }
    this.lastTime=mediaTime;
    if (!text) {this.lastText='';return null;}
    if(text===this.lastText)return null;
    this.lastText=text;return {type:'caption',text,mediaTime};
  }
}

export class Journal {
  constructor(dir,{readOnly=false,limits={}}={}){
    this.limits=resourceLimits(limits);this.dir=dir;this.readOnly=readOnly;this.path=join(dir,'events.jsonl');
    if(readOnly){this.lastId=this.read().at(-1)?.id??0;return;}
    mkdirSync(dir,{recursive:true,mode:0o700});
    if(!existsSync(this.path))writeFileSync(this.path,'',{mode:0o600});
    const raw=readJournal(this.path,this.limits.journalBytes);
    // Recover only an incomplete final write; never silently discard an interior error.
    if(raw && !raw.endsWith('\n')) {
      const end=raw.lastIndexOf('\n')+1,tail=raw.slice(end);
      try{
        checkText(tail,this.limits.eventBytes,'event-bytes');
        const event=JSON.parse(tail);
        if(event.type==='caption'||event.type==='caption-clear')checkText(event.text,this.limits.captionBytes);
        if(Buffer.byteLength(raw)+1>this.limits.journalBytes)throw new ResourceLimitError('journal-bytes');
        appendFileSync(this.path,'\n');
      }
      catch(error){if(error.code==='RESOURCE_LIMIT')throw error;writeFileSync(join(dir,'crash-tail.txt'),tail,{mode:0o600});writeFileSync(this.path,raw.slice(0,end));}
    }
    this.lastId=this.read().at(-1)?.id??0;
  }
  read(){
    let raw=readJournal(this.path,this.limits.journalBytes);
    if(this.readOnly&&!raw.endsWith('\n'))raw=raw.slice(0,raw.lastIndexOf('\n')+1);
    return raw.split('\n').filter(Boolean).map(line=>{
      checkText(line,this.limits.eventBytes,'event-bytes');
      const event=JSON.parse(line);
      if(event.type==='caption'||event.type==='caption-clear')checkText(event.text,this.limits.captionBytes);
      return event;
    });
  }
  prepare(event,{terminal=false}={}){
    checkedEvent(event,this.limits);
    const row={...event,id:this.lastId+1,wallTime:new Date().toISOString()},text=JSON.stringify(row)+'\n',bytes=Buffer.byteLength(text);
    if(bytes>this.limits.eventBytes||terminal&&bytes>TERMINAL_BYTES)throw new ResourceLimitError('event-bytes');
    if(statSync(this.path).size+bytes>this.limits.journalBytes-(terminal?0:TERMINAL_BYTES))throw new ResourceLimitError('journal-bytes');
    return {row,text,bytes};
  }
  append(event,options){
    if(this.readOnly)throw new Error('Read-only journal');
    const {row,text}=this.prepare(event,options);appendFileSync(this.path,text);this.lastId=row.id;return row;
  }
  batch({after=0,maxBytes=12000,maxEvents=100}={}){
    if(!Number.isInteger(after)||after<0||!Number.isInteger(maxBytes)||maxBytes<512||!Number.isInteger(maxEvents)||maxEvents<1)throw new Error('Invalid batch limits (minimum 512 bytes)');
    const pending=this.read().filter(e=>e.id>after),events=[];
    const result=()=>({events,nextCursor:events.at(-1)?.id??after,hasMore:events.length<pending.length});
    for(const event of pending){
      if(events.length>=maxEvents)break;
      events.push(event);
      if(Buffer.byteLength(JSON.stringify(result()))>maxBytes){
        events.pop();
        if(!events.length)events.push({id:event.id,type:event.type,omitted:true,reference:`events.jsonl#${event.id}`,reason:'event exceeds batch byte limit; read reference locally'});
        break;
      }
    }
    return result();
  }
}
