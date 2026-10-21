import {PNG} from '../vendor/pngjs/lib/png.js';

function difference(a,b){
  if(!a||a.length!==b.length)return 1;
  let changed=0;for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>=28)changed++;
  return changed/a.length;
}
export class VisualGate{
  constructor({changedFraction=0.01,stableSamples=2}={}){this.threshold=changedFraction;this.stableSamples=stableSamples;this.last=null;this.candidate=null;this.count=0;}
  observe(pixels){
    if(!this.last){this.last=Buffer.from(pixels);return true;}
    if(difference(this.last,pixels)<this.threshold){this.candidate=null;this.count=0;return false;}
    if(this.candidate && difference(this.candidate,pixels)<this.threshold/2)this.count++;
    else{this.candidate=Buffer.from(pixels);this.count=1;}
    if(this.count<this.stableSamples)return false;
    this.last=Buffer.from(pixels);this.candidate=null;this.count=0;return true;
  }
}
export async function prepareFrame(input,{keepHeight=0.8}={}){
  if(!(keepHeight>0&&keepHeight<=1))throw new Error('keepHeight must be in (0,1]');
  const source=PNG.sync.read(input),width=source.width,height=Math.max(1,Math.floor(source.height*keepHeight));
  const pixels=Buffer.alloc(320*180);
  for(let y=0;y<180;y++)for(let x=0;x<320;x++){
    const i=(Math.floor(y*height/180)*width+Math.floor(x*width/320))*4;
    pixels[y*320+x]=Math.round(source.data[i]*0.299+source.data[i+1]*0.587+source.data[i+2]*0.114);
  }
  return {png:Buffer.from(input),pixels};
}
