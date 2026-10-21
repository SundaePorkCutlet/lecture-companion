// A subprocess boundary fixture for Aside's documented MCP REPL contract.
import {createInterface} from 'node:readline';
import {createContext,runInContext} from 'node:vm';
import {PNG} from '../../vendor/pngjs/lib/png.js';
const image=new PNG({width:120,height:100});image.data.fill(255);
const png=PNG.sync.write(image),attached=new Map();
const page={evaluate:async(fn,arg)=>fn(arg),screenshot:async({clip})=>{
  if(clip.width!==120||clip.height!==100)throw new Error('wrong clip');return png;
}};
const tabs=[{targetId:'lecture-1',title:'Synthetic lecture',url:'http://localhost/lecture',active:false},{targetId:'private-2',title:'Other tab',url:'http://localhost/private',active:true}];
let lines=[],busy=false;
const context=createContext({Buffer,setTimeout,console:{log:s=>lines.push(String(s))},
  innerWidth:800,innerHeight:600,
  document:{querySelectorAll:selector=>selector==='#player'?[{tagName:'SECTION',getBoundingClientRect:()=>({x:0,y:0,width:120,height:100,right:120,bottom:100})}]:[]},
  listBrowserTabs:async()=>tabs,
  attachBrowserTab:async id=>{if(id!=='lecture-1')throw new Error('wrong target');attached.set(id,page);return page;},
  getTabByTargetId:id=>{if(!attached.has(id))throw new Error('not attached');return page;},
  snapshot:async(p,options)=>{if(options.selector!=='#player')throw new Error('unscoped snapshot');return {tree:'- region "video player" [ref=e1]:\n  - text: "Pod is a deployment unit"\n  - button "Pause":\n    - text: control label\n  - slider "progress"',diff:''};}
});
const send=x=>{const data=JSON.stringify(x)+'\n';process.stdout.write(data.slice(0,9));process.stdout.write(data.slice(9));};
createInterface({input:process.stdin}).on('line',async line=>{
  const msg=JSON.parse(line);if(!msg.id)return;
  let result;
  if(msg.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'aside-fixture',version:'1'}};
  else if(msg.method==='tools/list')result={tools:[{name:'repl',inputSchema:{type:'object',properties:{code:{type:'string'},title:{type:'string'}},required:['code','title']}}]};
  else if(msg.method==='tools/call'&&msg.params.name==='repl'){
    if(busy){send({jsonrpc:'2.0',id:msg.id,result:{isError:true,content:[{type:'text',text:'REPL busy'}]}});return;}busy=true;
    lines=[];
    try{await runInContext(`(async()=>{${msg.params.arguments.code}})()`,context);result={content:lines.map(text=>({type:'text',text})),isError:false};}
    catch{result={content:[{type:'text',text:'Error: control lost https://secret/?jwt=PRIVATE'}],isError:true};}
    finally{busy=false;}
  }else {send({jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Unexpected method'}});return;}
  send({jsonrpc:'2.0',id:msg.id,result});
});
