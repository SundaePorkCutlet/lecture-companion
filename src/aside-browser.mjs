import {spawn} from 'node:child_process';
import {accessSync,constants} from 'node:fs';
import {join,delimiter,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseAsideSnapshot} from './snapshot.mjs';
import {measurePlayer} from './player-frame.mjs';

const executable=path=>{try{accessSync(path,constants.X_OK);return true;}catch{return false;}};
export function findAsideCommand(env=process.env){
  if(env.LECTURE_ASIDE){
    if(!isAbsolute(env.LECTURE_ASIDE)||!executable(env.LECTURE_ASIDE))throw new Error('LECTURE_ASIDE must be an executable absolute Aside CLI path');
    return env.LECTURE_ASIDE;
  }
  const home=env.HOME??'',install=env.ASIDE_CLI_INSTALL_DIR??(home?join(home,'.aside/cli'):null);
  const candidates=[...(env.PATH??'').split(delimiter).filter(Boolean).map(p=>join(p,'aside')),
    ...(home?[join(home,'.local/bin/aside')]:[]),
    ...(install?[join(install,'Aside CLI.app/Contents/MacOS/aside'),join(install,'aside')]:[])];
  const found=candidates.find(p=>isAbsolute(p)&&executable(p));
  if(!found)throw new Error('Aside CLI not found. Check Aside Developer settings or set LECTURE_ASIDE to its existing CLI path. No software was installed.');
  return found;
}

// Only the supported MCP REPL tool is used. No agent/model task is started.
// Keep one session so browser event probes survive consecutive reads.
export class AsideClient{
  constructor({command=findAsideCommand(),account,profile,timeoutMs=15000}={}){
    if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new Error('Invalid Aside timeout');
    this.timeoutMs=timeoutMs;this.nextId=0;this.pending=new Map();this.buffer=Buffer.alloc(0);this.failure=null;this.closed=false;
    const args=['mcp'];if(account)args.push('--account',account);if(profile)args.push('--profile',profile);
    this.child=spawn(command,args,{stdio:['pipe','pipe','ignore']});
    this.exited=new Promise(resolve=>this.child.once('close',resolve));
    this.child.on('error',()=>this.fail('Aside CLI could not start'));
    this.child.on('exit',()=>{if(!this.closed)this.fail('Aside browser connection ended');});
    this.child.stdin.on('error',()=>this.fail('Aside browser connection ended'));
    this.child.stdout.on('data',chunk=>this.receive(chunk));
  }
  fail(message){
    this.failure??=new Error(message);
    for(const {reject,timer} of this.pending.values()){clearTimeout(timer);reject(this.failure);}this.pending.clear();
    if(!this.closed)this.child.kill();
    return this.failure;
  }
  receive(chunk){
    this.buffer=Buffer.concat([this.buffer,chunk]);
    if(this.buffer.length>32*1024*1024){this.fail('Aside response exceeded the local limit');return;}
    let at;
    while((at=this.buffer.indexOf(10))>=0){
      const line=this.buffer.subarray(0,at).toString('utf8');this.buffer=this.buffer.subarray(at+1);if(!line.trim())continue;
      let packet;try{packet=JSON.parse(line);}catch{this.fail('Aside returned an invalid MCP response');return;}
      const pending=this.pending.get(packet.id);if(!pending)continue;
      this.pending.delete(packet.id);clearTimeout(pending.timer);
      if(packet.error)pending.reject(this.fail('Aside MCP request failed; inspect the authorized browser before retrying'));
      else pending.resolve(packet.result);
    }
  }
  request(method,params){
    if(this.failure||this.closed)return Promise.reject(this.failure??new Error('Aside connection closed'));
    return new Promise((resolve,reject)=>{
      const id=++this.nextId,timer=setTimeout(()=>this.fail('Aside browser request timed out; capture stopped'),this.timeoutMs);
      this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
    });
  }
  async start(){
    await this.request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'lecture-companion',version:'0.8.0'}});
    this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    const listed=await this.request('tools/list',{});
    if(!listed.tools?.some(t=>t.name==='repl'&&t.inputSchema?.properties?.code))throw this.fail('Aside MCP REPL tool is unavailable');
  }
  json(expression){
    const next=(this.queue??Promise.resolve()).then(()=>this.runJSON(expression));
    this.queue=next.catch(()=>{});return next;
  }
  async runJSON(expression){
    const marker=`lecture-${randomUUID()}:`;
    const result=await this.request('tools/call',{name:'repl',arguments:{title:'Observe the authorized lecture',code:`console.log(${JSON.stringify(marker)}+JSON.stringify(await (${expression})))`}});
    if(result?.isError)throw this.fail('Aside browser operation failed; inspect the authorized tab and account before retrying');
    const values=(result?.content??[]).filter(p=>p.type==='text').flatMap(p=>p.text.split('\n')).filter(line=>line.startsWith(marker));
    if(values.length!==1)throw this.fail('Aside returned no complete observation');
    try{return JSON.parse(values[0].slice(marker.length));}catch{throw this.fail('Aside returned an incomplete observation');}
  }
  async close(){
    if(this.closePromise)return this.closePromise;this.closed=true;
    for(const {reject,timer}of this.pending.values()){clearTimeout(timer);reject(new Error('Aside connection closed'));}this.pending.clear();
    this.closePromise=(async()=>{
      this.child.stdin.end();
      const timer=setTimeout(()=>this.child.kill('SIGKILL'),1500);
      try{await this.exited;}finally{clearTimeout(timer);}
    })();return this.closePromise;
  }
}

export async function listAsideTabs(options={}){
  const client=new AsideClient(options);
  try{await client.start();return await client.json('listBrowserTabs()');}finally{await client.close();}
}

export async function connectAsidePage({targetId,...options}){
  if(typeof targetId!=='string'||!targetId.trim())throw new Error('Aside capture requires an explicit --tab target ID');
  const client=new AsideClient(options);
  try{
    await client.start();
    const tabs=await client.json('listBrowserTabs()');
    if(!tabs.some(t=>t.targetId===targetId))throw new Error('The selected Aside tab is no longer available');
    await client.json(`(async()=>{await attachBrowserTab(${JSON.stringify(targetId)});return true;})()`);
    // A reset session has no such attached page and must fail, never switch tabs.
    const ref=`getTabByTargetId(${JSON.stringify(targetId)})`;
    const page={snapshotKind:'aside-accessibility-poll',captionLeaseMs:60000,
      evaluate:(fn,arg)=>client.json(`${ref}.evaluate((${fn.toString()}),${JSON.stringify(arg)??'undefined'})`),
      async readCaptionSnapshot(selector){
        await this.evaluate(selector=>{if(document.querySelectorAll(selector).length!==1)throw new Error('Choose exactly one player element');return true;},selector);
        const snapshot=await client.json(`snapshot(${ref},{selector:${JSON.stringify(selector)}})`);
        return {state:parseAsideSnapshot(snapshot.tree),rawBytes:Buffer.byteLength(snapshot.tree)};
      },
      async screenshot(clip,viewport,selector){
        // Native Aside 1.26.1021 ignored screenshot clip origins. Capture the
        // viewport and crop in the existing external image worker instead.
        const expected={...clip,viewportWidth:viewport.width,viewportHeight:viewport.height,pixelRatio:viewport.pixelRatio};
        const data=await client.json(`(async()=>{
          const expected=${JSON.stringify(expected)};
          const unchanged=async()=>{const current=await ${ref}.evaluate((${measurePlayer.toString()}),${JSON.stringify(selector)});return Object.keys(expected).every(key=>current[key]===expected[key]);};
          if(!await unchanged())return null;
          const shot=await ${ref}.screenshot({type:'png',timeout:10000});
          if(!await unchanged())return null;
          return Buffer.from(shot).toString('base64');
        })()`);
        if(data===null)throw new Error('Aside player geometry changed during screenshot; inspect the player before restarting');
        if(typeof data!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))throw client.fail('Aside returned an invalid screenshot');
        return {png:Buffer.from(data,'base64'),crop:{x:clip.x,y:clip.y,width:clip.width,height:clip.height,viewportWidth:viewport.width,viewportHeight:viewport.height,pixelRatio:viewport.pixelRatio}};
      }
    };
    return {page,client,close:()=>client.close()};
  }catch(error){await client.close();throw error;}
}
