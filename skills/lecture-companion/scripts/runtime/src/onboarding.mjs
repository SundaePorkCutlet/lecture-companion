import {existsSync,mkdirSync,readFileSync,writeFileSync,openSync,readSync,closeSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {listAsideTabs,connectAsidePage} from './aside-browser.mjs';
import {runtimeDoctor,hostRuntime} from './host-runtime.mjs';
import {runCapture} from './ego-capture.mjs';
import {StudySession} from './study-session.mjs';
import {Journal} from './core.mjs';
import {safeFrame} from './study-records.mjs';

const label=value=>String(value??'').replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').replace(/\s+/g,' ').trim().slice(0,120);
const site=url=>{try{const parsed=new URL(url);return ['http:','https:'].includes(parsed.protocol)?parsed.origin:parsed.protocol;}catch{return 'unknown';}};
const quote=s=>`'${String(s).replace(/'/g,"'\\''")}'`;
function sessionDirectory(){
  const configured=process.env.LECTURE_COMPANION_DATA_DIR||undefined;
  if(configured&&!isAbsolute(configured))throw new Error('LECTURE_COMPANION_DATA_DIR must be an absolute data directory');
  const xdg=process.env.XDG_DATA_HOME;
  const data=configured??join(xdg&&isAbsolute(xdg)?xdg:join(homedir(),'.local/share'),'lecture-companion');
  return join(data,'sessions',`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`);
}

// Runs only in the selected tab. Return geometry and selectors, never frame URLs.
export function discoverPlayers({selector=null,captionSelector=null}={}){
  const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
  const visible=node=>{const r=rect(node),style=getComputedStyle(node);return r.width>=50&&r.height>=50&&r.x+r.width>0&&r.y+r.height>0&&r.x<innerWidth&&r.y<innerHeight&&style.visibility!=='hidden'&&style.display!=='none';};
  const unique=node=>{
    if(node.id){const id=`#${CSS.escape(node.id)}`;if(document.querySelectorAll(id).length===1)return id;}
    const parts=[];
    for(let current=node;current&&current.tagName!=='HTML';current=current.parentElement){
      const tag=current.tagName.toLowerCase(),siblings=[...(current.parentElement?.children??[])].filter(n=>n.tagName===current.tagName);
      parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(current)+1})`);
    }
    const path=parts.join(' > ');if(path&&document.querySelectorAll(path).length===1)return path;
    throw new Error('Cannot identify a unique player element');
  };
  const visibleFrames=[...document.querySelectorAll('iframe')].filter(visible);
  let nodes;
  if(selector){nodes=[...document.querySelectorAll(selector)];if(nodes.length!==1)return {players:[],issue:'selector-not-unique'};}
  else nodes=[...document.querySelectorAll('video,iframe')].filter(visible).map(node=>{
    if(node.tagName!=='VIDEO')return node;
    const container=node.closest('#player,[data-player],.video-js,.html5-video-player,.plyr,.jwplayer,[role="region"][aria-label*="player" i]');
    return container&&container.querySelectorAll('video').length===1&&visible(container)?container:node;
  });
  const players=[];
  for(const node of [...new Set(nodes)].slice(0,12)){
    if(!visible(node))continue;
    const bounds=rect(node),fullyVisible=bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=innerWidth&&bounds.y+bounds.height<=innerHeight;
    let root=node,crossOrigin=false;
    if(node.tagName==='IFRAME'){try{root=node.contentDocument;if(!root)crossOrigin=true;}catch{crossOrigin=true;}}
    const videos=crossOrigin?[]:root.matches?.('video')?[root]:[...root.querySelectorAll('video')];
    const tracks=videos.length===1?[...videos[0].textTracks].filter(t=>['captions','subtitles'].includes(t.kind)&&['showing','hidden'].includes(t.mode)):[];
    const matches=crossOrigin?[]:[...root.querySelectorAll(captionSelector??'[id*="caption" i],[class*="caption" i],[id*="subtitle" i],[class*="subtitle" i]')];
    const captions=matches.filter(n=>!matches.some(other=>other!==n&&n.contains(other)));
    // A caption selector is evaluated inside the selected root, so IDs need
    // only be unique there; otherwise retain snapshot fallback for inspection.
    let caption=null;
    if(captions.length===1){
      const candidate=captions[0];
      if(candidate.id&&root.querySelectorAll(`#${CSS.escape(candidate.id)}`).length===1)caption=`#${CSS.escape(candidate.id)}`;
      if(!caption)for(const name of candidate.classList??[]){
        const css=`${candidate.tagName.toLowerCase()}.${CSS.escape(name)}`;
        if(root.querySelectorAll(css).length===1){caption=css;break;}
      }
    }
    const selectedCaption=captionSelector&&matches.length===1?captionSelector:caption;
    players.push({selector:selector??unique(node),kind:node.tagName==='IFRAME'?'iframe':'video',
      label:(node.getAttribute('aria-label')??node.getAttribute('title')??`Player ${players.length+1}`).slice(0,100),bounds,fullyVisible,
      selectable:fullyVisible&&(node.tagName!=='IFRAME'||visibleFrames.length===1&&(crossOrigin||videos.length===1)),
      captionSelector:selectedCaption,captionSupport:tracks.length?'text-track':selectedCaption?'dom':'snapshot',
      warning:!fullyVisible?'player-not-fully-visible':node.tagName==='IFRAME'&&visibleFrames.length!==1?'multiple-visible-iframes':node.tagName==='IFRAME'&&!crossOrigin&&videos.length!==1?'iframe-video-not-unique':crossOrigin?'cross-origin-snapshot':captionSelector&&matches.length!==1?'caption-selector-not-unique':!tracks.length&&!selectedCaption?'enable-subtitles-or-inspect-caption-element':null});
  }
  return {players,issue:players.length?null:'no-visible-player'};
}

export async function setupLecture(options={}){
  const browser=options.browser??'aside';
  if(browser!=='aside')return {step:'needs-browser',ready:false,actions:['For ego, use the existing authorized task-space flow in the lecture-companion skill. The first-run assistant currently supports Aside.']};
  let doctor;
  try{doctor=await runtimeDoctor();}catch{return {step:'needs-runtime',ready:false,actions:['Run the launcher from the complete installed skill. Check the existing Aside managed runtime or set LECTURE_NODE to a supported host Node.']};}
  const connection={...(options.account?{account:options.account}:{}),...(options.profile?{profile:options.profile}:{})};
  let tabs;
  try{tabs=await listAsideTabs(connection);}catch{return {step:'needs-browser',ready:false,runtime:doctor.runtime,actions:[
    'Open Aside and finish account sign-in and browser-profile setup.',
    'Enable the official CLI in Aside Developer settings, then retry setup.',
    'If selecting an existing account/profile, pass the same --account and --profile on setup and start.'],help:'https://docs.aside.com/help/developers'};}
  if(!options.tab){
    const matching=options.query?tabs.filter(t=>String(t.title).toLowerCase().includes(options.query.toLowerCase())):tabs;
    return {step:'choose-lecture',ready:false,runtime:doctor.runtime,lectures:matching.slice(0,30).map(t=>({tab:t.targetId,title:label(t.title)||'Untitled',site:site(t.url)})),omitted:Math.max(0,matching.length-30),actions:[matching.length?'Choose the lecture by title; pass its tab to setup/start.':'Open the lecture in Aside, enable its subtitles, then retry setup.']};
  }
  const tab=tabs.find(t=>t.targetId===options.tab);
  if(!tab)return {step:'choose-lecture',ready:false,lectures:[],actions:['The selected tab is gone. Run setup again and choose the intended lecture.']};
  let session;
  try{
    session=await connectAsidePage({...connection,targetId:options.tab});
    const inspected=await session.page.evaluate(discoverPlayers,{selector:options.selector??null,captionSelector:options['caption-selector']??null});
    const players=inspected.players.map(p=>({...p,label:label(p.label)}));
    const chosen=players.length===1?players[0]:null;
    if(!chosen)return {step:players.length?'choose-player':'needs-player',ready:false,title:label(tab.title),players,issue:inspected.issue,actions:[players.length?'Choose one observed player selector, then run start with --selector.':'Make the lecture player visible and retry. If it uses a custom player, inspect the original page through Aside REPL and supply its unique --selector.']};
    if(!chosen.selectable||chosen.warning==='caption-selector-not-unique')return {step:'needs-player',ready:false,title:label(tab.title),players,actions:['Keep the complete selected player visible, resolve the reported player/caption ambiguity, then retry.']};
    return {step:'ready-to-start',ready:false,runtime:doctor.runtime,title:label(tab.title),player:chosen,
      startArgs:['start','--browser','aside','--tab',options.tab,'--selector',chosen.selector,...(chosen.captionSelector?['--caption-selector',chosen.captionSelector]:[]),...(options.host?['--host',options.host]:[]),...(options.account?['--account',options.account]:[]),...(options.profile?['--profile',options.profile]:[])],
      actions:['Run start in the background. The host agent opens and binds the question chat from question-chat-required. Check verifies caption, image and bound-chat readiness.']};
  }catch{return {step:'needs-player',ready:false,actions:['Could not inspect the selected player. Verify the selected tab/profile and the selector in Aside, then retry.']};}
  finally{await session?.close();}
}

export async function startLecture(options={},onNotice=()=>{}){
  const host=options.host??'codex',durationSec=Number(options.duration??1800),captionMode=options['caption-mode']??'auto';
  if(!['codex','claude-code'].includes(host))throw new Error('host must be codex or claude-code');
  if(!Number.isFinite(durationSec)||durationSec<=0||!['auto','event','snapshot'].includes(captionMode))throw new Error('Invalid duration or caption mode');
  if(!options.tab)throw new Error('Choose the lecture title with setup before start; --tab is required');
  const out=options.out?resolve(options.out):sessionDirectory();
  if(existsSync(out))throw new Error('Session directory already exists. Use check/stop for that session or choose a fresh --out.');
  const plan=await setupLecture(options);
  if(plan.step!=='ready-to-start')throw new Error(`${plan.step}: ${plan.actions.join(' ')}`);
  const session=await connectAsidePage({targetId:options.tab,account:options.account,profile:options.profile});
  try{
    mkdirSync(out,{recursive:true,mode:0o700});
    writeFileSync(join(out,'manifest.json'),JSON.stringify({title:label(options.title??plan.title)||'강의',source:'Authorized Aside player',host,capturePid:process.pid,createdAt:new Date().toISOString()},null,2),{flag:'wx',mode:0o600});
    onNotice({type:'session-created',out,player:plan.player,host});
    return await runCapture({page:session.page,out,browser:'aside',durationSec,selector:plan.player.selector,
      captionSelector:plan.player.captionSelector,captionMode,imageNode:process.execPath,imageRuntime:hostRuntime(),onNotice:notice=>{
        if(notice.type==='started'){
          const study=new StudySession(out);study.init();
          const chat=study.prepareChat({host,title:label(options.title??plan.title),workerThreadId:options['worker-thread']??null});
          const promptFile=join(out,'question-chat-prompt.md');writeFileSync(promptFile,chat.prompt,{flag:'wx',mode:0o600});
          const {prompt,...metadata}=chat;
          onNotice({...notice});
          onNotice({type:'question-chat-required',out,chat:metadata,promptFile,
            ...(host==='claude-code'?{manualCommand:`claude --append-system-prompt-file ${quote(promptFile)}`,note:'Use a supported host opener, or run this command in another terminal. The chat is not open until a real session is created and bound.'}:{note:'Use native create_thread with the prompt file, then study chat-bind and navigate to the real chat. This notice does not create it.'})});
        }else onNotice(notice);
      }});
  }finally{await session.close();}
}

export function checkLecture(out){
  const status=JSON.parse(readFileSync(join(out,'status.json'),'utf8'));
  const questions=existsSync(join(out,'questions.json'))?JSON.parse(readFileSync(join(out,'questions.json'),'utf8')):null;
  const chat=questions?.chat??null;
  let ownerAlive=false,captionAvailable=false,frameAvailable=false,ended=false,lastEvent=null;
  try{
    try{
      const {capturePid}=JSON.parse(readFileSync(join(out,'manifest.json'),'utf8'));
      if(Number.isInteger(capturePid)&&capturePid>0){process.kill(capturePid,0);ownerAlive=true;}
    }catch{/* Completed/manual captures need not have a live owner manifest. */}
    const events=new Journal(out,{readOnly:true}).read();
    lastEvent=events.at(-1);ended=['end','interruption'].includes(lastEvent?.type);
    captionAvailable=events.some(e=>e.type==='caption'&&typeof e.text==='string'&&e.text.trim());
    frameAvailable=events.some(e=>{
      if(e.type!=='frame')return false;
      let fd;
      try{fd=openSync(safeFrame(out,e.file),'r');const signature=Buffer.alloc(8);return readSync(fd,signature,0,8,0)===8&&signature.equals(Buffer.from([137,80,78,71,13,10,26,10]));}
      catch{return false;}finally{if(fd!==undefined)closeSync(fd);}
    });
  }catch{/* Missing owner/evidence must not be promoted to ready. */}
  const active=ownerAlive&&!ended&&status.state==='capturing'&&existsSync(join(out,'.capture.lock'))&&Date.now()-Date.parse(status.updatedAt)<30000;
  const evidence=captionAvailable&&frameAvailable&&status.captionEvents>0&&status.framesSaved>0;
  const ready=active&&evidence&&chat?.status==='bound';
  const step=!active?'capture-stopped':!evidence?'waiting-for-evidence':chat?.status!=='bound'?'open-question-chat':'ready';
  const stopReason=status.stopReason??(lastEvent?.type==='end'?lastEvent.reason:null);
  const stoppedActions=lastEvent?.type==='end'?
    [...(stopReason==='player-changed'?['The selected player changed; this does not prove lecture completion. Choose the intended lecture explicitly for a fresh session.']:[]),
      'Drain remaining study batches, then export saved notes and Q&A with study export. The question chat can still use this session.']:
    ['Capture is stopped or its status is stale. Inspect status before starting another session. Saved evidence and Q&A can still be exported.'];
  return {step,ready,out,capture:{state:status.state,stopReason,completed:lastEvent?.type==='end'&&lastEvent.reason==='media-ended',ownerAlive,captionAvailable,frameAvailable,captionEvents:status.captionEvents,framesSaved:status.framesSaved,adapter:status.adapter,updatedAt:status.updatedAt},
    questionChat:chat?{host:chat.host,status:chat.status,threadId:chat.threadId,title:chat.title}:null,
    actions:ready?[]:step==='waiting-for-evidence'?['Enable visible subtitles and play the intended lecture; inspect capture status if evidence stays empty.']:step==='open-question-chat'?['Open the prepared question prompt using the native host, bind its real session ID with study chat-bind, then check again.']:stoppedActions};
}
