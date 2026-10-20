import {randomUUID} from 'node:crypto';
import {StudyStore,checkBudget,bytes,replayOperation,journalHash} from './study-store.mjs';
import {validateItems,validateDispositions,safeFrame,mergeReadRange} from './study-records.mjs';
import {exportStudy} from './study-export.mjs';

export class StudySession{
  constructor(dir){this.store=new StudyStore(dir);}
  init(){return this.store.init();}
  status(){
    const {state,events}=this.store.read(),capturedCursor=events.at(-1).id;
    const uncertaintyTypes=['caption-overflow','observation-gap','interruption'];
    const uncertain=events.filter(e=>uncertaintyTypes.includes(e.type));
    return {sessionId:state.sessionId,revision:state.revision,mode:state.mode,capturedCursor,
      providedCursor:state.pending?.packet.nextCursor??state.committedCursor,committedCursor:state.committedCursor,
      pendingReceipt:state.pending?.packet.receipt??null,backlogEvents:capturedCursor-state.committedCursor,
      caughtUpThrough:state.committedCursor===capturedCursor?capturedCursor:null,asOf:new Date().toISOString(),
      uncertainty:{count:uncertain.length,recentEventIds:uncertain.slice(-10).map(e=>e.id)}};
  }
  setMode(mode,{question,key,expectedRevision}={}){
    if(!['follow','question','catch-up'].includes(mode))throw new Error('Unknown study mode');
    const payload={operation:'mode',mode,question,key};
    return this.store.update((state,events)=>{
      const op=key?replayOperation(state,key,payload):null;
      if(op?.previous)return {replay:true,value:op.previous.result};
      if(mode==='question'){
        if(!key||question?.kind!=='question')throw new Error('Question mode requires a keyed question');
        const [item]=validateItems([question],state,events,this.store.dir);
        state.items.push({...item,capturedThrough:events.at(-1).id,
          committedThrough:state.committedCursor,createdAt:new Date().toISOString()});
      }
      state.mode=mode;const value={mode,revision:state.revision+1};
      if(op)state.operations.push({key,hash:op.hash,result:value});
      return {value};
    },{expectedRevision});
  }
  next({maxBytes=12000}={}){
    checkBudget(maxBytes);
    return this.store.update((state,events)=>{
      if(state.mode==='question')return {replay:true,value:{blocked:true,mode:'question',sessionId:state.sessionId,
        revision:state.revision,capturedThrough:events.at(-1).id,committedCursor:state.committedCursor}};
      if(state.pending){
        if(bytes(state.pending.packet)>maxBytes)throw new Error('Pending receipt exceeds requested byte limit; reuse its original limit');
        for(const event of state.pending.packet.events)if(event.type==='frame')safeFrame(this.store.dir,events[event.id-1].file);
        return {replay:true,value:state.pending.packet};
      }
      const tail=events.filter(event=>event.id>state.committedCursor);
      const packet={sessionId:state.sessionId,receipt:null,revision:state.revision+1,events:[],
        nextCursor:state.committedCursor,capturedThrough:events.at(-1).id,hasMore:false,observedAt:new Date().toISOString()};
      if(!tail.length)return {replay:true,value:{...packet,revision:state.revision,caughtUpThrough:packet.capturedThrough}};
      packet.receipt=randomUUID();
      for(const event of tail.slice(0,100)){
        if(event.type==='frame')safeFrame(this.store.dir,event.file);
        packet.events.push(event);packet.nextCursor=event.id;packet.hasMore=event.id<packet.capturedThrough;
        if(bytes(packet)>maxBytes){
          packet.events.pop();
          if(!packet.events.length)packet.events.push({id:event.id,type:event.type,omitted:true,reference:`events.jsonl#${event.id}`});
          packet.nextCursor=packet.events.at(-1).id;packet.hasMore=packet.nextCursor<packet.capturedThrough;break;
        }
      }
      if(bytes(packet)>maxBytes)throw new Error('Receipt metadata exceeds byte limit');
      state.pending={packet,journalHash:journalHash(events,packet.capturedThrough),readRanges:{}};
      return {value:packet};
    });
  }
  commit(payload){
    return this.store.update((state,events)=>{
      const op=replayOperation(state,payload.key,{operation:'commit',...payload});
      if(op.previous)return {replay:true,value:op.previous.result};
      const packet=state.pending?.packet;
      if(!packet||packet.receipt!==payload.receipt)throw new Error('Unknown study receipt');
      if(state.mode==='question')throw new Error('Resume follow or catch-up before committing evidence');
      for(const event of packet.events)if(event.type==='frame')safeFrame(this.store.dir,events[event.id-1].file);
      const items=validateItems(payload.items,state,events,this.store.dir);
      validateDispositions(payload.dispositions,packet,[...state.items,...items],state.pending);
      state.items.push(...items);state.commits??=[];
      state.commits.push({receipt:packet.receipt,through:packet.nextCursor,dispositions:payload.dispositions,itemKeys:items.map(item=>item.key),committedAt:new Date().toISOString()});
      state.committedCursor=packet.nextCursor;state.journal.committedHash=journalHash(events,state.committedCursor);state.pending=null;
      const value={committedCursor:state.committedCursor,revision:state.revision+1};
      state.operations.push({key:payload.key,hash:op.hash,result:value});return {value};
    },{expectedRevision:payload.expectedRevision});
  }
  note(payload){
    return this.store.update((state,events)=>{
      const op=replayOperation(state,payload.key,{operation:'note',...payload});
      if(op.previous)return {replay:true,value:op.previous.result};
      const items=validateItems(payload.items,state,events,this.store.dir);
      for(const item of items)if(item.kind==='question'){item.capturedThrough=events.at(-1).id;item.committedThrough=state.committedCursor;}
      state.items.push(...items);
      const value={itemKeys:items.map(item=>item.key),revision:state.revision+1};
      state.operations.push({key:payload.key,hash:op.hash,result:value});return {value};
    },{expectedRevision:payload.expectedRevision});
  }
  evidence({receipt,eventId,offset=0,maxBytes=12000}){
    checkBudget(maxBytes);
    return this.store.update((state,events)=>{
      const pending=state.pending,packet=pending?.packet;
      if(!packet||packet.receipt!==receipt||!packet.events.some(event=>event.id===eventId))throw new Error('Evidence is not in this receipt');
      if(events[eventId-1].type==='frame')safeFrame(this.store.dir,events[eventId-1].file);
      const chars=Array.from(JSON.stringify(events[eventId-1]));
      if(!Number.isInteger(offset)||offset<0||offset>=chars.length)throw new Error('Invalid evidence character offset');
      const response={sessionId:state.sessionId,receipt,eventId,revision:state.revision+1,offset,nextOffset:offset,totalCharacters:chars.length,text:'',complete:false};
      let low=offset,high=chars.length;
      while(low<high){
        const end=Math.ceil((low+high)/2),test={...response,text:chars.slice(offset,end).join(''),nextOffset:end,complete:end===chars.length};
        if(bytes(test)<=maxBytes)low=end;else high=end-1;
      }
      if(low===offset)throw new Error('Evidence metadata exceeds byte limit');
      response.text=chars.slice(offset,low).join('');response.nextOffset=low;response.complete=low===chars.length;
      pending.readRanges[eventId]=mergeReadRange(pending.readRanges[eventId],offset,low,chars.length);
      return {value:response};
    });
  }
  export(options){return exportStudy(this.store,options);}
}
