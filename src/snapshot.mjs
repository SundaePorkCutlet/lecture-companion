export function parseSnapshot(snapshot){
  if((snapshot.match(/region "video player"/g)??[]).length>1)throw new Error('Exactly one video player is supported');
  const lines=snapshot.split('\n'),start=lines.findIndex(l=>/region "video player"/.test(l));
  if(start<0)return {caption:'',mediaTime:null,playerFound:false,paused:null};
  const base=lines[start].search(/\S/),stack=[],texts=[];let paused=null;
  for(const line of lines.slice(start+1)){
    if(!line.trim())continue;
    const indent=line.search(/\S/);if(indent<=base)break;
    while(stack.length && stack.at(-1).indent>=indent)stack.pop();
    const body=line.trim();
    if(/^button "(?:일시정지|Pause)"/.test(body))paused=false;
    if(/^button "(?:재생|Play)"/.test(body))paused=true;
    const match=body.match(/^text ("(?:[^"\\]|\\.)*")$/);
    if(match && !stack.some(s=>/^(button|group|slider|menu|listbox|option)\b/.test(s.body))){
      const text=JSON.parse(match[1]);
      if(text.trim() && !/^(?:\d+:)+\d+$|^\d+(?:\.\d+)?x$/.test(text))texts.push(text);
    }
    stack.push({indent,body});
  }
  return {caption:texts.join(' ').trim(),mediaTime:null,playerFound:true,paused};
}
