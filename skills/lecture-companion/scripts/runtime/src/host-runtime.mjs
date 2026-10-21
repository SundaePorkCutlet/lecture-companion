export function hostRuntime(){
  return globalThis.__lectureRuntime??{provider:process.env.LECTURE_RUNTIME_PROVIDER??'node',executable:process.execPath};
}

export async function runtimeDoctor(){
  const {PNG}=await import('../vendor/pngjs/lib/png.js');
  const {VisualWorker}=await import('./visual-worker.mjs');
  const runtime=hostRuntime(),worker=new VisualWorker({runtime});
  try{
    const image=new PNG({width:100,height:100});image.data.fill(255);
    const png=PNG.sync.write(image),first=await worker.process(png),duplicate=await worker.process(png);
    const ok=first.selected&&PNG.sync.read(Buffer.from(first.png)).width===100&&!duplicate.selected;
    if(!ok)throw new Error('Host image processing self-check failed');
    return {ok:true,runtime:{...runtime,nodeVersion:process.versions.node},imageWorker:{ok:true,duplicateFiltered:true},dependencies:{bundled:true,pngjs:'7.0.0'}};
  }finally{await worker.close();}
}
