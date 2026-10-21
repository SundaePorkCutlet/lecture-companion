import {checkText,RESOURCE_LIMITS} from './resource-limits.mjs';

export function parseSnapshot(snapshot){
  checkText(snapshot,RESOURCE_LIMITS.snapshotBytes,'snapshot-bytes');
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

// Aside snapshots use Playwright's indented ARIA representation. The caller
// scopes the snapshot to the unique selected player, including its frame tree.
export function parseAsideSnapshot(snapshot){
  checkText(snapshot,RESOURCE_LIMITS.snapshotBytes,'snapshot-bytes');
  if(typeof snapshot!=='string')throw new Error('Invalid Aside snapshot');
  const texts=[],stack=[];let playerFound=false;
  const control=body=>/^(title|button|group|slider|menu|menuitem|listbox|option|textbox|combobox|checkbox|radio|switch|progressbar|toolbar|spinbutton)\b/.test(body);
  for(const line of snapshot.split('\n')){
    const match=line.match(/^(\s*)- (.*)$/);if(!match)continue;
    const indent=match[1].length,body=match[2];
    while(stack.length&&stack.at(-1).indent>=indent)stack.pop();
    // Aside may append snapshots of sibling frames despite selector scoping.
    // Such orphan headers have no ref; only stitched iframe subtrees are safe.
    const excluded=control(body)||(/^iframe\b/.test(body)&&!body.includes('[ref='))||stack.some(s=>s.excluded);
    if(!excluded)playerFound=true;
    const inline=body.lastIndexOf(': "'),text=body.match(/^text(?: \[ref=[^\]]+\])?: (.*)$/);
    const named=!body.endsWith(':')?body.match(/^(?:text|generic|paragraph|label|heading) ("(?:\\"|[^"])*")(?= \[|$)/):null;
    if(!excluded&&(inline>=0||text||named)){
      let value=inline>=0?body.slice(inline+2):text?.[1]??named[1];
      // The native format escapes quotes but not backslashes. JSON.parse
      // would corrupt code/paths. Literal \\n and source newlines are ambiguous.
      if(value.startsWith('"')&&value.endsWith('"'))value=value.slice(1,-1).replace(/\\"/g,'"');
      else if(value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1).replace(/''/g,"'");
      if(value.trim()&&!/^(?:\d+:)+\d+$|^\d+(?:\.\d+)?x$/.test(value))texts.push(value);
    }
    stack.push({indent,excluded});
  }
  return {caption:texts.join(' ').trim(),mediaTime:null,playerFound,paused:null};
}
