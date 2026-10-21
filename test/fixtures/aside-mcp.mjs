// A subprocess boundary fixture for Aside's documented MCP REPL contract.
import {createInterface} from 'node:readline';
import {createContext,runInContext} from 'node:vm';
import {PNG} from '../../vendor/pngjs/lib/png.js';
const image=new PNG({width:800,height:600});
for(let y=0;y<600;y++)for(let x=0;x<800;x++){const i=(y*800+x)*4;image.data[i]=210;image.data[i+3]=255;if(x>=16&&x<136&&y>=24&&y<124){image.data[i]=0;image.data[i+1]=180;}}
const png=PNG.sync.write(image),attached=new Map();
const page={evaluate:async(fn,arg)=>fn(arg),screenshot:async({clip})=>{
  if(context.fixtureScreenshotChange==='resize'){context.innerWidth=1600;context.innerHeight=1200;}
  if(context.fixtureScreenshotChange==='scroll')context.fixtureOffset=20;
  if(!clip)return png;
  // Native Aside 1.26.1021 respected clip size but ignored its origin.
  const cropped=new PNG({width:clip.width,height:clip.height});
  for(let y=0;y<clip.height;y++)image.data.copy(cropped.data,y*clip.width*4,y*800*4,(y*800+clip.width)*4);
  return PNG.sync.write(cropped);
}};
const tabs=[{targetId:'lecture-1',title:'Synthetic lecture',url:'http://localhost/lecture?jwt=PRIVATE',active:false},{targetId:'private-2',title:'Other tab',url:'http://localhost/private',active:true}];
const caption={id:'caption',contains:()=>false};
function player(id,y){
  const selected={id,tagName:'SECTION',getAttribute:name=>name==='aria-label'?'video player':null,
    getBoundingClientRect:()=>({x:16,y:y+(context.fixtureOffset??0),width:120,height:100,right:136,bottom:y+100+(context.fixtureOffset??0)}),
    matches:()=>false,querySelectorAll:selector=>selector==='video'?[video]:[caption]};
  const video={id:`video-${id}`,tagName:'VIDEO',getBoundingClientRect:selected.getBoundingClientRect,closest:()=>selected,textTracks:[]};
  return {selected,video};
}
const first=player('player',24),second=player('player2',process.env.LECTURE_FIXTURE_OFFSCREEN?900:200);
const all=process.env.LECTURE_FIXTURE_TWO_PLAYERS?[first,second]:[first];
if(process.env.LECTURE_FIXTURE_IFRAMES)for(const item of all){item.selected.tagName='IFRAME';item.selected.contentDocument=item.selected;}
const resource={id:'resource',tagName:'IFRAME',getAttribute:()=>null,getBoundingClientRect:first.selected.getBoundingClientRect,
  contentDocument:{matches:()=>false,querySelectorAll:()=>[]}};
let lines=[],busy=false;
const context=createContext({Buffer,setTimeout,console:{log:s=>lines.push(String(s))},
  innerWidth:800,innerHeight:600,devicePixelRatio:1,CSS:{escape:value=>value},getComputedStyle:()=>({visibility:'visible',display:'block'}),
  document:{querySelectorAll:selector=>process.env.LECTURE_FIXTURE_RESOURCE_FRAME?(['iframe','video,iframe','#resource'].includes(selector)?[resource]:[]):process.env.LECTURE_FIXTURE_IFRAMES&&['iframe','video,iframe'].includes(selector)?all.map(p=>p.selected):selector==='video,iframe'?all.map(p=>p.video):all.filter(p=>selector===`#${p.selected.id}`).map(p=>p.selected)},
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
