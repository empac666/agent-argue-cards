import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {publicCardData,validateCardData,renderStaticCard,renderLongImageHtml,renderOgHtml,cardVersion,translationVersion} from '../lib/export.mjs';
import {buildCard} from '../lib/card.mjs';
import {_slots} from '../lib/screenshot.mjs';
// 与 stamp 同一路径：restamp 规范化并重算译文版本。
const tr=(d,t)=>validateCardData({...d,translations:{en:{...t}}},{restamp:true});
import {findChrome,htmlToPng} from '../lib/screenshot.mjs';
import {createShareServer} from '../share-server.mjs';
import {createApp} from '../server.mjs';
import {site} from '../scripts/export-cards.mjs';

const demo=JSON.parse(readFileSync(new URL('../demo/rounds.json',import.meta.url),'utf8'));
const realRound=()=>structuredClone(Object.values(demo)[0]);
const wait=async(fn,ms=5000)=>{const t=Date.now();while(!fn()){if(Date.now()-t>ms)throw new Error('timeout');await new Promise(r=>setTimeout(r,20));}};
const pngSize=b=>({w:b.readUInt32BE(16),h:b.readUInt32BE(20)});

test('publicCardData exports a whitelist only and is version-stamped',()=>{
 const r=realRound();r.sideVoters={secret:'A'};r.card.rejected=[{why:'x'}];r.timing={totalMs:1};
 const d=publicCardData(r),s=JSON.stringify(d);
 for(const leak of ['sideVoters','rejected','timing','secret','editorOk','"assents"','"votes"'])assert.ok(!s.includes(leak),leak);
 assert.equal(d.card.sides.length,2);assert.equal(d.speeches.length,6);assert.equal(d.version,cardVersion(d));
 assert.doesNotThrow(()=>validateCardData(d));
 assert.throws(()=>validateCardData({...d,topic:d.topic+'改'}),/version/,'edited content must be re-versioned');
 assert.equal(validateCardData(tr(d,{topic:'x'})).translations.en.topic,'x','translations are outside the card hash but bound to it');
 const warns=[];const stale=validateCardData({...d,translations:{en:{sourceVersion:'000000000000',topic:'x'}}},{onWarn:m=>warns.push(m)});
 assert.equal(stale.translations,undefined,'stale translation is dropped');assert.equal(stale.topic,d.topic,'original card survives');assert.match(warns[0],/旧版本/);
 {const once=validateCardData(tr(d,{topic:'only topic'}));const html=renderStaticCard(once,{lang:'en'});const embedded=JSON.parse(html.match(/<script type="application\/json" id="card-data">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(validateCardData(embedded),once,'validate → embed → re-validate is stable');}
 const edited=tr(d,{topic:'Go home'});edited.translations.en.topic='Never go home';assert.throws(()=>validateCardData(edited),/stamp/,'editing a translation without re-stamping is rejected');
 assert.throws(()=>validateCardData({...d,translations:{'../../../escaped':{sourceVersion:d.version}}}),/语言键/,'path-like language key rejected');
 assert.throws(()=>validateCardData({...d,translations:{en:{sourceVersion:d.version,privateNote:'SECRET'}}}),/未知字段/,'unknown translation field rejected');
 assert.throws(()=>validateCardData({...d,internal:'x'}),/未知字段/);
 const sneaky=structuredClone(d);sneaky.card.sides[0].reviewerNote='x';assert.throws(()=>validateCardData(sneaky),/未知字段/);
 const noProv=structuredClone(d);delete noProv.provenance;noProv.version=cardVersion(noProv);assert.throws(()=>validateCardData(noProv),/provenance/,'structurally broken card fails validation, not rendering');
 assert.throws(()=>validateCardData({...d,lang:'../x'}),/lang/);
 // 生成器的真实失败产物（编辑失败 → 未决点未确认）也必须能导出。
 const failed=realRound();failed.card=buildCard(failed,null,['编辑整理失败']);const fd=publicCardData(failed);
 assert.equal(fd.card.complete,false);assert.equal(fd.card.unresolved.issue,'');assert.match(renderStaticCard(fd),/未决点未确认/);assert.match(renderLongImageHtml(fd),/内容不完整/);
 const re=x=>{x.version=cardVersion(x);return x;};
 const swap=structuredClone(d);swap.speeches[0].ref='B1';assert.throws(()=>validateCardData(re(swap)),/side\/beat|重复/,'ref must match side+beat');
 const fake=structuredClone(d);fake.card.concessions[0].acceptQuote='我完全认输了，你们说得都对';assert.throws(()=>validateCardData(re(fake)),/引文不在/,'hand-edited fabricated quote rejected even with a recomputed version');
 const who=structuredClone(d);who.card.concessions[0].by=who.card.concessions[0].by==='A'?'B':'A';assert.throws(()=>validateCardData(re(who)),/说话人|引文不在/,'misattributed concession rejected');
 const crux=structuredClone(d);crux.card.unresolved.quotes[0].ref='B1';assert.throws(()=>validateCardData(re(crux)),/引文不在/);
 assert.throws(()=>publicCardData({...r,card:null}),/card/);
});

test('static card page: data embedded, no backend calls, OG meta, script-safe, giscus off by default, bilingual',async()=>{
 const r=realRound();r.topic='</script><script>alert(1)</script> 回不回家？';
 const d=publicCardData(r);
 const html=renderStaticCard(d,{baseUrl:'https://example.test/argue/',ogImage:'og/x.png'});
 assert.ok(!html.includes('<script>alert(1)'),'topic cannot break out of the page');
 assert.ok(!/fetch\(|XMLHttpRequest|\/api\//.test(html),'self-contained: no backend calls');
 assert.match(html,/<meta property="og:image" content="https:\/\/example\.test\/argue\/og\/x\.png">/);
 assert.match(html,/<meta property="og:url" content="https:\/\/example\.test\/argue\/cards\//);
 assert.match(html,/summary_large_image/);
 const embedded=JSON.parse(html.match(/<script type="application\/json" id="card-data">([\s\S]*?)<\/script>/)[1]);
 assert.equal(embedded.topic,r.topic,'embedded JSON round-trips exactly');
 assert.ok(!html.includes('giscus.app'),'giscus disabled by default');
 assert.match(renderStaticCard(d,{giscus:{repo:'o/r',repoId:'R',category:'Cards',categoryId:'C'}}),/giscus\.app\/client\.js/);
 assert.ok(!renderStaticCard(d,{giscus:{repo:'o/r'}}).includes('giscus.app'),'incomplete giscus config stays off');
 {const g={repo:'o/r',repoId:'R',category:'General',categoryId:'C',mapping:'card'};const zh=renderStaticCard(d,{giscus:g}),enp=renderStaticCard(validateCardData({...d,translations:{en:{topic:'EN'}}},{restamp:true}),{lang:'en',giscus:g});
  const term=h=>h.match(/data-term="([^"]*)"/)[1];assert.equal(term(zh),term(enp),'zh and en pages share one discussion per card');assert.match(zh,/data-mapping="specific"/);
  assert.match(zh,/data-lang="zh-CN"/);assert.match(enp,/data-lang="en"/);assert.match(zh,/script-src https:\/\/giscus\.app;/);assert.match(zh,/frame-src https:\/\/giscus\.app/);assert.match(zh,/style-src &#39;unsafe-inline&#39; https:\/\/giscus\.app/,'giscus default.css allowed');}
 assert.match(html,/回 A \/ B \/ 信息不足/);
 const q=d.card.concessions[0].acceptQuote;
 const en=renderStaticCard(validateCardData(tr(d,{topic:'Go home or not?',sides:[{label:'Home'},{label:'Stay'}]})),{lang:'en'});
 assert.match(en,/<html lang="en">/);assert.match(en,/Go home or not\?/);assert.match(en,/Reply A \/ B \/ Not sure/);assert.ok(en.includes(q),'verbatim quotes stay in the original language');
 assert.match(html,/http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;[^"]*script-src &#39;none&#39;/,'static page forbids all scripts');
 const vote=renderStaticCard(d,{voteEndpoint:'/api/cards/'+d.id+'/side'});
 {const src=vote.match(/<script>([\s\S]*?)<\/script>/)[1];const h=(await import('node:crypto')).createHash('sha256').update(src).digest('base64');assert.ok(vote.includes(`sha256-${h}`),'vote script is allowed by hash, not unsafe-inline');}assert.match(vote,/data-endpoint="\/api\/cards\//);assert.match(vote,/\{na\}.*\{nb\}.*\{u\}/,'tally template reaches the client unfilled');
 assert.match(renderLongImageHtml(d),/width:1080px/);assert.match(renderOgHtml(d),/width:1200px;height:630px/);
});

test('site build from committed cards/: index + per-language pages, nothing but generated files',async()=>{
 const out=mkdtempSync(path.join(tmpdir(),'site-'));
 try{
  const r=await site({cards:new URL('../cards',import.meta.url).pathname,out,config:'/nonexistent.json','no-og':true});
  assert.ok(r.cards>=2);assert.ok(existsSync(path.join(out,'index.html')));assert.ok(existsSync(path.join(out,'.nojekyll')));
  const pages=readdirSync(path.join(out,'cards'));assert.ok(pages.some(p=>p.endsWith('.en.html')),'english pages from translations');
  for(const p of pages){const h=readFileSync(path.join(out,'cards',p),'utf8');assert.ok(!/\/api\/|fetch\(|\/home\/|\/workspace/.test(h),p);}
  writeFileSync(path.join(out,'cards','withdrawn.html'),'old');
  const src=mkdtempSync(path.join(tmpdir(),'cards-'));const one=readdirSync(new URL('../cards',import.meta.url).pathname)[0];writeFileSync(path.join(src,one),readFileSync(new URL('../cards/'+one,import.meta.url)));
  await site({cards:src,out,config:'/nonexistent.json','no-og':true});
  assert.ok(!existsSync(path.join(out,'cards','withdrawn.html')),'rebuild replaces the whole output: withdrawn cards disappear');
  assert.equal(readdirSync(path.join(out,'cards')).filter(f=>f.endsWith('.html')).length,2,'one card × zh/en');
  await assert.rejects(site({cards:src,out:process.cwd(),config:'/nonexistent.json','no-og':true}),/拒绝/,'refuses to replace the repo root');
  await assert.rejects(site({cards:src,out,config:'/nonexistent.json','no-og':true,'base-url':'http://x.test'}),/https/);
  rmSync(src,{recursive:true,force:true});
 }finally{rmSync(out,{recursive:true,force:true});}
});

function shareFixture(opts={}){
 const dir=mkdtempSync(path.join(tmpdir(),'share-')),cards=path.join(dir,'cards');mkdirSync(cards);
 const d=publicCardData(realRound());writeFileSync(path.join(cards,d.id+'.json'),JSON.stringify(d));
 writeFileSync(path.join(cards,'bad.json'),'{"schema":1,"id":"zz"}');
 const app=createShareServer({cardsDir:cards,ogDir:path.join(dir,'og'),votesPath:path.join(dir,'votes.json'),...opts});
 return {dir,d,...app,done:()=>{app.server.close();rmSync(dir,{recursive:true,force:true});}};
}
const raw=(port,m,u,b,h={})=>new Promise((resolve,reject)=>{const q=http.request(`http://127.0.0.1:${port}${u}`,{method:m,headers:{...(b?{'content-type':'application/json'}:{}),...h}},res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>{let j=null;try{j=JSON.parse(s);}catch{}resolve({status:res.statusCode,headers:res.headers,text:s,json:j});});});q.on('error',reject);q.end(b?JSON.stringify(b):undefined);});

test('share-server: read-only cards + deduped votes; no console/generation routes; origin, rate and host limits',async()=>{
 const f=shareFixture({rate:{perIp:3,global:100,windowMs:60000}});
 await new Promise(r=>f.server.listen(0,'127.0.0.1',r));const port=f.server.address().port,id=f.d.id;
 try{
  const src=readFileSync(new URL('../share-server.mjs',import.meta.url),'utf8');
  assert.ok(!/debate\.mjs|providers\.mjs|card\.mjs|child_process/.test(src),'share server imports no generation code');
  const idx=await raw(port,'GET','/');assert.equal(idx.status,200);assert.ok(idx.text.includes(`/card/${id}`));
  const page=await raw(port,'GET',`/card/${id}`);assert.equal(page.status,200);assert.match(page.text,/data-endpoint/);assert.match(page.headers['content-security-policy'],/default-src 'none'/);
  for(const u of ['/api/rounds','/api/agents','/api/health',`/api/rounds/${id}`,`/api/cards/${id}`,'/index.html/../server.mjs','/cards/'+id+'.json'])assert.equal((await raw(port,'GET',u)).status,u==='/index.html/../server.mjs'?404:404,u);
  assert.equal((await raw(port,'POST','/api/rounds',{topic:'x'})).status,404);
  assert.equal((await raw(port,'DELETE',`/api/cards/${id}/side`)).status,405);
  assert.equal((await raw(port,'GET','/card/zz')).status,404,'invalid card files are skipped');
  const g=await raw(port,'GET',`/api/cards/${id}/side`);assert.equal(g.json.tally,null);const cookie=g.headers['set-cookie'][0].split(';')[0];
  assert.match(g.headers['set-cookie'][0],/HttpOnly; SameSite=Lax/);
  await raw(port,'POST',`/api/cards/${id}/side`,{side:'A'},{cookie});
  const v=await raw(port,'POST',`/api/cards/${id}/side`,{side:'A'},{cookie});assert.deepEqual(v.json.tally,{A:1,B:0,unsure:0},'same voter counted once');
  assert.equal((await raw(port,'POST',`/api/cards/${id}/side`,{side:'C'},{cookie})).status,400);
  assert.equal((await raw(port,'POST',`/api/cards/${id}/side`,{side:'B'},{cookie,origin:'https://evil.test'})).status,403);
  assert.equal((await raw(port,'POST',`/api/cards/${id}/side`,{side:'B'},{cookie})).status,429,'per-IP write limit');
  assert.equal((await raw(port,'POST',`/api/cards/${id}/side`,{side:'B'},{cookie,'x-forwarded-for':'9.9.9.9','cf-connecting-ip':'8.8.8.8'})).status,429,'forwarding headers from an untrusted peer cannot dodge the limit');
  assert.equal((await raw(port,'GET',`/api/cards/${id}/side`,null,{cookie:'aa_voter=%'})).status,200,'malformed cookie is treated as absent');
  f.flush();const saved=JSON.parse(readFileSync(path.join(f.dir,'votes.json'),'utf8'));assert.deepEqual(saved[id].tally,{A:1,B:0,unsure:0});
 }finally{f.done();}
 const cfx=shareFixture({trustedProxies:['127.0.0.1'],rate:{perIp:1,global:100,windowMs:60000}});await new Promise(r=>cfx.server.listen(0,'127.0.0.1',r));
 try{const p=cfx.server.address().port,u=`/api/cards/${cfx.d.id}/side`;
  assert.equal((await raw(p,'POST',u,{side:'A'},{'cf-connecting-ip':'3.3.3.3'})).status,200);
  assert.equal((await raw(p,'POST',u,{side:'A'},{'cf-connecting-ip':'4.4.4.4'})).status,429,'only the configured header (default XFF) is trusted; an unscrubbed CF header cannot rotate identities');
 }finally{cfx.done();}
 const tp=shareFixture({trustedProxies:['127.0.0.1'],rate:{perIp:1,global:100,windowMs:60000}});await new Promise(r=>tp.server.listen(0,'127.0.0.1',r));
 try{const p=tp.server.address().port,u=`/api/cards/${tp.d.id}/side`;
  assert.equal((await raw(p,'POST',u,{side:'A'},{'x-forwarded-for':'1.1.1.1'})).status,200);
  assert.equal((await raw(p,'POST',u,{side:'A'},{'x-forwarded-for':'1.1.1.1'})).status,429,'same client IP limited');
  assert.equal((await raw(p,'POST',u,{side:'A'},{'x-forwarded-for':'1.1.1.1, 2.2.2.2'})).status,200,'rightmost hop (written by our proxy) is the client');
  assert.equal((await raw(p,'POST',u,{side:'A'},{'x-forwarded-for':'5.5.5.5, 2.2.2.2'})).status,429,'spoofed leftmost entries are ignored');
  const sc=await raw(p,'GET',u,null,{'x-forwarded-proto':'https'});assert.match(sc.headers['set-cookie'][0],/; Secure/,'Secure cookie behind a trusted HTTPS proxy');
 }finally{tp.done();}
 const bv=mkdtempSync(path.join(tmpdir(),'badvotes-'));writeFileSync(path.join(bv,'v.json'),'{"x":1}');
 assert.throws(()=>createShareServer({cardsDir:bv,votesPath:path.join(bv,'v.json')}),/结构/,'malformed vote file refuses to start');rmSync(bv,{recursive:true,force:true});
 const h=shareFixture({shareHosts:['cards.example.test']});await new Promise(r=>h.server.listen(0,'127.0.0.1',r));
 try{assert.equal((await raw(h.server.address().port,'GET','/')).status,421);assert.equal((await raw(h.server.address().port,'GET','/',null,{host:'cards.example.test'})).status,200);}finally{h.done();}
});

test('demo mode: bundled real cards, scripted debaters produce a verified card, exports gated by publish',async()=>{
 process.env.ARGUE_DEMO_DELAY_MS='0';
 const {server,store,engine}=createApp({demo:true});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const req=(m,u,b)=>fetch(base+u,{method:m,headers:b?{'content-type':'application/json'}:{},body:b?JSON.stringify(b):undefined});
 try{
  assert.ok(!store.file.includes(path.join('demo','rounds.json')),'demo works on a temp copy');
  assert.equal((await (await req('GET','/api/health')).json()).demo,true);
  const agents=(await (await req('GET','/api/agents')).json()).agents;assert.deepEqual(agents.map(a=>a.id),['demo-a','demo-b','demo-editor']);
  const list=(await (await req('GET','/api/rounds')).json()).rounds;assert.equal(list.length,2);
  const pre=list[0].id;
  const page=await req('GET',`/api/rounds/${pre}/export/card.html`);assert.equal(page.status,200);assert.match(page.headers.get('content-disposition'),/attachment/);const preHtml=await page.text();assert.ok(!preHtml.includes('fetch('));
  assert.equal((await req('POST','/api/rounds',{mode:'argue',topic:'x',agents:['demo-a','demo-b']})).status,400,'demo is card-only');
  const c=await (await req('POST','/api/rounds',{topic:'周末谁做饭？',agents:['demo-a','demo-b']})).json();
  const id=c.round.id;assert.equal(c.round.mode,'card');assert.equal(c.round.judge,'demo-editor');
  await req('POST',`/api/rounds/${id}/start`,{});await wait(()=>store.get(id).status==='card');
  const card=store.get(id).card;assert.equal(card.complete,true);assert.equal(card.concessions.length,1,'scripted concession passes real verification');assert.ok(card.unresolved.issue);
  assert.equal((await req('GET',`/api/rounds/${id}/export/card.json`)).status,409,'unpublished cards cannot be exported');
  await req('POST',`/api/rounds/${id}/publish`,{published:true});
  assert.match(await (await req('GET',`/api/rounds/${id}/export/card.html`)).text(),/演示卡：预设台词/,'scripted demo cards are labelled on every export');
  assert.ok(!preHtml.includes('演示卡'),'pre-recorded real debates are not labelled as scripted');
  if(findChrome()){const png=await req('GET',`/api/rounds/${pre}/export/long.png`);assert.equal(png.status,200);const b=Buffer.from(await png.arrayBuffer());assert.equal(pngSize(b).w,1080);assert.ok(pngSize(b).h>1200);}
 }finally{server.close();delete process.env.ARGUE_DEMO_DELAY_MS;rmSync(path.dirname(store.file),{recursive:true,force:true});}
});

test('screenshot: OG image is exactly 1200×630; over-tall long images fail instead of silently cropping',{skip:!findChrome()&&'no Chrome installed'},async()=>{
 const d=publicCardData(realRound());const {png}=await htmlToPng(renderOgHtml(d),{width:1200,height:630});
 assert.deepEqual(pngSize(png),{w:1200,h:630});
 await assert.rejects(htmlToPng('<div style="height:20000px">x</div>',{width:400,height:300,fullPage:true}),/上限/);
});

test('screenshot: concurrency cap holds and an early-exiting Chrome leaves no process-group survivors',{skip:process.platform==='win32'&&'posix only'},async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'fakechrome-')),fake=path.join(dir,'chrome'),pids=path.join(dir,'pids');
 // 假 Chrome：起一个后台子进程（同进程组）后主进程立刻退出，模拟主进程崩溃而渲染子进程残留。
 writeFileSync(fake,`#!/bin/sh\nsleep 30 &\necho $! >> ${pids}\nsleep 0.2\nexit 3\n`,{mode:0o755});
 const prev=process.env.CHROME_BIN;process.env.CHROME_BIN=fake;let peak=0;const iv=setInterval(()=>{peak=Math.max(peak,_slots.busy);},5);
 try{
  const rs=await Promise.allSettled(Array.from({length:5},()=>htmlToPng('<p>x</p>',{width:100,height:100,timeoutMs:5000})));
  assert.ok(rs.every(r=>r.status==='rejected'&&/提前退出/.test(r.reason.message)),'early exit is reported');
  assert.ok(peak<=_slots.max,`busy peaked at ${peak} > ${_slots.max}`);assert.equal(_slots.busy,0);assert.equal(_slots.queue.length,0);
  await new Promise(r=>setTimeout(r,200));
  const survivors=readFileSync(pids,'utf8').trim().split('\n').filter(pid=>{try{process.kill(Number(pid),0);return true;}catch{return false;}});
  assert.deepEqual(survivors,[],'renderer children are killed with the process group');
 }finally{clearInterval(iv);if(prev===undefined)delete process.env.CHROME_BIN;else process.env.CHROME_BIN=prev;rmSync(dir,{recursive:true,force:true});}
});
