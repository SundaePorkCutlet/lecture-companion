import {VisualGate,prepareFrame} from './visual.mjs';
const gate=new VisualGate();
process.on('message',async input=>{
  const start=performance.now();
  try{
    const {png,pixels}=await prepareFrame(Buffer.from(input.png,'base64'));
    const selected=gate.observe(pixels);
    process.send({selected,png:selected?png.toString('base64'):null,processingMs:performance.now()-start});
  }catch{process.send({error:'invalid-image'});}
});
