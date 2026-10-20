import {readSharedStudy} from './questions-store.mjs';
import {bytes,checkBudget,journalHash} from './study-store.mjs';
import {safeFrame} from './study-records.mjs';

function fragment(value,metadata,offset,maxBytes){
  const chars=Array.from(JSON.stringify(value));
  if(!Number.isInteger(offset)||offset<0||offset>=chars.length)throw new Error('Invalid context fragment offset');
  const result={...metadata,offset,nextOffset:offset,totalCharacters:chars.length,text:'',complete:false};
  let low=offset,high=chars.length;
  while(low<high){const end=Math.ceil((low+high)/2),probe={...result,text:chars.slice(offset,end).join(''),nextOffset:end,complete:end===chars.length};if(bytes(probe)<=maxBytes)low=end;else high=end-1;}
  if(low===offset)throw new Error('Context metadata exceeds byte limit');
  return {...result,text:chars.slice(offset,low).join(''),nextOffset:low,complete:low===chars.length};
}

function searchItems(items,query,base,offset,maxBytes){
  if(typeof query!=='string'||Array.from(query).length>256)throw new Error('Context query must be a string of at most 256 characters');
  const normalize=text=>text.normalize('NFKC').toLowerCase(),needle=normalize(query.trim());
  const matches=items.filter(item=>normalize(`${item.key}\n${item.text}`).includes(needle));
  if(!Number.isInteger(offset)||offset<0||offset>matches.length)throw new Error('Invalid search result offset');
  const result={...base,search:{query,offset,nextOffset:offset,totalMatches:matches.length,complete:offset===matches.length},matches:[]};
  for(const item of matches.slice(offset)){
    const next=result.search.nextOffset+1;result.search.nextOffset=next;result.search.complete=next===matches.length;
    result.matches.push(item);
    if(bytes(result)>maxBytes){
      result.matches.pop();result.matches.push({key:item.key,kind:item.kind,omitted:true,reference:{itemKey:item.key}});
      if(bytes(result)>maxBytes){result.matches.pop();result.search.nextOffset--;result.search.complete=false;break;}
    }
  }
  if(bytes(result)>maxBytes||offset<matches.length&&result.search.nextOffset===offset)throw new Error('Question search metadata exceeds byte limit');
  return result;
}

export function readQuestionContext(store,{maxBytes=12000,eventId,itemKey,query,offset=0}={}){
  checkBudget(maxBytes);
  if([eventId,itemKey,query].filter(value=>value!==undefined).length>1)throw new Error('Choose one context selector: event, item or query');
  const {state,events,questions}=readSharedStudy(store);
  const allItems=[...state.items,...questions.records.flatMap(record=>record.items)];
  const base={sessionId:state.sessionId,capturedThrough:events.at(-1).id,summarizedThrough:state.committedCursor,
    sourceHash:journalHash(events,events.length),asOf:new Date().toISOString()};
  if(query!==undefined)return searchItems(allItems,query,base,offset,maxBytes);
  if(eventId!==undefined){
    if(!Number.isInteger(eventId)||eventId<1||!events[eventId-1])throw new Error('Unknown context evidence ID');
    const event=events[eventId-1];if(event.type==='frame')safeFrame(store.dir,event.file);
    return fragment(event,{...base,eventId},offset,maxBytes);
  }
  if(itemKey!==undefined){
    const item=allItems.find(item=>item.key===itemKey);if(!item)throw new Error('Unknown context item key');
    return fragment(item,{...base,itemKey},offset,maxBytes);
  }
  const uncertain=events.filter(e=>['caption-overflow','observation-gap','interruption'].includes(e.type));
  const result={...base,mode:state.mode,questionChat:questions.chat?{status:questions.chat.status,threadId:questions.chat.threadId??null}:null,
    uncertainty:{count:uncertain.length,recentIds:uncertain.slice(-5).map(e=>e.id)},truncated:true,evidence:[],studyItems:[],recentQa:[]};
  const candidates=events.filter(e=>['caption','frame','seek','playback','caption-overflow','observation-gap','interruption','end'].includes(e.type)).slice(-30);
  const itemReference=item=>({key:item.key,kind:item.kind,omitted:true,reference:{itemKey:item.key}});
  const groups=[
    {target:result.evidence,values:candidates.toReversed(),reference:event=>({id:event.id,type:event.type,omitted:true,reference:{eventId:event.id}})},
    {target:result.studyItems,values:state.items.slice(-8).toReversed(),reference:itemReference},
    {target:result.recentQa,values:questions.records.slice(-2).toReversed().map(record=>({key:record.key,items:record.items})),reference:record=>({key:record.key,omitted:true,items:record.items.map(itemReference)})}
  ];
  // Reserve a reference to the newest member of every source before allowing
  // a long caption to consume the budget. A summary must remain discoverable.
  for(const group of groups)if(group.values.length)group.target.push(group.reference(group.values[0]));
  if(bytes(result)>maxBytes)throw new Error('Question context metadata exceeds byte limit');
  for(let index=0;index<30;index++)for(const group of groups){
    const value=group.values[index];if(!value)continue;
    if(group.target===result.evidence&&value.type==='frame')safeFrame(store.dir,value.file);
    if(index===0){
      const reference=group.target[0];group.target[0]=value;
      if(bytes(result)>maxBytes)group.target[0]=reference;
    }else{
      group.target.push(value);
      if(bytes(result)>maxBytes){group.target.pop();group.target.push(group.reference(value));if(bytes(result)>maxBytes)group.target.pop();}
    }
  }
  for(const group of groups)group.target.reverse();
  result.truncated=events.length!==result.evidence.length||result.evidence.some(e=>e.omitted)||state.items.length!==result.studyItems.length||result.studyItems.some(i=>i.omitted)||questions.records.length!==result.recentQa.length||result.recentQa.some(q=>q.omitted);
  if(bytes(result)>maxBytes)throw new Error('Question context metadata exceeds byte limit');
  return result;
}
