// Self-contained so browser adapters can recheck the same geometry around a shot.
export function measurePlayer(selector){
    const nodes=[...document.querySelectorAll(selector)];
    if(nodes.length!==1)throw new Error('Choose exactly one player element');
    if(nodes[0].tagName==='IFRAME'){
      const visible=[...document.querySelectorAll('iframe')].filter(f=>{
        const r=f.getBoundingClientRect();return r.width>=50&&r.height>=50&&r.x+r.width>0&&r.y+r.height>0&&r.x<innerWidth&&r.y<innerHeight&&getComputedStyle(f).visibility!=='hidden'&&getComputedStyle(f).display!=='none';
      });
      if(visible.length!==1||visible[0]!==nodes[0])throw new Error('Exactly one visible player iframe is supported');
    }
    const r=nodes[0].getBoundingClientRect();
    if(r.x<0||r.y<0||r.width<50||r.height<50||r.right>innerWidth||r.bottom>innerHeight)throw new Error('Player must be fully visible');
    return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1,viewportWidth:innerWidth,viewportHeight:innerHeight,pixelRatio:devicePixelRatio};
}

export async function capturePlayerFrame(page,selector,signal){
  const bounds=await page.evaluate(measurePlayer,selector);
  if(signal?.aborted)return null;
  const {viewportWidth,viewportHeight,pixelRatio,...clip}=bounds;
  // Some adapters return an uncropped PNG plus crop metadata. Only the image
  // worker's result is publishable; never persist this intermediate packet.
  if(page.screenshot)return page.screenshot(clip,{width:viewportWidth,height:viewportHeight,pixelRatio},selector);
  const shot=await page.cdp('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:false},{timeout:10000});
  return Buffer.from(shot.data,'base64');
}
