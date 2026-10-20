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
    case 'mode':return session.setMode(values.mode,values.file?payload():{});
    case 'next':return session.next({maxBytes:Number(values.bytes??12000)});
    case 'commit':return session.commit(payload());
    case 'note':return session.note(payload());
    case 'evidence':return session.evidence({receipt:values.receipt,eventId:Number(values.event),offset:Number(values.offset??0),maxBytes:Number(values.bytes??12000)});
    case 'export':return session.export({...(values.notes?{notesPath:values.notes}:{}),...(values.json?{jsonPath:values.json}:{})});
    default:throw new Error('Unknown study command; use init, mode, next, evidence, commit, note, status, export');
  }
}
