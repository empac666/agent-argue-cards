import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {DebateStore,DebateEngine} from '../lib/debate.mjs';
import {verifyConcession,cardStances} from '../lib/card.mjs';
import {createApp} from '../server.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function settle(round,engine){for(let i=0;i<400;i++){if(!engine.jobs.has(round.id)&&round.status!=='running')return;await sleep(5);}throw Error('did not settle');}
const isEditor=p=>p.includes('你是独立编辑');
const beatOf=p=>Number(p.match(/当前第 (\d)\/3 拍/)?.[1]);
const sideOf=p=>p.match(/你是 ([AB]) 方辩手/)?.[1];
// 模拟辩手：A 坚持回家；B 第 3 拍明确承认 A1 的一个论点；每拍都写 AGREE 试图提前结束（应被忽略）。
const LINES={
 A:{1:{claim:'回家过年是父母一年里最大的盼头',argument:'老人一年就等这几天，视频替代不了一桌年夜饭。'},
    2:{claim:'8 天假期足够来回',rebuttal:'B 说路上太累，但高铁 6 小时不算远',argument:'提前抢票就行。'},
    3:{claim:'今年先回男方家',argument:'我承认机票确实贵了不少，但钱能省在别处。',concessions:['机票贵'],bottomLine:'年三十必须在父母身边'}},
 B:{1:{claim:'春运来回折腾把假期全耗在路上',argument:'8 天假路上就占掉 2 天，到家只剩应酬。'},
    2:{claim:'把父母接来上海更省事',rebuttal:'A 说父母盼头最大，但盼的是团聚不是地点',argument:'接来上海一样团聚。'},
    3:{claim:'今年不回，把父母接来',argument:'我承认回家过年是父母一年里最大的盼头，可团聚不一定非在老家。',concessions:['父母盼头'],bottomLine:'不能把整个假期都花在路上'}}};
const debater=(id,p)=>{const s=sideOf(p),b=beatOf(p);return JSON.stringify({...LINES[s][b],vote:'AGREE',version:'x'});};
const EDIT={sides:{A:{label:'恋家派',stance:'今年回老家'},B:{label:'省心派',stance:'把父母接来'}},
 concessions:[
  {by:'B',point:'B 承认回家是父母最大的盼头',opponentRef:'A1',opponentQuote:'回家过年是父母一年里最大的盼头',acceptRef:'B3',acceptQuote:'我承认回家过年是父母一年里最大的盼头'},
  {by:'A',point:'自己引自己',opponentRef:'A1',opponentQuote:'回家过年是父母一年里最大的盼头',acceptRef:'A3',acceptQuote:'我承认机票确实贵了不少'},
  {by:'A',point:'编造的原文',opponentRef:'B1',opponentQuote:'春运来回折腾把假期全耗在路上',acceptRef:'A3',acceptQuote:'我完全同意不回家'},
  {by:'A',point:'改了标点',opponentRef:'B1',opponentQuote:'春运来回，折腾把假期全耗在路上',acceptRef:'A3',acceptQuote:'我承认机票确实贵了不少'},
  {by:'B',point:'归错人',opponentRef:'A1',opponentQuote:'回家过年是父母一年里最大的盼头',acceptRef:'A3',acceptQuote:'我承认机票确实贵了不少'}],
 unresolved:{issue:'年三十该在老家还是在上海',quoteA:{ref:'A3',quote:'年三十必须在父母身边'},quoteB:{ref:'B3',quote:'不能把整个假期都花在路上'}}};
function fixture(invoke){const dir=mkdtempSync(path.join(tmpdir(),'card-')),store=new DebateStore(path.join(dir,'rounds.json')),calls=[],engine=new DebateEngine(store,async(id,p)=>{calls.push({id,p});return invoke(id,p,calls);});return {dir,store,engine,calls,done:()=>rmSync(dir,{recursive:true,force:true})};}
const create=(f,o={})=>f.store.create({topic:'春节回不回家过年？',agents:['a','b'],maxCycles:3,mode:'card',judge:'j',facts:'男方老家湖南',stances:['回家','不回'],...o});

test('card: fixed 2×3 beats + one editor call, AGREE never ends early, opening is blind, card always produced',async()=>{
 const f=fixture((id,p)=>isEditor(p)?JSON.stringify(EDIT):debater(id,p));
 try{const r=create(f);f.engine.start(r.id);await settle(r,f.engine);
  assert.equal(r.status,'card');assert.equal(f.calls.filter(c=>c.id!=='j').length,6);assert.equal(f.calls.filter(c=>c.id==='j').length,1);
  const b1=f.calls[1].p;assert.match(b1,/你是 B 方辩手/);assert.doesNotMatch(b1,/视频替代不了/,'B must not see A1 in the blind opening');
  for(const c of f.calls.filter(c=>c.id!=='j')){
   if(beatOf(c.p)===1)assert.doesNotMatch(c.p,/不要照抄对方的主张/);
   else assert.match(c.p,new RegExp(`你方（${sideOf(c.p)} 方）本拍的核心主张，用你自己的话，不要照抄对方的主张`));
   if(beatOf(c.p)===2)assert.match(c.p,/对方这句只是你要反驳的对象，不能当成你的 claim/);
  }
  assert.match(f.calls[2].p,/必须正面反驳对方 B1 的核心主张：「春运来回折腾把假期全耗在路上」/);
  assert.deepEqual(r.messages.filter(m=>m.kind==='argument').map(m=>m.meta.ref),['A1','B1','A2','B2','A3','B3']);
  assert.equal(r.card.complete,true);assert.equal(r.card.concessions.length,1);assert.equal(r.card.concessions[0].by,'B');
  assert.equal(r.card.rejected.length,4);assert.equal(r.card.unresolved.issue,'年三十该在老家还是在上海');assert.equal(r.card.unresolved.quotes.length,2);
  assert.equal(r.card.sides[0].label,'恋家派');assert.equal(r.card.sides[1].bottomLine,'不能把整个假期都花在路上');
  assert.equal(r.proposal,null);assert.deepEqual(r.assents,{});
  assert.throws(()=>f.engine.start(r.id),/不能续轮/);
 }finally{f.done();}
});

test('card: concession verification rejects self-quotes, fabricated / re-punctuated / misattributed quotes and wrong order',()=>{
 const f=fixture(()=>'');try{const r=create(f);
  const add=(agent,ref,side,beat,content,meta={})=>{const m=f.store.message(r,agent,'argument',content);m.meta={ref,side,beat,...meta};return m;};
  add('a','A1','A',1,'老人一年就等这几天',{claim:'回家过年是父母一年里最大的盼头'});
  add('b','B1','B',1,'路上太折腾',{claim:'春运来回折腾把假期全耗在路上'});
  add('b','B3','B',3,'我承认回家过年是父母一年里最大的盼头，可是',{claim:'不回'});
  const ok={by:'B',opponentRef:'A1',opponentQuote:'回家过年是父母一年里最大的盼头',acceptRef:'B3',acceptQuote:'我承认回家过年是父母一年里最大的盼头'};
  assert.equal(verifyConcession(r,ok).ok,true);
  assert.match(verifyConcession(r,{...ok,by:'A'}).why,/出自本方|不是让步方/);
  assert.match(verifyConcession(r,{...ok,opponentQuote:'回家过年，是父母一年里最大的盼头'}).why,/找不到/);
  assert.match(verifyConcession(r,{...ok,opponentRef:'B1'}).why,/找不到/);
  assert.match(verifyConcession(r,{...ok,opponentRef:'B3',opponentQuote:'我承认回家过年是父母一年'}).why,/出自本方/);
  assert.match(verifyConcession(r,{...ok,acceptQuote:'老人一年就等这几天'}).why,/找不到/,'cross-message quote must not match');
  assert.match(verifyConcession(r,{...ok,opponentQuote:'盼头'}).why,/过短/);
  const late=add('a','A2','A',2,'后来才说的话 abcdefg',{claim:'x'});
  assert.match(verifyConcession(r,{...ok,opponentRef:'A2',opponentQuote:'后来才说的话 abcdefg'}).why,/之前/);void late;
 }finally{f.done();}
});

test('card: editor returns garbage → card still produced, honestly marked incomplete and unconfirmed',async()=>{
 const f=fixture((id,p)=>isEditor(p)?'抱歉我不能':debater(id,p));
 try{const r=create(f);f.engine.start(r.id);await settle(r,f.engine);
  assert.equal(r.status,'card');assert.equal(r.card.complete,false);assert.equal(r.card.editorOk,false);assert.equal(r.card.unresolvedConfirmed,false);
  assert.equal(r.card.concessions.length,0);assert.equal(r.card.concessionNote,'未发现可核验的明确让步');assert.match(r.card.issues.join(),/编辑/);
  assert.equal(r.card.sides[0].finalClaim,'今年先回男方家');
 }finally{f.done();}
});

test('card: a debater failure mid-way still yields an incomplete card and no editor call',async()=>{
 const f=fixture((id,p)=>{if(isEditor(p))return JSON.stringify(EDIT);if(beatOf(p)===2&&sideOf(p)==='B')throw new Error('402 余额耗尽');return debater(id,p);});
 try{const r=create(f);f.engine.start(r.id);await settle(r,f.engine);
  assert.equal(r.status,'card');assert.equal(r.card.complete,false);assert.match(r.card.issues.join(),/402/);assert.match(r.card.issues.join(),/3\/6/);
  assert.equal(f.calls.filter(c=>c.id==='j').length,0);
 }finally{f.done();}
});

test('card: missing required fields are flagged, not silently accepted; unresolved:null means no remaining dispute',async()=>{
 const f=fixture((id,p)=>isEditor(p)?JSON.stringify({...EDIT,concessions:[],unresolved:null}):(beatOf(p)===3?JSON.stringify({argument:'就这样'}):debater(id,p)));
 try{const r=create(f);f.engine.start(r.id);await settle(r,f.engine);
  assert.equal(r.card.complete,false);assert.match(r.card.issues.join(),/A3 缺少字段：claim、bottomLine/);
  assert.equal(r.card.unresolved,null);assert.equal(r.card.unresolvedConfirmed,true);
 }finally{f.done();}
});

test('card: pause stops before the next call; resume continues to a card',async()=>{
 let release;const gate=new Promise(r=>release=r);
 const f=fixture(async(id,p)=>{if(isEditor(p))return JSON.stringify(EDIT);if(beatOf(p)===1&&sideOf(p)==='A')await gate;return debater(id,p);});
 try{const r=create(f);f.engine.start(r.id);await sleep(10);f.engine.stop(r.id);release();await settle(r,f.engine);
  assert.equal(r.status,'paused');assert.equal(f.calls.length,1);
  f.engine.start(r.id);await settle(r,f.engine);assert.equal(r.status,'card');assert.equal(f.calls.filter(c=>c.id!=='j').length,6);
 }finally{f.done();}
});

test('card stances: explicit stances win; binary topics split; otherwise 正方/反方',()=>{
 assert.deepEqual(cardStances('x',['回','不回']),['回','不回']);
 assert.deepEqual(cardStances('猫 还是 狗？'),['主张「猫」','主张「狗」']);
 assert.match(cardStances('春节回不回家？')[0],/正方/);
});

test('store: missing file starts empty; corrupt file refuses to start and is left untouched',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'store-'));
 try{const ok=new DebateStore(path.join(dir,'new.json'));assert.deepEqual(ok.rounds,{});
  const bad=path.join(dir,'bad.json');writeFileSync(bad,'{"half":');
  assert.throws(()=>new DebateStore(bad),/不是合法 JSON/);assert.equal(readFileSync(bad,'utf8'),'{"half":');
  writeFileSync(bad,'[]');assert.throws(()=>new DebateStore(bad),/格式不对/);assert.equal(readFileSync(bad,'utf8'),'[]');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('server: card creation, publish gate, cookie-deduped side votes, console is local-direct only',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'card-server-'));
 const providerList=async()=>['agy','grok','agy-claude'].map(id=>({id,name:id,available:true}));
 const invoke=async(id,p)=>isEditor(p)?JSON.stringify({...EDIT,sides:{A:{label:'<img src=x onerror=alert(1)>',stance:'s'},B:{label:'b',stance:'s'}}}):debater(id,p);
 const prevHosts=process.env.ARGUE_SHARE_HOSTS;process.env.ARGUE_SHARE_HOSTS='card.example.test';// 旧变量设置了也不应再开放任何东西
 const {server,engine,store}=createApp({dataPath:path.join(dir,'r.json'),providerInvoke:invoke,providerList});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 // fetch 不允许改 Host，公开模式的断言用 node:http 发请求。
 const raw=(m,u,b,h={})=>new Promise((resolve,reject)=>{const q=http.request(base+u,{method:m,headers:{...(b?{'content-type':'application/json'}:{}),...h}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve({status:res.statusCode}));});q.on('error',reject);q.end(b?JSON.stringify(b):undefined);});
 const req=(m,u,b,h={})=>fetch(base+u,{method:m,headers:{...(b?{'content-type':'application/json'}:{}),...h},body:b?JSON.stringify(b):undefined}).then(async r=>({status:r.status,headers:r.headers,body:await r.json().catch(()=>null)}));
 try{
  assert.equal((await req('POST','/api/rounds',{mode:'card',topic:'t',agents:['agy','grok','agy-claude'],maxCycles:3})).status,400);
  const c=await req('POST','/api/rounds',{mode:'card',topic:'春节回不回家过年？',agents:['agy','grok'],maxCycles:3,facts:'背景',stances:['回','不回']});
  assert.equal(c.status,201);const r=c.body.round;assert.equal(r.mode,'card');assert.equal(r.judge,'agy-claude');assert.equal(r.stances.agy,'回');
  assert.equal((await req('POST',`/api/rounds/${r.id}/publish`,{})).status,409,'cannot publish before the card exists');
  await req('POST',`/api/rounds/${r.id}/start`,{});await settle(store.get(r.id),engine);
  assert.equal(store.get(r.id).status,'card');
  assert.equal((await req('GET',`/api/cards/${r.id}`)).status,404,'unpublished card is not readable');
  assert.equal((await req('POST',`/api/rounds/${r.id}/publish`,{})).status,200);
  const g=await req('GET',`/api/cards/${r.id}`);assert.equal(g.status,200);assert.equal(g.body.tally,null,'tally hidden until you vote');
  assert.equal(g.body.card.sides[0].label,'<img src','label is length-capped and returned as plain data');assert.equal(g.body.card.rejected,undefined);assert.equal(g.body.speeches.length,6);
  const cookie=g.headers.get('set-cookie').split(';')[0];
  const v1=await req('POST',`/api/cards/${r.id}/side`,{side:'A'},{cookie});const v2=await req('POST',`/api/cards/${r.id}/side`,{side:'A'},{cookie});
  assert.deepEqual(v2.body.tally,{A:1,B:0,unsure:0});assert.equal(v1.body.mySide,'A');
  const v3=await req('POST',`/api/cards/${r.id}/side`,{side:'B'},{cookie});assert.deepEqual(v3.body.tally,{A:0,B:1,unsure:0},'changing side moves the vote');
  const other=await req('POST',`/api/cards/${r.id}/side`,{side:'unsure'});assert.deepEqual(other.body.tally,{A:0,B:1,unsure:1});
  assert.equal((await req('POST',`/api/cards/${r.id}/side`,{side:'C'},{cookie})).status,400);
  // 控制台服务只认本机直连：任何外部 Host（即使设置了旧的 ARGUE_SHARE_HOSTS）一律 403；公开分享改由 share-server.mjs 承担。
  const shared={host:'card.example.test'};
  for(const [m,u] of [['GET','/api/rounds'],['GET',`/api/rounds/${r.id}`],['GET',`/api/cards/${r.id}`],['GET',`/card/${r.id}`]])assert.equal((await raw(m,u,null,shared)).status,403,`${u} via foreign host`);
  assert.equal((await raw('POST','/api/rounds',{mode:'card'},shared)).status,403);
  // 本机代理/隧道把 Host 改写成 localhost 也不行：带转发头即拒绝。
  const local={host:`127.0.0.1:${server.address().port}`};
  for(const h of ['x-forwarded-for','cf-connecting-ip','forwarded','x-real-ip','via'])assert.equal((await raw('GET','/api/rounds',null,{...local,[h]:'1.2.3.4'})).status,403,`proxy header ${h}`);
  assert.equal((await raw('GET','/api/rounds',null,local)).status,200,'plain local request still works');
  const html=readFileSync(new URL('../public/card.html',import.meta.url),'utf8');assert.doesNotMatch(html,/innerHTML/,'share page renders model text via textContent only');
 }finally{server.close();if(prevHosts===undefined)delete process.env.ARGUE_SHARE_HOSTS;else process.env.ARGUE_SHARE_HOSTS=prevHosts;rmSync(dir,{recursive:true,force:true});}
});
