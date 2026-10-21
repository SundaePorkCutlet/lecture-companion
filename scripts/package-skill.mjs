#!/usr/bin/env node
import {readFileSync,writeFileSync,readdirSync,lstatSync,mkdirSync,existsSync,unlinkSync,mkdtempSync,rmSync,chmodSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';

const root=resolve(fileURLToPath(new URL('../',import.meta.url))),skill=join(root,'skills/lecture-companion');
const {values}=parseArgs({options:{check:{type:'boolean'},archive:{type:'boolean'},out:{type:'string'}}});
const metadata=JSON.parse(readFileSync(join(root,'package.json'),'utf8')),files=new Map();
const hash=data=>createHash('sha256').update(data).digest('hex');
function tree(base,path=''){
  const directory=lstatSync(join(base,path));
  if(!directory.isDirectory()||directory.isSymbolicLink())throw new Error(`Bundle directory must be a regular directory: ${join(base,path)}`);
  return readdirSync(join(base,path)).sort().flatMap(name=>{
    const entry=join(path,name),info=lstatSync(join(base,entry));
    if(info.isSymbolicLink())throw new Error(`Bundle source cannot contain symlinks: ${entry}`);
    if(info.isDirectory())return tree(base,entry);
    if(!info.isFile())throw new Error(`Unsupported bundle entry: ${entry}`);
    return [entry];
  });
}
function add(source,destination){if(!lstatSync(source).isFile()||lstatSync(source).isSymbolicLink())throw new Error(`Bundle source must be a regular file: ${source}`);files.set(destination,readFileSync(source));}
function existing(path){try{return lstatSync(path);}catch(error){if(error.code==='ENOENT')return;throw error;}}
function preflightTarget(name){
  const parts=name.split('/');let parent=skill;
  for(const part of parts.slice(0,-1)){
    parent=join(parent,part);const info=existing(parent);
    if(info&&(!info.isDirectory()||info.isSymbolicLink()))throw new Error(`Bundle target directory must be a regular directory: ${parent}`);
  }
  const target=join(skill,name),info=existing(target);
  if(info&&(!info.isFile()||info.isSymbolicLink()))throw new Error(`Bundle target must be a regular file: ${target}`);
}
for(const directory of [root,join(root,'skills'),skill,join(skill,'scripts')]){const info=lstatSync(directory);if(!info.isDirectory()||info.isSymbolicLink())throw new Error(`Bundle directory must be a regular directory: ${directory}`);}
for(const file of ['SKILL.md','scripts/lecture','scripts/lecture.mjs','scripts/install.sh'])add(join(skill,file),file);
for(const folder of ['agents','references'])for(const file of tree(join(skill,folder)))add(join(skill,folder,file),`${folder}/${file}`);
for(const folder of ['bin','src','vendor','assets'])for(const file of tree(join(root,folder)))add(join(root,folder,file),`scripts/runtime/${folder}/${file}`);
add(join(root,'LICENSE'),'LICENSE');
files.set('scripts/runtime/package.json',Buffer.from(JSON.stringify({name:'lecture-companion-runtime',version:metadata.version,private:true,type:'module',engines:metadata.engines},null,2)+'\n'));
for(const name of files.keys())if(!/^[a-zA-Z0-9_.\/-]+$/.test(name)||name.split('/').includes('..'))throw new Error(`Unsafe bundle path: ${name}`);
files.set('FILES',Buffer.from([...files.keys(),'FILES'].sort().join('\n')+'\n'));
const manifest=[...files].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,data])=>`${hash(data)}  ${name}\n`).join('');
files.set('BUNDLE.sha256',Buffer.from(manifest));

try{
  // Validate every destination before deleting or writing any generated file.
  for(const name of files.keys())preflightTarget(name);
  const runtime=join(skill,'scripts/runtime');
  const actual=existsSync(runtime)?tree(runtime).map(p=>`scripts/runtime/${p}`):[];
  const expected=new Set(files.keys());
  if(values.check){
    const stale=[...files].filter(([name,data])=>!existsSync(join(skill,name))||lstatSync(join(skill,name)).isSymbolicLink()||!readFileSync(join(skill,name)).equals(data)).map(([name])=>name);
    const extra=actual.filter(name=>!expected.has(name));
    if(stale.length||extra.length)throw new Error(`Skill bundle is stale; run npm run build:skill. Changed: ${[...stale,...extra].join(', ')}`);
  }else{
    // Only remove obsolete generated files owned by the previous bundle.
    const owned=new Set(existsSync(join(skill,'BUNDLE.sha256'))?readFileSync(join(skill,'BUNDLE.sha256'),'utf8').trim().split('\n').map(line=>line.slice(66)):[]);
    for(const name of actual.filter(name=>!expected.has(name))){if(!owned.has(name))throw new Error(`Unmanaged runtime file preserved: ${name}`);unlinkSync(join(skill,name));}
    for(const [name,data]of files){
      if(!name.startsWith('scripts/runtime/')&&!['LICENSE','FILES','BUNDLE.sha256'].includes(name))continue;
      const target=join(skill,name);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,data);
    }
    for(const name of ['scripts/lecture','scripts/install.sh','scripts/runtime/bin/lecture'])chmodSync(join(skill,name),0o755);
  }
  let archive;
  if(values.archive){
    archive=resolve(values.out??join(root,'dist',`lecture-companion-${metadata.version}.zip`));
    const staging=mkdtempSync(join(tmpdir(),'lecture-skill-release-'));
    try{
      for(const [name,data]of files){const target=join(staging,'lecture-companion',name);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,data);if(['scripts/lecture','scripts/install.sh','scripts/runtime/bin/lecture'].includes(name))chmodSync(target,0o755);}
      const zipped=join(staging,'bundle.zip'),result=spawnSync('zip',['-X','-q','-r',zipped,'lecture-companion'],{cwd:staging,encoding:'utf8'});
      if(result.status!==0)throw new Error('ZIP creation failed; the maintainer environment needs zip.');
      mkdirSync(dirname(archive),{recursive:true});writeFileSync(archive,readFileSync(zipped));
      writeFileSync(`${archive}.sha256`,`${hash(readFileSync(archive))}  ${archive.split('/').at(-1)}\n`);
    }finally{rmSync(staging,{recursive:true,force:true});}
  }else if(values.out)throw new Error('--out requires --archive');
  console.log(JSON.stringify({ok:true,version:metadata.version,files:files.size,bytes:[...files.values()].reduce((sum,b)=>sum+b.length,0),...(archive?{archive}:{})}));
}catch(error){console.error(error.message);process.exitCode=1;}
