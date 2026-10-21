import {VisualGate,prepareFrame} from './visual.mjs';
import {PNG} from '../vendor/pngjs/lib/png.js';

function cropViewport(png,crop){
  const {x,y,width,height,viewportWidth,viewportHeight,pixelRatio}=crop;
  if(![x,y,width,height,viewportWidth,viewportHeight,pixelRatio].every(Number.isFinite)||x<0||y<0||width<=0||height<=0||viewportWidth<=0||viewportHeight<=0||pixelRatio<=0||x+width>viewportWidth||y+height>viewportHeight)throw new Error('Invalid player crop');
  const source=PNG.sync.read(png),scaleX=source.width/viewportWidth,scaleY=source.height/viewportHeight;
  if(Math.abs(source.width-viewportWidth*pixelRatio)>1||Math.abs(source.height-viewportHeight*pixelRatio)>1)throw new Error('Viewport image dimensions changed');
  const left=Math.round(x*scaleX),top=Math.round(y*scaleY),right=Math.round((x+width)*scaleX),bottom=Math.round((y+height)*scaleY);
  if(left<0||top<0||right>source.width||bottom>source.height||right<=left||bottom<=top)throw new Error('Invalid pixel crop');
  const target=new PNG({width:right-left,height:bottom-top});
  for(let row=top;row<bottom;row++)source.data.copy(target.data,(row-top)*target.width*4,(row*source.width+left)*4,(row*source.width+right)*4);
  return PNG.sync.write(target);
}

export function createImageProcessor(){
  const gate=new VisualGate();
  return async input=>{
    const start=performance.now();
    try{
      const decoded=Buffer.from(input.png,'base64');
      const {png,pixels}=await prepareFrame(input.crop?cropViewport(decoded,input.crop):decoded);
      const selected=gate.observe(pixels);
      return {selected,png:selected?png.toString('base64'):null,processingMs:performance.now()-start};
    }catch{return {error:'invalid-image'};}
  };
}
