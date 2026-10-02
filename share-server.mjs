#!/usr/bin/env node
// 公开只读分享服务：只提供「已审核卡片」的页面、OG 图和匿名站队，不导入任何生成/调度/模型代码。
// 数据来源是 cards/*.json（scripts/export-cards.mjs snapshot 导出、人工审过的公开数据），站队票存单独文件。
// 用法：node share-server.mjs [--cards cards] [--og _site/og] [--votes .data/share-votes.json] [--host 127.0.0.1] [--port 4322]
// 环境变量：ARGUE_SHARE_HOSTS（可选，Host 白名单，逗号分隔）；
//   ARGUE_TRUSTED_PROXIES（可选，反代/隧道连到本服务时的对端 IP，逗号分隔，如 127.0.0.1）：只有来自这些对端的请求才采信
//     ARGUE_TRUSTED_PROXY_HEADER 指定的一个头（默认 x-forwarded-for，Cloudflare 用 cf-connecting-ip；取最右一跳）来限流，并按 X-Forwarded-Proto=https 给 Cookie 加 Secure；
//   ARGUE_COOKIE_SECURE=1（直接 HTTPS 时强制 Secure）；ARGUE_PUBLIC_BASE_URL（如 https://cards.example.com/，用于 og:url / canonical / 绝对 og:image）。
import http from 'node:http';
import path from 'node:path';
import {readFileSync,readdirSync,statSync,existsSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {fileURLToPath} from 'node:url';
import {validateCardData,renderStaticCard,renderIndex} from './lib/export.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const ID=/^[a-f0-9-]{8,64}$/;
const MAX_VOTERS_PER_CARD=50000;
const SECURITY_HEADERS={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
 'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"};

export function createShareServer({cardsDir=path.join(root,'cards'),ogDir=path.join(root,'_site','og'),votesPath=path.join(root,'.data','share-votes.json'),
 shareHosts=String(process.env.ARGUE_SHARE_HOSTS||'').split(',').map(h=>h.trim().toLowerCase()).filter(Boolean),trustedProxies=String(process.env.ARGUE_TRUSTED_PROXIES||'').split(',').map(h=>h.trim()).filter(Boolean),proxyHeader=(process.env.ARGUE_TRUSTED_PROXY_HEADER||'x-forwarded-for').toLowerCase(),
 publicBaseUrl=process.env.ARGUE_PUBLIC_BASE_URL||'',
 cookieSecure=process.env.ARGUE_COOKIE_SECURE==='1',rate={perIp:20,global:600,windowMs:60000},now=()=>Date.now()}={}){
 // 卡片：按目录 mtime 懒加载，推送新卡后无需重启。
 let cache={stamp:'',cards:new Map()};
 function cards(){
  let stamp='';try{stamp=readdirSync(cardsDir).filter(f=>f.endsWith('.json')).map(f=>f+statSync(path.join(cardsDir,f)).mtimeMs).join('|');}catch{stamp='missing';}
  if(stamp!==cache.stamp){const m=new Map();if(stamp!=='missing')for(const f of readdirSync(cardsDir).filter(f=>f.endsWith('.json'))){try{if(statSync(path.join(cardsDir,f)).size>256*1024)throw new Error('文件超过 256KB');const d=validateCardData(JSON.parse(readFileSync(path.join(cardsDir,f),'utf8')));m.set(d.id,d);}catch(e){console.warn('跳过不合法卡片',f,e.message);}}cache={stamp,cards:m};}
  return cache.cards;
 }
 // 票：{cardId:{tally:{A,B,unsure},voters:{hash:side}}}，原子写入 + 合并写盘。
 let votes={};try{votes=JSON.parse(readFileSync(votesPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error(`站队数据损坏，拒绝启动以免覆盖：${votesPath}`);}
 const okVotes=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.entries(v).every(([k,c])=>ID.test(k)&&c&&typeof c==='object'&&['A','B','unsure'].every(x=>Number.isInteger(c.tally?.[x])&&c.tally[x]>=0)&&c.voters&&typeof c.voters==='object'&&Object.values(c.voters).every(x=>['A','B','unsure'].includes(x)));
 if(!okVotes(votes))throw new Error(`站队数据结构不对，拒绝启动以免覆盖：${votesPath}`);
 // 合并写盘（500ms），写失败不让定时器抛出导致进程退出：记下错误、稍后重试，期间新票返回 503。
 let dirty=null,persistError=null;
 let closed=false;
 const flush=()=>{dirty=null;try{mkdirSync(path.dirname(votesPath),{recursive:true});const tmp=votesPath+'.tmp';writeFileSync(tmp,JSON.stringify(votes));renameSync(tmp,votesPath);persistError=null;}catch(e){persistError=e;console.error('站队数据写盘失败，5 秒后重试：',e.message);if(!closed){dirty=setTimeout(flush,5000);dirty.unref?.();}}};
 const save=()=>{if(!dirty)dirty=setTimeout(flush,500);};
 // 限流：每 IP 和全局的固定窗口计数，只针对写操作。
 let win={start:now(),ip:new Map(),total:0};
 function limited(ip){const t=now();if(t-win.start>=rate.windowMs)win={start:t,ip:new Map(),total:0};const n=(win.ip.get(ip)||0)+1;win.ip.set(ip,n);win.total++;if(win.ip.size>20000)win.ip.clear();return n>rate.perIp||win.total>rate.global;}
 const viaTrusted=req=>trustedProxies.includes(String(req.socket.remoteAddress||'').replace(/^::ffff:/,''))||trustedProxies.includes(req.socket.remoteAddress);
 // 只有直连对端是已配置的可信代理时才看转发头；取 XFF 最右一跳（最近的代理写入的），且必须是合法 IP。
 // 只看配置的那一个头（默认 X-Forwarded-For；走 Cloudflare 时设 ARGUE_TRUSTED_PROXY_HEADER=cf-connecting-ip），不同时采信多个，避免代理没清洗的头被伪造。
 const clientIp=req=>{if(viaTrusted(req)){const v=String(req.headers[proxyHeader]||'').split(',').map(x=>x.trim()).filter(Boolean).at(-1)||'';if(isIP(v))return v;}return req.socket.remoteAddress||'?';};
 const secure=req=>cookieSecure||(viaTrusted(req)&&String(req.headers['x-forwarded-proto']||'').split(',')[0].trim()==='https');
 const cookie=(req,name)=>{for(const part of String(req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i>0&&part.slice(0,i).trim()===name){try{return decodeURIComponent(part.slice(i+1).trim());}catch{return '';}}}return '';};
 function voter(req,res,id){let v=cookie(req,'aa_voter');if(!/^[a-f0-9-]{36}$/.test(v)){v=randomUUID();res.setHeader('Set-Cookie',`aa_voter=${v}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure(req)?'; Secure':''}`);}return createHash('sha256').update(id+':'+v).digest('hex').slice(0,24);}
 const json=(res,status,o)=>{res.writeHead(status,{...SECURITY_HEADERS,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(o));};
 const html=(res,body)=>{res.writeHead(200,{...SECURITY_HEADERS,'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=60'});res.end(body);};
 const state=(id,key)=>{const v=votes[id];const mine=v?.voters?.[key]||null;return {mySide:mine,tally:mine?v.tally:null};};
 async function readBody(req){if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return null;let n=0,b=[];for await(const c of req){n+=c.length;if(n>1024)return null;b.push(c);}try{return JSON.parse(Buffer.concat(b).toString('utf8'));}catch{return null;}}
 const server=http.createServer(async(req,res)=>{
  try{
   const host=String(req.headers.host||'').toLowerCase();
   if(shareHosts.length&&!shareHosts.includes(host))return json(res,421,{error:'未知域名'});
   if(!['GET','HEAD','POST'].includes(req.method))return json(res,405,{error:'不支持的方法'});
   const route=new URL(req.url,'http://share.invalid').pathname;
   if(req.method!=='POST'){
    if(route==='/'||route==='/index.html')return html(res,renderIndex([...cards().values()].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),{hrefOf:(d,l)=>`/card/${d.id}${l===d.lang?'':'.'+l}`}));
    if(route==='/healthz')return json(res,200,{ok:true});
    const page=route.match(/^\/card\/([a-f0-9-]+)(?:\.(en|zh))?$/);
    if(page){const d=cards().get(page[1]);if(!d)return json(res,404,{error:'卡片不存在'});const lang=page[2]||d.lang;if(lang!==d.lang&&!d.translations?.[lang])return json(res,404,{error:'没有该语言版本'});
     const ogName=lang===d.lang?`${d.id}.png`:`${d.id}.${lang}.png`;const other=lang===d.lang?Object.keys(d.translations||{})[0]:d.lang;
     return html(res,renderStaticCard(d,{lang,voteEndpoint:`/api/cards/${d.id}/side`,indexHref:'/',baseUrl:publicBaseUrl,path:`card/${d.id}${lang===d.lang?'':'.'+lang}`,ogImage:existsSync(path.join(ogDir,ogName))?(publicBaseUrl?`og/${ogName}`:`/og/${ogName}`):'',
      altHref:other?(other===d.lang?`/card/${d.id}`:`/card/${d.id}.${other}`):'',altLabel:other==='en'?'English':other==='zh'?'中文':other||''}));}
    const og=route.match(/^\/og\/([a-f0-9-]+(?:\.(?:en|zh))?)\.png$/);
    if(og&&cards().has(og[1].split('.')[0])){const f=path.join(ogDir,og[1]+'.png');if(existsSync(f)){res.writeHead(200,{...SECURITY_HEADERS,'Content-Type':'image/png','Cache-Control':'public, max-age=3600'});return res.end(readFileSync(f));}}
   }
   const api=route.match(/^\/api\/cards\/([a-f0-9-]+)\/side$/);
   if(api){
    const d=cards().get(api[1]);if(!d||!ID.test(api[1]))return json(res,404,{error:'卡片不存在'});
    if(req.method==='POST'){
     // 跨站表单/脚本不能代人站队：有 Origin 时必须与 Host 一致。
     if(req.headers.origin&&![`https://${host}`,`http://${host}`].includes(req.headers.origin))return json(res,403,{error:'跨站请求被拒绝'});
     if(limited(clientIp(req)))return json(res,429,{error:'操作太频繁，稍后再试'});
     if(persistError)return json(res,503,{error:'暂时无法保存站队，请稍后再试'});
     const b=await readBody(req);if(!b||typeof b!=='object'||!['A','B','unsure'].includes(b.side))return json(res,400,{error:'side 只能是 A、B 或 unsure'});
     const key=voter(req,res,d.id);const v=votes[d.id]||(votes[d.id]={tally:{A:0,B:0,unsure:0},voters:{}});const prev=v.voters[key];
     if(!prev&&Object.keys(v.voters).length>=MAX_VOTERS_PER_CARD)return json(res,429,{error:'这张卡的站队已满'});
     if(prev!==b.side){if(prev)v.tally[prev]=Math.max(0,v.tally[prev]-1);v.tally[b.side]++;v.voters[key]=b.side;save();}
     return json(res,200,state(d.id,key));
    }
    return json(res,200,state(d.id,voter(req,res,d.id)));
   }
   return json(res,404,{error:'只开放卡片页'});
  }catch(e){json(res,500,{error:'服务器错误'});}
 });
 server.on('close',()=>{closed=true;if(dirty){clearTimeout(dirty);flush();}});
 return {server,flush:()=>{if(dirty){clearTimeout(dirty);flush();}},votes:()=>votes};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const a=process.argv.slice(2),opt=k=>{const i=a.indexOf('--'+k);return i>=0?a[i+1]:undefined;};
 const {server,flush}=createShareServer({...(opt('cards')&&{cardsDir:path.resolve(opt('cards'))}),...(opt('og')&&{ogDir:path.resolve(opt('og'))}),...(opt('votes')&&{votesPath:path.resolve(opt('votes'))})});
 const host=opt('host')||'127.0.0.1',port=Number(opt('port')||process.env.SHARE_PORT||4322);
 server.listen(port,host,()=>console.log(`Agent Argue 只读分享服务 http://${host}:${port}（只提供 cards/ 里已审核的卡片）`));
 for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{flush();process.exit(0);});
}
