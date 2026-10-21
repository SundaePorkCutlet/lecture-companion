import {realpathSync,statSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';

export function safeFrame(dir,file){
  if(typeof file!=='string'||!file||isAbsolute(file))throw new Error('Invalid session frame path');
  const root=realpathSync(dir),candidate=realpathSync(resolve(dir,file)),rel=relative(root,candidate);
  if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel)||!statSync(candidate).isFile())throw new Error('Frame is outside the session or is not a file');
  return candidate;
}

const kinds=new Set(['lecture','explanation','correction','question','answer','open-question']);
const substantive=new Set(['lecture','explanation','correction']);
const nonempty=value=>typeof value==='string'&&value.trim().length>0;

export function validateItems(items,state,events,dir){
  if(!Array.isArray(items))throw new Error('Items must be an array');
  const known=new Map(state.items.map(item=>[item.key,item])),result=[];
  for(const item of items){
    if(!item||!nonempty(item.key)||!kinds.has(item.kind)||!nonempty(item.text))throw new Error('Invalid study item key, kind or text');
    if(known.has(item.key))throw new Error('Duplicate study item key');
    const evidence=item.evidence??[];
    if(!Array.isArray(evidence)||new Set(evidence).size!==evidence.length)throw new Error('Invalid evidence IDs');
    for(const id of evidence){
      if(!Number.isInteger(id)||id<1||!events[id-1])throw new Error('Unknown evidence ID');
      if(events[id-1].type==='frame')safeFrame(dir,events[id-1].file);
    }
    if(substantive.has(item.kind)&&(!evidence.length||evidence.some(id=>!['caption','frame'].includes(events[id-1].type))))throw new Error('Lecture, explanation and correction need caption/frame evidence');
    const sources=item.sources??[];
    if(!Array.isArray(sources))throw new Error('Invalid external sources');
    const cleanSources=sources.map(source=>{
      let url;try{url=new URL(source.url);}catch{throw new Error('Invalid source URL');}
      if(!['http:','https:'].includes(url.protocol)||!nonempty(source.title)||!['checked','unverified'].includes(source.verification))throw new Error('Invalid source URL, title or verification');
      return {url:url.href,title:source.title,verification:source.verification};
    });
    if(item.kind==='correction'&&item.unverified!==true&&!cleanSources.some(source=>source.verification==='checked'))throw new Error('Correction needs a checked source or unverified=true');
    if(item.kind==='answer'&&known.get(item.questionKey)?.kind!=='question')throw new Error('Answer must link to an existing questionKey');
    if(item.targetItemKey&&!known.has(item.targetItemKey))throw new Error('Unknown correction target item');
    const clean={key:item.key,kind:item.kind,text:item.text,evidence,sources:cleanSources,createdAt:new Date().toISOString()};
    if(item.unverified===true)clean.unverified=true;
    if(item.questionKey)clean.questionKey=item.questionKey;
    if(item.targetItemKey)clean.targetItemKey=item.targetItemKey;
    known.set(item.key,clean);result.push(clean);
  }
  return result;
}

export function validateDispositions(dispositions,packet,items,pending){
  if(!Array.isArray(dispositions)||dispositions.length!==packet.events.length||new Set(dispositions.map(d=>d.eventId)).size!==packet.events.length)throw new Error('Every offered event needs exactly one disposition');
  for(const event of packet.events){
    if(event.omitted&&!pending.readRanges[event.id]?.complete)throw new Error('Read complete oversized evidence before committing');
    const disposition=dispositions.find(d=>d.eventId===event.id);
    if(disposition?.action==='reviewed'){
      if(!nonempty(disposition.reason))throw new Error('A reviewed disposition needs a reason');
    }else if(disposition?.action==='noted'){
      if(!Array.isArray(disposition.itemKeys)||!disposition.itemKeys.length||disposition.itemKeys.some(key=>!items.some(item=>item.key===key&&item.evidence.includes(event.id))))throw new Error('Noted events must link to grounded study items');
    }else throw new Error('Invalid event disposition');
  }
}

export function mergeReadRange(prior,start,end,total){
  const ranges=[...(prior?.ranges??[]),[start,end]].sort((a,b)=>a[0]-b[0]),merged=[];
  for(const range of ranges){
    const last=merged.at(-1);
    if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else merged.push([...range]);
  }
  return {ranges:merged,complete:merged.length===1&&merged[0][0]===0&&merged[0][1]===total};
}
