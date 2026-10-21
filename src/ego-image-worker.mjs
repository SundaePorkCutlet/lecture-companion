import {EventEmitter} from 'node:events';
import {createServer,createConnection} from 'node:net';
import {createInterface} from 'node:readline';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createImageProcessor} from './image-processor.mjs';

// ego's supported nodejs command supplies Node APIs but its execPath is an app
// helper, not a standalone Node binary. A private local socket replaces fork IPC.
export class EgoImageWorker extends EventEmitter{
  constructor(command){
    super();this.exitCode=null;this.signalCode=null;this.closing=false;this.finished=false;
    this.directory=mkdtempSync('/tmp/lecture-image-');this.path=join(this.directory,'ipc');this.token=randomUUID();
    this.ready=new Promise(resolve=>{this.resolveReady=resolve;});
    this.server=createServer(socket=>{
      if(this.socket||this.closing){socket.destroy();return;}
      this.socket=socket;
      const lines=createInterface({input:socket});let authenticated=false;
      lines.on('line',line=>{
        try{
          const message=JSON.parse(line);
          if(!authenticated){
            if(message.ready!==this.token)throw new Error('Invalid worker handshake');
            authenticated=true;this.resolveReady(socket);
          }else this.emit('message',message);
        }catch(error){this.emit('error',error);this.kill();}
      });
      socket.on('error',error=>this.emit('error',error));
      socket.on('close',()=>{if(!this.closing)this.emit('error',new Error('Image worker disconnected'));});
    });
    this.server.on('error',error=>{this.emit('error',error);this.kill();});
    this.server.listen(this.path,()=>{
      if(this.closing)return;
      const source=`const {runEgoImageWorker}=await import(${JSON.stringify(import.meta.url)});await runEgoImageWorker(${JSON.stringify(this.path)},${JSON.stringify(this.token)});`;
      this.child=spawn(command,['nodejs','-e',source],{stdio:'ignore'});
      this.child.on('error',error=>{this.emit('error',error);this.finish(1,null);});
      this.child.on('exit',(code,signal)=>this.finish(code,signal));
    });
  }
  send(message,callback){
    this.ready.then(socket=>{
      if(!socket||this.closing){callback?.(new Error('Image worker closed'));return;}
      socket.write(JSON.stringify(message)+'\n',callback);
    }).catch(error=>callback?.(error));
  }
  cleanup(){
    this.resolveReady(null);this.socket?.destroy();
    this.server.close(()=>rmSync(this.directory,{recursive:true,force:true}));
  }
  finish(code,signal){
    if(this.finished)return;this.finished=true;this.closing=true;
    this.exitCode=code;this.signalCode=signal;this.cleanup();this.emit('exit',code,signal);
  }
  kill(signal='SIGTERM'){
    this.closing=true;this.cleanup();
    if(this.child&&!this.finished)this.child.kill(signal);else if(!this.finished)this.finish(0,null);
  }
}

export async function runEgoImageWorker(socketPath,token){
  const processImage=createImageProcessor(),socket=createConnection(socketPath);
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
  socket.write(JSON.stringify({ready:token})+'\n');
  const lines=createInterface({input:socket});
  try{for await(const line of lines)socket.write(JSON.stringify(await processImage(JSON.parse(line)))+'\n');}
  finally{socket.destroy();}
}
