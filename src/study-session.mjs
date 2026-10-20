import {randomUUID} from 'node:crypto';
import {StudyStore,checkBudget,bytes,replayOperation,journalHash} from './study-store.mjs';

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
        if(!key||question?.kind!=='question'||!question.key||!question.text?.trim())throw new Error('Question mode requires a keyed question');
        if(state.items.some(item=>item.key===question.key))throw new Error('Duplicate study item key');
        state.items.push({...question,evidence:question.evidence??[],capturedThrough:events.at(-1).id,
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
        return {replay:true,value:state.pending.packet};
      }
      const tail=events.filter(event=>event.id>state.committedCursor);
      const packet={sessionId:state.sessionId,receipt:null,revision:state.revision+1,events:[],
        nextCursor:state.committedCursor,capturedThrough:events.at(-1).id,hasMore:false,observedAt:new Date().toISOString()};
      if(!tail.length)return {replay:true,value:{...packet,revision:state.revision,caughtUpThrough:packet.capturedThrough}};
      packet.receipt=randomUUID();
      for(const event of tail.slice(0,100)){
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
      if(!Array.isArray(payload.items)||payload.items.length)throw new Error('Annotated commits are not implemented yet');
      const dispositions=payload.dispositions??[];
      if(dispositions.length!==packet.events.length||new Set(dispositions.map(d=>d.eventId)).size!==packet.events.length)throw new Error('Every offered event needs a disposition');
      for(const event of packet.events){
        if(event.omitted)throw new Error('Read oversized evidence before committing');
        const d=dispositions.find(d=>d.eventId===event.id);
        if(d?.action!=='reviewed'||!d.reason?.trim())throw new Error('A reviewed reason is required');
      }
      state.committedCursor=packet.nextCursor;state.journal.committedHash=journalHash(events,state.committedCursor);state.pending=null;
      const value={committedCursor:state.committedCursor,revision:state.revision+1};
      state.operations.push({key:payload.key,hash:op.hash,result:value});return {value};
    },{expectedRevision:payload.expectedRevision});
  }
}
