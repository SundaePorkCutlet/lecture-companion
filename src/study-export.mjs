import {existsSync,readFileSync,lstatSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {atomicWrite,digest} from './study-store.mjs';
import {safeFrame} from './study-records.mjs';

const plain=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\\`*_{}\[\]()#!|]/g,'\\$&');
const labels={lecture:'강의에서 관찰한 내용',explanation:'AI 부연설명',correction:'보완·정정',question:'질문',answer:'답변','open-question':'남은 의문'};
const uncertaintyTypes=new Set(['caption-overflow','observation-gap','interruption']);

function render(state,events,dir){
  const capturedThrough=events.at(-1).id;
  const sourceIds=new Set(state.items.flatMap(item=>item.evidence));
  const evidence=events.filter(event=>event.id<=state.committedCursor||sourceIds.has(event.id));
  const observations=events.filter(event=>uncertaintyTypes.has(event.type)||event.type==='seek'||event.type==='playback');
  const lines=['# 함께 공부한 강의 기록','','강의 자막·선택 화면과 AI 설명을 구분한 기록입니다. 음성을 수집하지 않았으며 완전한 녹취나 학습자의 이해도를 증명하지 않습니다.',
    '',`수집한 이벤트: #${capturedThrough} · 반영한 이벤트: #${state.committedCursor} · 모드: ${state.mode}`,
    '','mediaTime=null/unknown은 강의 재생 시각을 확인하지 못했다는 뜻입니다. observedAt과 wallTime은 관찰/저장 시각이며 서로 다를 수 있습니다.',''];
  for(const item of state.items){
    lines.push(`## ${labels[item.kind]} · ${plain(item.key)}`,'',plain(item.text),'');
    if(item.evidence.length)lines.push(`근거: ${item.evidence.map(id=>`[#${id}](#evidence-${id})`).join(', ')}`,'');
    if(item.questionKey)lines.push(`연결된 질문: ${plain(item.questionKey)}`,'');
    if(item.targetItemKey)lines.push(`보완 대상: ${plain(item.targetItemKey)}`,'');
    if(item.unverified)lines.push('**미검증: 추가 확인이 필요합니다.**','');
    for(const source of item.sources)lines.push(`외부 출처 (${source.verification}; 에이전트의 확인 표시): [${plain(source.title)}](<${source.url.replace(/>/g,'%3E').replace(/</g,'%3C')}>)`,'');
    if(item.kind==='question')lines.push(`질문 당시 수집 #${item.capturedThrough??'unknown'} / 반영 #${item.committedThrough??'unknown'}`,'');
  }
  lines.push('## 관찰 한계와 재생 경계','','관찰 지연은 문장 유실을 증명하지 않습니다. overflow의 dropped만 수집 큐에서 버린 이벤트 수입니다. seek는 재생 위치 변경이며 건너뛴 발화를 복구하지 않습니다.','');
  for(const event of observations)lines.push(`- #${event.id} ${event.type}: ${plain(JSON.stringify(event))}`);
  lines.push('','## 원본 근거','');
  for(const event of evidence){
    lines.push(`<a id="evidence-${event.id}"></a>`,`### #${event.id} · ${event.type}`,'',
      `mediaTime=${event.mediaTime??'unknown'} · observedAt=${event.observedAt??'unknown'} · wallTime=${event.wallTime}`,'');
    if(event.type==='caption')lines.push(plain(event.text),'');
    else if(event.type==='frame')lines.push(`![관찰한 강의 화면](<${safeFrame(dir,event.file)}>)`,'',`이미지 수집 시작: ${event.observationStartedAt??'unknown'}`,'');
    else lines.push(plain(JSON.stringify(event)),'');
  }
  const data={version:1,sessionId:state.sessionId,coverage:{capturedThrough,committedThrough:state.committedCursor,mode:state.mode},
    limitations:['No audio captured; not a complete transcript.','Agent verification labels are not automatic fact checks.'],
    items:state.items,commits:state.commits??[],observations,evidence};
  return {markdown:lines.join('\n'),json:JSON.stringify(data,null,2)+'\n'};
}

function inspectTarget(path,owner){
  if(!existsSync(path))return;
  if(!lstatSync(path).isFile())throw new Error('Export target must be a regular owned file');
  if(!owner)throw new Error('Existing manual file is not owned; choose another output path');
  const hash=digest(readFileSync(path,'utf8'));
  if(hash!==owner.hash&&hash!==owner.pendingHash)throw new Error('Generated file was modified; choose another output path');
}

export function exportStudy(store,{notesPath=join(store.dir,'notes.md'),jsonPath=join(store.dir,'study-notes.json')}={}){
  notesPath=resolve(notesPath);jsonPath=resolve(jsonPath);
  if(notesPath===jsonPath)throw new Error('Export output paths must be distinct');
  return store.locked(()=>{
    const {state,events}=store.read(),rendered=render(state,events,store.dir);
    const outputs=[{path:notesPath,text:rendered.markdown},{path:jsonPath,text:rendered.json}];
    for(const output of outputs)inspectTarget(output.path,state.exports.find(owner=>owner.path===output.path));
    // Persist ownership intent before writing derived files. A failed later write
    // leaves enough information to recognize the earlier generated file on retry.
    for(const output of outputs){
      let owner=state.exports.find(owner=>owner.path===output.path);
      if(!owner){owner={path:output.path,hash:null};state.exports.push(owner);}
      output.previousExists=existsSync(output.path);owner.pendingHash=digest(output.text);
    }
    state.revision++;atomicWrite(store.path,JSON.stringify(state,null,2));
    for(const output of outputs){
      const owner=state.exports.find(owner=>owner.path===output.path);inspectTarget(output.path,owner);
      if(!existsSync(output.path))writeFileSync(output.path,output.text,{flag:'wx',mode:0o600});
      else atomicWrite(output.path,output.text);
    }
    for(const owner of state.exports)if(outputs.some(output=>output.path===owner.path)){owner.hash=owner.pendingHash;delete owner.pendingHash;}
    state.revision++;atomicWrite(store.path,JSON.stringify(state,null,2));
    return {notesPath,jsonPath,revision:state.revision};
  });
}
