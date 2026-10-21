#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {Journal} from '../src/core.mjs';
import {runStudyCommand} from '../src/study-cli.mjs';
import {hostRuntime,runtimeDoctor} from '../src/host-runtime.mjs';

try {
  const {values,positionals}=parseArgs({args:process.argv.slice(2),allowPositionals:true,options:Object.fromEntries(['out','space','page','duration','after','bytes','selector','title','caption-mode','caption-selector','mode','file','receipt','event','offset','notes','json','host','worker-thread','item','query','retry-setup','browser','tab','account','profile'].map(k=>[k,{type:'string'}]))});
  const command=positionals[0]??'help',out=resolve(values.out??'sessions/demo');
  if(command==='help'){
    console.log(`Lecture Companion 0.7\nCommands: doctor, tabs, capture, batch, status, stop, export, demo, study\nAside: tabs --browser aside [--account u0 --profile ID]\nAside capture: --browser aside --tab TARGET_ID --selector CSS --out ABSOLUTE_DIR\nEgo capture (default): --space ID --page p1 --out ABSOLUTE_DIR\nOptional: --duration 1800 --selector 'iframe[src*=kollus.com]'\nCaptions: --caption-mode auto|event|snapshot --caption-selector CSS\nAuto prefers TextTrack/DOM events; inaccessible iframe uses explicit snapshot fallback.\nBatch: --after 0 --bytes 12000 (UTF-8 bytes, not token count)\nStudy: init|mode|next|evidence|commit|note|status|context|qa|chat|chat-bind|export --out SESSION\nStudy mode: --mode follow|question|catch-up; question requires --file JSON\nStudy commit/note: --file JSON. Evidence: --receipt ID --event N --offset N\nStudy context: --event N or --item KEY or --query TEXT --offset N (read-only)\nStudy chat: --host codex|claude-code --title TITLE; prepare, then native open + chat-bind --file JSON; confirmed failure: --retry-setup ID\nStudy qa: --file JSON (independent question/answer snapshot)\nStudy next/evidence/context: --bytes 12000 (minimum 2048). Export: --notes PATH --json PATH\nCapture observes only; start/pause/speed remain in the player.\nStop: create STOP via the stop command; remove STOP before resuming.`);
  }else if(command==='doctor'){
    console.log(JSON.stringify(await runtimeDoctor()));
  }else if(command==='study'){
    process.stdout.write(JSON.stringify(runStudyCommand(positionals[1],values,out)));
  }else if(command==='tabs'){
    if(values.browser!=='aside')throw new Error('tabs requires --browser aside; use the ego skill for ego task spaces');
    const {listAsideTabs}=await import('../src/aside-browser.mjs');
    console.log(JSON.stringify(await listAsideTabs({account:values.account,profile:values.profile})));
  }else if(command==='capture'){
    if(!values.out)throw new Error('capture requires an explicit --out directory');
    const captionMode=values['caption-mode']??'auto';
    if(!['auto','event','snapshot'].includes(captionMode))throw new Error('caption-mode must be auto, event, or snapshot');
    const browser=values.browser??'ego';
    if(!['ego','aside'].includes(browser))throw new Error('browser must be ego or aside');
    if(browser==='ego'&&(!/^\d+$/.test(values.space??'')||!/^p\d+$/.test(values.page??'')))throw new Error('Use an authorized ego task space ID and existing page label.');
    if(browser==='aside'&&(!values.tab?.trim()||!values.selector?.trim()))throw new Error('Aside capture requires --tab TARGET_ID and --selector CSS from the authorized player');
    const durationSec=Number(values.duration??1800);if(!Number.isFinite(durationSec)||durationSec<=0)throw new Error('Invalid duration');
    mkdirSync(out,{recursive:true,mode:0o700});if(existsSync(join(out,'STOP')))throw new Error('STOP exists; inspect and remove it before resuming.');
    if(browser==='aside'){
      const {connectAsidePage}=await import('../src/aside-browser.mjs');
      const {runCapture}=await import('../src/ego-capture.mjs');
      const session=await connectAsidePage({targetId:values.tab,account:values.account,profile:values.profile});
      try{
        await runCapture({page:session.page,out,durationSec,selector:values.selector,captionMode,captionSelector:values['caption-selector']??null,
          browser:'aside',imageNode:process.execPath,imageRuntime:hostRuntime(),onNotice:x=>console.log(JSON.stringify(x))});
      }finally{await session.close();}
    }else{
    const module=pathToFileURL(fileURLToPath(new URL('../src/ego-capture.mjs',import.meta.url))).href;
    const runtime=hostRuntime();
    const source=`const {runCapture}=await import(${JSON.stringify(module)});\nconst task=await taskSpace(${Number(values.space)});\nconst page=task.page(${JSON.stringify(values.page)});\nawait runCapture({page,${JSON.stringify({out,durationSec,selector:values.selector??'iframe[src*="kollus.com"]',captionMode,captionSelector:values['caption-selector']??null,imageNode:process.execPath,...(runtime.provider==='ego'?{imageRuntime:runtime}:{})}).slice(1,-1)},onNotice: x=>console.log(JSON.stringify(x))});`;
    const child=spawn('ego-browser',['nodejs'],{stdio:['pipe','inherit','inherit']});
    child.stdin.end(source);child.on('error',()=>{console.error('ego-browser unavailable');process.exitCode=1;});
    child.on('exit',code=>{process.exitCode=code??1;});
    }
  }else if(command==='demo'){
    const journal=new Journal(out);
    if(journal.lastId)throw new Error('Demo requires an empty output directory');
    writeFileSync(join(out,'manifest.json'),JSON.stringify({title:values.title??'DEMO — synthetic lecture',source:'synthetic fixture, not a recorded lecture'},null,2));
    journal.append({type:'start',mediaTime:0});
    for(let i=0;i<20;i++)journal.append({type:'caption',text:`DEMO ${i+1}: Pod is a unit of deployment; this is synthetic evidence.`,mediaTime:i*3});
    journal.append({type:'end',mediaTime:60});console.log(JSON.stringify({out,events:journal.lastId}));
  }else if(command==='batch'){
    console.log(JSON.stringify(new Journal(out,{readOnly:true}).batch({after:Number(values.after??0),maxBytes:Number(values.bytes??12000)})));
  }else if(command==='status'){
    console.log(readFileSync(join(out,'status.json'),'utf8'));
  }else if(command==='stop'){
    mkdirSync(out,{recursive:true,mode:0o700});writeFileSync(join(out,'STOP'),'Requested by user/agent\n',{mode:0o600});console.log('Stop requested.');
  }else if(command==='export'){
    const journal=new Journal(out,{readOnly:true}),manifest=existsSync(join(out,'manifest.json'))?JSON.parse(readFileSync(join(out,'manifest.json'),'utf8')):{};
    const escape=s=>String(s).replace(/[<>]/g,c=>c==='<'?'&lt;':'&gt;');
    const lines=[`# ${escape(manifest.title??'Lecture evidence')}`,'','Observed captions and selected frames. Not a complete transcript. mediaTime=null means only wall-clock time is known. No audio was captured.',''];
    for(const e of journal.read()){
      const stamp=`[${e.wallTime}] mediaTime=${e.mediaTime??'null'}`;
      if(e.type==='caption')lines.push(`${stamp} ${escape(e.text)}`,'');
      else if(e.type==='frame')lines.push(`${stamp} ![Selected lecture frame](${e.file})`,'');
      else lines.push(`${stamp} **${e.type}** ${escape(e.reason??'')}`,'');
    }
    writeFileSync(join(out,'transcript.md'),lines.join('\n'),{mode:0o600});console.log(join(out,'transcript.md'));
  }else throw new Error(`Unknown command: ${command}`);
}catch(error){console.error(error.message);process.exitCode=1;}
