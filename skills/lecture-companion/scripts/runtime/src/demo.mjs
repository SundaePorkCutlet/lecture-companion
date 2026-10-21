import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';

// A self-authored, silent lecture. Only these two assets are served; private
// captures, repository files and the current working directory are unreachable.
export async function serveDemo(){
  const assets=new Map([
    ['/',{type:'text/html; charset=utf-8',data:readFileSync(new URL('../assets/demo/player.html',import.meta.url))}],
    ['/lecture.webm',{type:'video/webm',data:readFileSync(new URL('../assets/demo/lecture.webm',import.meta.url))}]
  ]);
  const server=createServer((req,res)=>{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
    const asset=assets.get(req.url);
    if(!asset){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':asset.type,'Content-Length':asset.data.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:asset.data);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}/`,close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}
