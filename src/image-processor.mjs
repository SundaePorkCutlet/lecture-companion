import {VisualGate,prepareFrame} from './visual.mjs';

export function createImageProcessor(){
  const gate=new VisualGate();
  return async input=>{
    const start=performance.now();
    try{
      const {png,pixels}=await prepareFrame(Buffer.from(input.png,'base64'));
      const selected=gate.observe(pixels);
      return {selected,png:selected?png.toString('base64'):null,processingMs:performance.now()-start};
    }catch{return {error:'invalid-image'};}
  };
}
