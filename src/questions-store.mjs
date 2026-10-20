import {existsSync,readFileSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {atomicWrite,journalHash,digest} from './study-store.mjs';
import {safeFrame,validateItems} from './study-records.mjs';

export function readSharedStudy(store){
  // Read Q&A first: a concurrent saved answer can refer to capture appended
  // before that save. The following journal snapshot must include that prefix.
  const path=join(store.dir,'questions.json');
  const saved=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null;
  const {state,events}=store.read();
  const questions=saved??{version:1,sessionId:state.sessionId,revision:0,chat:null,records:[]};
  if(questions.version!==1||questions.sessionId!==state.sessionId||!Array.isArray(questions.records)||!Number.isInteger(questions.revision))throw new Error('Invalid or foreign question session');
  for(const record of questions.records){
    validateContext(record.context,state,events);
    for(const item of record.items)for(const id of item.evidence)if(events[id-1]?.type==='frame')safeFrame(store.dir,events[id-1].file);
  }
  return {state,events,questions};
}

export function validateContext(context,state,events){
  if(context?.sessionId!==state.sessionId)throw new Error('Question context belongs to another session');
  if(!Number.isInteger(context.capturedThrough)||context.capturedThrough<1||context.capturedThrough>events.length)throw new Error('Question context journal was truncated or is invalid');
  if(context.sourceHash!==journalHash(events,context.capturedThrough))throw new Error('Question context journal evidence changed');
  if(!Number.isInteger(context.summarizedThrough)||context.summarizedThrough<0||context.summarizedThrough>Math.min(context.capturedThrough,state.committedCursor))throw new Error('Invalid question snapshot summarized position');
  if(typeof context.asOf!=='string'||!Number.isFinite(Date.parse(context.asOf))||new Date(context.asOf).toISOString()!==context.asOf)throw new Error('Invalid question snapshot timestamp');
}

export function updateQuestions(store,fn){
  const lock=join(store.dir,'.questions.lock');let fd;
  try{fd=openSync(lock,'wx',0o600);}catch(error){throw new Error(`Question lock unavailable: ${error.code}`);}
  try{
    const shared=readSharedStudy(store),result=fn(shared);
    if(!result.replay){shared.questions.revision++;atomicWrite(join(store.dir,'questions.json'),JSON.stringify(shared.questions,null,2));}
    return result.value;
  }finally{closeSync(fd);unlinkSync(lock);}
}

export function recordQuestion(store,payload){
  if(typeof payload.key!=='string'||!payload.key.trim())throw new Error('Q&A requires a stable operation key');
  return updateQuestions(store,({state,events,questions})=>{
    const hash=digest(payload),previous=questions.records.find(record=>record.key===payload.key);
    if(previous){if(previous.hash!==hash)throw new Error('Q&A operation key conflict');return {replay:true,value:previous.result};}
    validateContext(payload.context,state,events);
    const prefix=`qa-${digest(payload.key).slice(0,24)}`;
    const q={...payload.question,key:`${prefix}-q`,kind:'question'},a={...payload.answer,key:`${prefix}-a`,kind:'answer',questionKey:`${prefix}-q`};
    for(const item of [q,a])for(const id of item.evidence??[]){
      if(id>payload.context.capturedThrough)throw new Error('Evidence is newer than the question context snapshot');
    }
    const allItems=[...state.items,...questions.records.flatMap(record=>record.items)];
    const items=validateItems([q,a],{items:allItems},events,store.dir);
    items[0].capturedThrough=payload.context.capturedThrough;
    items[0].committedThrough=payload.context.summarizedThrough;
    const context={sessionId:state.sessionId,capturedThrough:payload.context.capturedThrough,sourceHash:payload.context.sourceHash,
      asOf:payload.context.asOf,summarizedThrough:payload.context.summarizedThrough};
    const result={saved:true,key:payload.key,itemKeys:items.map(item=>item.key),questionRevision:questions.revision+1};
    questions.records.push({key:payload.key,hash,context,threadId:questions.chat?.threadId??null,items,result});
    return {value:result};
  });
}
