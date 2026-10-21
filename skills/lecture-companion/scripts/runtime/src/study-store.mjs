import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,unlinkSync,openSync,closeSync,existsSync,linkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Journal} from './core.mjs';

export const canonical = value => JSON.stringify(value,(_key,item)=>
  item && typeof item==='object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])) : item);
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export const journalHash = (events,through) => digest(events.slice(0,through));
export function protectObservedJournal(state,events){
  state.journal.observedThrough=events.length;
  state.journal.observedHash=journalHash(events,events.length);
}

export function atomicWrite(path,text,{exclusive=false}={}){
  const temp=`${path}.${randomUUID()}.tmp`;
  try{
    writeFileSync(temp,text,{flag:'wx',mode:0o600});
    // A hard link publishes a complete new file without replacing a manual
    // file created concurrently. The temporary file is on the same filesystem.
    if(exclusive)linkSync(temp,path);else renameSync(temp,path);
  }
  finally{if(existsSync(temp))unlinkSync(temp);}
}

export class StudyStore{
  constructor(dir){this.dir=resolve(dir);this.path=join(this.dir,'study.json');this.lock=join(this.dir,'.study.lock');}
  events(){
    const events=new Journal(this.dir,{readOnly:true}).read();
    if(!events.length)throw new Error('Study requires a nonempty capture journal');
    if(events.some((event,i)=>event.id!==i+1))throw new Error('Invalid journal event sequence');
    return events;
  }
  read(){
    const state=JSON.parse(readFileSync(this.path,'utf8')),events=this.events();
    if(state.version!==2||!state.sessionId||!Number.isInteger(state.revision)||state.revision<0||!Number.isInteger(state.committedCursor)||state.committedCursor<0)throw new Error('Invalid or unsupported study state version');
    if(state.journal.firstHash!==digest(events[0]))throw new Error('Capture journal identity changed');
    const through=state.pending?.packet.capturedThrough??state.committedCursor;
    if(events.length<through)throw new Error('Capture journal truncated');
    if(state.journal.committedHash!==journalHash(events,state.committedCursor))throw new Error('Committed journal evidence changed');
    if(state.pending&&state.pending.journalHash!==journalHash(events,through))throw new Error('Offered journal evidence changed');
    if(events.length<state.journal.observedThrough)throw new Error('Observed journal truncated');
    if(state.journal.observedHash!==journalHash(events,state.journal.observedThrough))throw new Error('Observed journal evidence changed');
    return {state,events};
  }
  locked(fn){
    let fd;try{fd=openSync(this.lock,'wx',0o600);}catch(error){throw new Error(`Study lock unavailable: ${error.code}`);}
    try{return fn();}finally{closeSync(fd);unlinkSync(this.lock);}
  }
  init(){
    return this.locked(()=>{
      if(existsSync(this.path))throw new Error('Study already initialized');
      const events=this.events();
      const state={version:2,sessionId:randomUUID(),revision:0,mode:'follow',committedCursor:0,
        journal:{firstHash:digest(events[0]),committedHash:journalHash(events,0)},pending:null,items:[],operations:[],exports:[]};
      protectObservedJournal(state,events);
      atomicWrite(this.path,JSON.stringify(state,null,2));return {sessionId:state.sessionId,revision:0};
    });
  }
  update(fn,{expectedRevision}={}){
    const loaded=this.read().state.revision;
    return this.locked(()=>{
      const {state,events}=this.read();
      const result=fn(state,events);
      if(result.replay)return result.value;
      const expected=expectedRevision??loaded;
      if(!Number.isInteger(expected)||expected!==state.revision)throw new Error('Stale study revision');
      state.revision++;
      protectObservedJournal(state,events);
      atomicWrite(this.path,JSON.stringify(state,null,2));return result.value;
    });
  }
}

export function checkBudget(maxBytes){
  if(!Number.isInteger(maxBytes)||maxBytes<2048)throw new Error('Study byte limit must be at least 2048');
}
export const bytes=value=>Buffer.byteLength(JSON.stringify(value));
export function replayOperation(state,key,payload){
  if(typeof key!=='string'||!key.trim())throw new Error('An operation key is required');
  const normalized={...payload};delete normalized.expectedRevision;
  const hash=digest(normalized),previous=state.operations.find(op=>op.key===key);
  if(previous&&previous.hash!==hash)throw new Error('Operation key conflict');
  return {hash,previous};
}
