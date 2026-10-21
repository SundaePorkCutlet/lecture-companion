import {fork} from 'node:child_process';
import {EgoImageWorker} from './ego-image-worker.mjs';

export class VisualWorker {
  constructor({workerURL=new URL('./visual-worker-process.mjs',import.meta.url),nodeExecutable=process.execPath,timeoutMs=10000,runtime=null}={}){
    this.timeoutMs=timeoutMs;this.closed=false;this.pending=null;this.failure=null;
    // JSON/base64 works across ego's embedded Node/V8 and the host Node version.
    this.worker=runtime?.provider==='ego'?new EgoImageWorker(runtime.command):fork(workerURL,[],{execPath:nodeExecutable,execArgv:[],serialization:'json',stdio:['ignore','ignore','ignore','ipc']});
    this.worker.on('message',result=>{
      const pending=this.pending;if(!pending)return;
      clearTimeout(pending.timer);this.pending=null;
      if(result.error)pending.reject(new Error('Image worker could not process frame'));
      else pending.resolve({...result,png:result.png?Buffer.from(result.png,'base64'):null});
    });
    this.worker.on('error',()=>this.fail(new Error('Image worker failed')));
    this.worker.on('exit',()=>{if(!this.closed)this.fail(new Error('Image worker exited'));});
  }
  fail(error){this.failure=error;if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(error);this.pending=null;}}
  async process(png){
    if(this.closed||this.failure)throw this.failure??new Error('Image worker closed');
    if(this.pending)throw new Error('Image worker busy');
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.fail(new Error('Image worker timed out'));void this.close();},this.timeoutMs);
      this.pending={resolve,reject,timer};
      try{this.worker.send({png:Buffer.from(png).toString('base64')},error=>{if(error)this.fail(new Error('Image worker send failed'));});}catch{this.fail(new Error('Image worker send failed'));}
    });
  }
  async close(){
    if(this.closePromise)return this.closePromise;this.closed=true;
    this.fail(new Error('Image worker closed'));
    this.closePromise=(async()=>{
      if(this.worker.exitCode!==null||this.worker.signalCode!==null)return;
      await new Promise(resolve=>{
        const timer=setTimeout(()=>this.worker.kill('SIGKILL'),1000);
        this.worker.once('exit',()=>{clearTimeout(timer);resolve();});this.worker.kill();
      });
    })();
    return this.closePromise;
  }
}
