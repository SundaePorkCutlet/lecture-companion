import {mkdirSync,existsSync,readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';

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
  constructor(dir,{readOnly=false}={}){
    this.dir=dir;this.readOnly=readOnly;this.path=join(dir,'events.jsonl');
    if(readOnly){this.lastId=this.read().at(-1)?.id??0;return;}
    mkdirSync(dir,{recursive:true,mode:0o700});
    if(!existsSync(this.path))writeFileSync(this.path,'',{mode:0o600});
    const raw=readFileSync(this.path,'utf8');
    // Recover only an incomplete final write; never silently discard an interior error.
    if(raw && !raw.endsWith('\n')) {
      const end=raw.lastIndexOf('\n')+1,tail=raw.slice(end);
      try{JSON.parse(tail);appendFileSync(this.path,'\n');}
      catch{writeFileSync(join(dir,'crash-tail.txt'),tail,{mode:0o600});writeFileSync(this.path,raw.slice(0,end));}
    }
    this.lastId=this.read().at(-1)?.id??0;
  }
  read(){let raw=readFileSync(this.path,'utf8');if(this.readOnly&&!raw.endsWith('\n'))raw=raw.slice(0,raw.lastIndexOf('\n')+1);return raw.split('\n').filter(Boolean).map(line=>JSON.parse(line));}
  append(event){if(this.readOnly)throw new Error('Read-only journal');const row={...event,id:++this.lastId,wallTime:new Date().toISOString()};appendFileSync(this.path,JSON.stringify(row)+'\n');return row;}
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
