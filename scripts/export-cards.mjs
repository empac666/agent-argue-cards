#!/usr/bin/env node
// 站队卡导出命令行（不调用任何模型）：
//   node scripts/export-cards.mjs snapshot <roundId...> [--data .data/rounds.json] [--out cards] [--force]
//       把已发布（人工审过）的卡片辩论导出成可提交的公开数据 cards/<id>.json
//   node scripts/export-cards.mjs image <roundId|cards/<id>.json...> [--data ...] [--out exports] [--lang zh|en]
//       导出微信长图（1080px 宽 PNG）
//   node scripts/export-cards.mjs stamp cards/<id>.json…   人工审核译文后盖章（绑定原文版本 + 译文自身版本）
//   node scripts/export-cards.mjs site [--cards cards] [--out _site] [--config site.config.json] [--no-og]
//       从 cards/*.json 生成静态站：index.html、cards/<id>.html（数据内嵌、零后端调用）、og/<id>.png（1200×630）
import {readFile,writeFile,mkdir,readdir,rm,rename} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {homedir} from 'node:os';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {publicCardData,validateCardData,renderStaticCard,renderIndex,renderLongImageHtml,renderOgHtml,translationVersion} from '../lib/export.mjs';
import {statSync} from 'node:fs';
export const MAX_CARD_BYTES=256*1024;
const readCard=async p=>{if(statSync(p).size>MAX_CARD_BYTES)throw new Error(`${p} 超过 ${MAX_CARD_BYTES/1024}KB，拒绝读取`);return readJson(p);};
import {htmlToPng} from '../lib/screenshot.mjs';

function parse(argv){const o={_:[]};// --base-url 可覆盖 site.config.json（CI 用 configure-pages 的地址）
 for(let i=0;i<argv.length;i++){const a=argv[i];if(a.startsWith('--')){const k=a.slice(2);if(['force','no-og'].includes(k))o[k]=true;else o[k]=argv[++i];}else o._.push(a);}return o;}
const readJson=async p=>JSON.parse(await readFile(p,'utf8'));
async function rounds(file){if(!existsSync(file))throw new Error(`找不到数据文件 ${file}`);return readJson(file);}
async function loadCard(ref,o){
 if(ref.endsWith('.json'))return validateCardData(await readCard(ref));
 const all=await rounds(o.data||'.data/rounds.json');
 const r=all[ref]||Object.values(all).find(x=>x.id.startsWith(ref));
 if(!r)throw new Error(`找不到辩论 ${ref}`);
 return publicCardData(r);
}
export async function snapshot(ids,o={}){
 const all=await rounds(o.data||'.data/rounds.json'),out=o.out||'cards';await mkdir(out,{recursive:true});const done=[];
 for(const id of ids){const r=all[id]||Object.values(all).find(x=>x.id.startsWith(id));if(!r)throw new Error(`找不到辩论 ${id}`);
  if(!r.published&&!o.force)throw new Error(`${r.id} 还没在控制台「发布」（=人工审过），拒绝导出；确认无误可加 --force`);
  const d=publicCardData(r);const f=path.join(out,`${d.id}.json`);
  // 保留已有译文：translations 由人工补，不进版本哈希。
  // 译文只在仍对应当前版本时保留；原文变了就丢弃旧译文并提示重新翻译审核。
  if(existsSync(f)){const old=await readJson(f);const keep={},dropped=[];for(const [l,t] of Object.entries(old.translations||{}))(t?.sourceVersion===d.version?(keep[l]=t):dropped.push(l));
   if(Object.keys(keep).length)d.translations=keep;if(dropped.length)console.warn(`注意：${d.short} 原文已变（新版本 ${d.version}），丢弃过期译文 ${dropped.join(',')}，请重新翻译并审核`);}
  await writeFile(f,JSON.stringify(d,null,1)+'\n');done.push(f);}
 return done;
}
export async function image(refs,o={}){
 const out=o.out||'exports';await mkdir(out,{recursive:true});const done=[];
 for(const ref of refs){const d=await loadCard(ref,o);const {png,height}=await htmlToPng(renderLongImageHtml(d,{lang:o.lang}),{width:1080,height:1200,fullPage:true});
  const f=path.join(out,`${d.short}-${o.lang||d.lang}-long.png`);await writeFile(f,png);done.push({file:f,width:1080,height});}
 return done;
}
export async function site(o={}){
 const dir=o.cards||'cards',out=path.resolve(o.out||'_site');
 // 防误删：输出目录会被整体替换，不能是根目录、家目录、仓库根或卡片源目录。
 const forbidden=[path.parse(out).root,homedir(),process.cwd(),path.resolve(dir)];
 if(forbidden.includes(out)||path.resolve(dir).startsWith(out+path.sep))throw new Error(`拒绝把 ${out} 当输出目录（会被整体替换）`);
 const cfg=existsSync(o.config||'site.config.json')?await readJson(o.config||'site.config.json'):{};
 const baseUrl=o['base-url']??cfg.baseUrl??'';
 if(baseUrl&&!/^https:\/\/[^/]+(\/.*)?\/$/.test(baseUrl))throw new Error('baseUrl 必须是以 / 结尾的 https 地址，例如 https://user.github.io/agent-argue/');
 const files=(await readdir(dir)).filter(f=>f.endsWith('.json')).sort();
 const cards=[];for(const f of files)cards.push(validateCardData(await readCard(path.join(dir,f))));
 cards.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
 // 先在临时目录完整生成，成功后整体替换：撤下的卡不会残留旧页面/旧 OG 图。
 const tmp=`${out}.building-${process.pid}`;await rm(tmp,{recursive:true,force:true});
 const inside=f=>{const r=path.resolve(tmp,f);if(!r.startsWith(tmp+path.sep))throw new Error(`输出路径越界：${f}`);return r;};
 try{
  await mkdir(path.join(tmp,'cards'),{recursive:true});await mkdir(path.join(tmp,'og'),{recursive:true});const pages=[];
  for(const d of cards){
   const langs=[d.lang,...Object.keys(d.translations||{}).filter(l=>l!==d.lang)];
   for(const lang of langs){
    const suffix=lang===d.lang?'':`.${lang}`,name=`${d.id}${suffix}.html`;
    let og=null;
    if(!o['no-og']){const ogName=`${d.id}${suffix}.png`;const {png}=await htmlToPng(renderOgHtml(d,{lang}),{width:1200,height:630});await writeFile(inside(`og/${ogName}`),png);og=`og/${ogName}`;}
    const other=langs.find(l=>l!==lang);
    const html=renderStaticCard(d,{lang,baseUrl,path:`cards/${name}`,ogImage:og?(baseUrl?og:`../${og}`):'',indexHref:'../index.html',giscus:cfg.giscus?.enabled?cfg.giscus:null,
     altHref:other?(other===d.lang?`${d.id}.html`:`${d.id}.${other}.html`):'',altLabel:other==='en'?'English':other==='zh'?'中文':'',sourcesHref:cfg.sourcesByCard?.[d.id]||''});
    await writeFile(inside(`cards/${name}`),html);pages.push(path.join(out,'cards',name));
   }
  }
  await writeFile(inside('index.html'),renderIndex(cards,{lang:cfg.lang||'zh'}));
  await writeFile(inside('.nojekyll'),'');
  // 切换：旧目录先改名备份，新目录改名到位后再删备份；改名失败时恢复旧站点。
  const old=`${out}.old-${process.pid}`;await rm(old,{recursive:true,force:true});
  const had=existsSync(out);if(had)await rename(out,old);
  try{await rename(tmp,out);}catch(e){if(had)await rename(old,out);throw e;}
  if(had)await rm(old,{recursive:true,force:true});
  return {cards:cards.length,pages,out};
 }catch(e){await rm(tmp,{recursive:true,force:true});throw e;}
}
// 人工审核译文后盖章：把 sourceVersion 绑到当前卡片版本，并重算译文自身版本。
export async function stamp(files){const done=[];for(const f of files){const d=validateCardData(await readCard(f),{restamp:true});validateCardData(d);await writeFile(f,JSON.stringify(d,null,1)+'\n');done.push(f);}return done;}
async function main(){
 const [cmd,...rest]=process.argv.slice(2);const o=parse(rest);
 if(cmd==='snapshot'){if(!o._.length)throw new Error('用法：snapshot <roundId...>');for(const f of await snapshot(o._,o))console.log('写入',f);}
 else if(cmd==='image'){if(!o._.length)throw new Error('用法：image <roundId|cards/x.json...>');for(const r of await image(o._,o))console.log('长图',r.file,`${r.width}×${r.height}`);}
 else if(cmd==='stamp'){if(!o._.length)throw new Error('用法：stamp cards/<id>.json…（人工审核译文后执行）');for(const f of await stamp(o._))console.log('已盖章',f);}
 else if(cmd==='site'){const r=await site(o);console.log(`静态站：${r.cards} 张卡，${r.pages.length} 个卡片页 → ${r.out}/`);}
 else{console.log('用法：node scripts/export-cards.mjs snapshot|image|site …（详见文件头注释）');process.exitCode=cmd?1:0;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error('导出失败：',e.message);process.exit(1);});
