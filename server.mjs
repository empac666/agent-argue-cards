#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DebateStore,DebateEngine} from './lib/debate.mjs';
import {listAgents,invoke} from './lib/providers.mjs';
import {DEFAULT_MIN_CYCLES} from './lib/argue.mjs';
import {publicCardData,renderStaticCard,renderLongImageHtml} from './lib/export.mjs';
import {htmlToPng} from './lib/screenshot.mjs';
import {demoAgents,demoInvoke,demoDataPath} from './lib/demo.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const assets={'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/app.js':'app.js'};
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function send(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(payload));}
async function body(req){if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))fail('需要 JSON 请求',415);let n=0,b=[];for await(const c of req){n+=c.length;if(n>32768)fail('请求内容过大',413);b.push(c);}try{return JSON.parse(Buffer.concat(b).toString('utf8'));}catch{fail('JSON 格式错误');}}
function requireObject(o){if(!o||typeof o!=='object'||Array.isArray(o))fail('请求必须为对象');}
// 控制台（生成、启停、历史、原始记录、导出）只信任「真正的本机直连」：
// 1) TCP 对端必须是回环地址；2) Host 必须是 127.0.0.1/localhost:端口；3) 不能带任何代理/隧道转发头。
// 只看 Host 不够：本机上的 nginx/cloudflared/ssh -R 可以把公网请求改写成 Host: localhost 再从 127.0.0.1 转进来。
// 第 3 条只是兜底（裸 proxy_pass 不一定加转发头），所以本服务一律不要挂到任何代理或隧道后面；
// 公开分享请单独运行 share-server.mjs（只读卡片 + 站队，不含任何生成代码）。
const LOOPBACK=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
export const PROXY_HEADERS=['forwarded','x-forwarded-for','x-forwarded-host','x-forwarded-proto','x-forwarded-port','x-real-ip','x-original-host','cf-connecting-ip','cf-ray','cf-visitor','true-client-ip','fly-client-ip','x-vercel-forwarded-for','via'];
export function localOnlyProblem(req,port){
 if(!LOOPBACK.has(req.socket.remoteAddress))return '仅允许本机回环地址访问';
 const host=(req.headers.host||'').toLowerCase();if(host!==`127.0.0.1:${port}`&&host!==`localhost:${port}`)return '仅允许本机访问';
 const h=PROXY_HEADERS.find(k=>req.headers[k]!==undefined);if(h)return `检测到代理/隧道转发头 ${h}：控制台禁止经代理访问，公开分享请用 share-server.mjs`;
 return '';
}
function cookie(req,name){for(const part of String(req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i>0&&part.slice(0,i).trim()===name){try{return decodeURIComponent(part.slice(i+1).trim());}catch{return '';}}}return '';}
// 匿名站队身份：随机 Cookie，只按卡去重；不是实名，也不能当「独立人数」。
function voterKey(req,res,cardId){let v=cookie(req,'aa_voter');if(!/^[a-f0-9-]{36}$/.test(v)){v=randomUUID();res.setHeader('Set-Cookie',`aa_voter=${v}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);}return createHash('sha256').update(cardId+':'+v).digest('hex').slice(0,24);}
function publicCard(r,key){const mine=r.sideVoters?.[key]||null;const speeches=r.messages.filter(m=>m.kind==='argument'&&m.status==='completed'&&m.meta?.ref).map(m=>({ref:m.meta.ref,side:m.meta.side,beat:m.meta.beat,claim:m.meta.claim,rebuttal:m.meta.rebuttal,content:m.content,bottomLine:m.meta.bottomLine}));
 const {rejected,...card}=r.card;return {id:r.id,topic:r.topic,card,speeches,mySide:mine,tally:mine?r.sides:null};}
export function createApp({demo=false,dataPath=demo?demoDataPath():(process.env.ARGUE_DATA||path.join(root,'.data','rounds.json')),providerInvoke=demo?demoInvoke:invoke,providerList=demo?demoAgents:listAgents}={}){
 const store=new DebateStore(dataPath),engine=new DebateEngine(store,providerInvoke);
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
   const port=server.address()?.port;const problem=localOnlyProblem(req,port);if(problem)fail(problem,403);
   if(req.headers.origin&&![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(req.headers.origin))fail('跨站请求被拒绝',403);
   const url=new URL(req.url,`http://127.0.0.1:${port}`),route=url.pathname;
   const cardPage=route.match(/^\/card\/([a-f0-9-]+)$/);if(req.method==='GET'&&cardPage){const data=await readFile(path.join(root,'public','card.html'));res.writeHead(200,{'Content-Type':types['.html'],'Cache-Control':'no-cache'});return res.end(data);}
   const cardApi=route.match(/^\/api\/cards\/([a-f0-9-]+)(\/side)?$/);
   if(cardApi){const r=store.rounds[cardApi[1]];if(!r||r.mode!=='card'||!r.card||!r.published)fail('卡片不存在或尚未发布',404);const key=voterKey(req,res,r.id);
    if(req.method==='GET'&&!cardApi[2])return send(res,200,publicCard(r,key));
    if(req.method==='POST'&&cardApi[2]){const b=await body(req);requireObject(b);if(!['A','B','unsure'].includes(b.side))fail('side 只能是 A、B 或 unsure');const prev=r.sideVoters[key];if(prev!==b.side){if(prev)r.sides[prev]=Math.max(0,(r.sides[prev]||0)-1);r.sides[b.side]=(r.sides[b.side]||0)+1;r.sideVoters[key]=b.side;store.save();}return send(res,200,publicCard(r,key));}
    fail('接口不存在',404);}
   if(req.method==='GET'&&route==='/api/health')return send(res,200,{ok:true,demo});
   const exp=route.match(/^\/api\/rounds\/([a-f0-9-]+)\/export\/(long\.png|card\.html|card\.json)$/);
   if(req.method==='GET'&&exp){const r=store.get(exp[1]);if(r.mode!=='card'||!r.card)fail('只有已出卡的站队卡可以导出');if(!r.published)fail('请先在控制台审核并「发布」后再导出',409);const d=publicCardData(r),name=`card-${d.short}`;
    if(exp[2]==='card.json'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="${d.id}.json"`,'Cache-Control':'no-store'});return res.end(JSON.stringify(d,null,1)+'\n');}
    if(exp[2]==='card.html'){res.writeHead(200,{'Content-Type':types['.html'],'Content-Disposition':`attachment; filename="${name}.html"`,'Cache-Control':'no-store'});return res.end(renderStaticCard(d));}
    const {png}=await htmlToPng(renderLongImageHtml(d,{lang:url.searchParams.get('lang')==='en'?'en':undefined}),{width:1080,height:1200,fullPage:true});res.writeHead(200,{'Content-Type':'image/png','Content-Disposition':`attachment; filename="${name}-long.png"`,'Cache-Control':'no-store'});return res.end(png);}
   if(req.method==='GET'&&route==='/api/agents')return send(res,200,{agents:await providerList()});
   if(req.method==='GET'&&route==='/api/rounds')return send(res,200,{rounds:store.list()});
   if(req.method==='POST'&&route==='/api/rounds'){const b=await body(req);requireObject(b);const topic=String(b.topic||'').trim(),agents=b.agents,maxCycles=Number(b.maxCycles);if(!topic||topic.length>2000)fail('辩题长度需为 1–2000 字');if(!Array.isArray(agents)||agents.length<2||agents.length>8||new Set(agents).size!==agents.length||agents.some(a=>typeof a!=='string'))fail('请选择 2–8 个不同的 Agent');const available=await providerList();if(agents.some(a=>!available.find(p=>p.id===a&&p.available)))fail('选中的 Agent 未配置或不可用');
    const mode=b.mode===undefined?(demo?'card':'argue'):b.mode;if(!['argue','classic','card'].includes(mode))fail('mode 只能是 argue、classic 或 card');if(demo&&mode!=='card')fail('演示模式只支持「站队卡」模式（预设台词，不调用模型）');
    if(mode!=='card'&&(!Number.isInteger(maxCycles)||maxCycles<1||maxCycles>20))fail('轮数需为 1–20');
    if(mode==='classic')return send(res,201,{round:store.create({topic,agents,maxCycles})});
    if(mode==='card'){if(agents.length!==2)fail('站队卡固定 2 位辩手');if(topic.length>200)fail('站队卡辩题需 ≤200 字');
     const editor=b.judge===undefined?(['agy-claude',...available.map(p=>p.id)].find(id=>!agents.includes(id)&&available.find(p=>p.id===id&&p.available))):b.judge;
     if(typeof editor!=='string'||!editor)fail('没有可用的独立编辑 Agent');if(agents.includes(editor))fail('编辑不能同时是辩手');if(!available.find(p=>p.id===editor&&p.available))fail('编辑 Agent 未配置或不可用');
     if(b.stances!==undefined&&(!Array.isArray(b.stances)||b.stances.length>2||b.stances.some(x=>typeof x!=='string'||x.length>300)))fail('stances 需为 ≤2 项、每项 ≤300 字的字符串数组');
     if(b.facts!==undefined&&(typeof b.facts!=='string'||b.facts.length>600))fail('facts 需为 ≤600 字的字符串');
     return send(res,201,{round:store.create({topic,agents,maxCycles:3,mode,judge:editor,stances:b.stances||null,facts:b.facts||''})});}
    const minCycles=b.minCycles===undefined?DEFAULT_MIN_CYCLES:Number(b.minCycles);if(!Number.isInteger(minCycles)||minCycles<0||minCycles>5)fail('强制交锋轮数需为 0–5');if(maxCycles<=minCycles)fail(`最多轮数必须大于强制交锋轮数（${minCycles}）`);
    // 裁判必须是不参与辩论的另一个可用 Agent；默认优先 AGY·Claude（与辩手异构）。
    const judge=b.judge===undefined?(['agy-claude',...available.map(p=>p.id)].find(id=>!agents.includes(id)&&available.find(p=>p.id===id&&p.available))):b.judge;
    if(typeof judge!=='string'||!judge)fail('没有可用的独立裁判 Agent');if(agents.includes(judge))fail('裁判不能同时是辩手');if(!available.find(p=>p.id===judge&&p.available))fail('裁判 Agent 未配置或不可用');
    let stances=null;if(b.stances!==undefined){if(!Array.isArray(b.stances)||b.stances.length>agents.length||b.stances.some(x=>typeof x!=='string'||x.length>300))fail('stances 需为与辩手对应的字符串数组，每项 ≤300 字');stances=b.stances;}
    return send(res,201,{round:store.create({topic,agents,maxCycles,mode,judge,stances,minCycles})});}
   const match=route.match(/^\/api\/rounds\/([a-f0-9-]+)(?:\/(start|stop|resume|vote|publish))?$/);
   if(match){const [,id,action]=match,r=store.get(id);if(req.method==='GET'&&!action)return send(res,200,{round:r});if(req.method==='POST'&&action){const b=await body(req);requireObject(b);if(action==='start'||action==='resume')return send(res,202,{round:engine.start(id)});if(action==='stop')return send(res,200,{round:engine.stop(id)});if(action==='publish'){if(r.mode!=='card'||!r.card)fail('只有已生成的站队卡可以发布',409);r.published=b.published!==false;store.save();return send(res,200,{round:r});}if(action==='vote'){if(typeof b.agentId!=='string'||!r.agents.includes(b.agentId))fail('投票对象不在本局');r.votes[b.agentId]=(r.votes[b.agentId]||0)+1;store.save();return send(res,200,{round:r});}}}
   if(req.method==='GET'&&assets[route]){const file=assets[route],data=await readFile(path.join(root,'public',file));res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-cache'});return res.end(data);}
   fail('接口或页面不存在',404);
  }catch(e){send(res,e.status||500,{error:String(e.message||e)});}
 });
 return {server,store,engine};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const demo=process.argv.includes('--demo')||process.env.ARGUE_DEMO==='1';
 if(process.env.ARGUE_SHARE_HOSTS)console.warn('注意：ARGUE_SHARE_HOSTS 已从控制台服务移除（控制台只允许本机直连）。公开分享请运行 node share-server.mjs。');
 const {server,store}=createApp({demo});
 server.listen(Number(process.env.PORT||4321),'127.0.0.1',()=>console.log(`Agent Argue${demo?' 演示模式（预录数据 + 预设台词，不调用任何模型；数据在 '+store.file+'）':''} http://127.0.0.1:${server.address().port}`));
}
