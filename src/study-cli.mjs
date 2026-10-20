import {readFileSync} from 'node:fs';
import {StudySession} from './study-session.mjs';

export function runStudyCommand(command,values,out){
  if(!values.out)throw new Error('study requires an explicit --out session directory');
  const session=new StudySession(out);
  const payload=()=>{
    if(!values.file)throw new Error('This study command requires --file JSON_PATH');
    const value=JSON.parse(readFileSync(values.file,'utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Study input must be a JSON object');
    return value;
  };
  switch(command){
    case 'init':return session.init();
    case 'status':return session.status();
    case 'context':return session.context({maxBytes:Number(values.bytes??12000),...(values.event?{eventId:Number(values.event)}:{}),...(values.item?{itemKey:values.item}:{}),...(values.query!==undefined?{query:values.query}:{}),offset:Number(values.offset??0)});
    case 'qa':return session.qa(payload());
    case 'chat':return session.prepareChat({host:values.host??'codex',workerThreadId:values['worker-thread']??null,title:values.title??'강의',retrySetupId:values['retry-setup']??null});
    case 'chat-bind':return session.bindChat(payload());
    case 'mode':return session.setMode(values.mode,values.file?payload():{});
    case 'next':return session.next({maxBytes:Number(values.bytes??12000)});
    case 'commit':return session.commit(payload());
    case 'note':return session.note(payload());
    case 'evidence':return session.evidence({receipt:values.receipt,eventId:Number(values.event),offset:Number(values.offset??0),maxBytes:Number(values.bytes??12000)});
    case 'export':return session.export({...(values.notes?{notesPath:values.notes}:{}),...(values.json?{jsonPath:values.json}:{})});
    default:throw new Error('Unknown study command; use init, mode, next, evidence, commit, note, status, context, qa, chat, chat-bind, export');
  }
}
