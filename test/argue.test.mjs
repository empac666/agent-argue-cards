import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DebateStore,DebateEngine} from '../lib/debate.mjs';
import {assignStances,parseOptions,arguePrompt,checkVerdict} from '../lib/argue.mjs';
import {verifyArgueConsensus} from '../lib/consensus.mjs';
import {createApp} from '../server.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function settle(round,engine){for(let i=0;i<400;i++){if(!engine.jobs.has(round.id)&&round.status!=='running')return;await sleep(5);}throw Error('did not settle');}
const isJudge=p=>p.includes('你是独立裁判');
const currentVersion=p=>p.match(/当前提案 v(\w+)/)?.[1];
function fixture(invoke){const dir=mkdtempSync(path.join(tmpdir(),'argue-rules-')),store=new DebateStore(path.join(dir,'rounds.json')),calls=[],engine=new DebateEngine(store,async(id,p)=>{calls.push({id,p});const out=await invoke(id,p,calls);return isJudge(p)?withVersion(out,p):out;});return {dir,store,engine,calls,done:()=>rmSync(dir,{recursive:true,force:true})};}
const create=(f,o={})=>f.store.create({topic:'三人创业团队做后端，选 Go 还是 Node.js？',agents:['a','b'],maxCycles:4,mode:'argue',judge:'j',...o});
// 辩手：前期 OBJECT 并给方案；允许表态后第一个发言者 AGREE 对方当前提案。
const speaker=(agreeFrom=3)=>(id,p)=>{const n=Number(p.match(/当前第 (\d+)\//)?.[1]);const v=currentVersion(p);if(n>=agreeFrom&&v&&v!=='无')return JSON.stringify({claim:`${id} 被说服`,concessions:['接受对方关于招聘成本的论据'],argument:'同意',vote:'AGREE',version:v,proposal:'顺手改一句'});return JSON.stringify({claim:`${id} 第${n}轮主张`,rebuttal:n>1?'反驳':'',argument:`${id} 论证 ${n}`,vote:'AGREE',version:v||'',proposal:`${id} 方案 ${n}`});};
// 真实裁判会回填 prompt 里给出的版本号；judgeSays 未指定 version 时由 fixture 自动补上。
const withVersion=(out,p)=>{try{const o=JSON.parse(out);if(!('version' in o))o.version=p.match(/"version":"(\w+)"/)?.[1];return JSON.stringify(o);}catch{return out;}};
const judgeSays=(verdict,quote='接受对方关于招聘成本的论据')=>JSON.stringify({verdict,reason:'理由',evidence:[{quote,why:'真实让步'}],unresolved:verdict==='CONTINUE'?[{issue:'性能边界未落地'}]:[]});

test('stances: binary topics get opposing sides, custom stances override, fallback is generic tension',()=>{
 assert.deepEqual(parseOptions('边缘设备上跑小模型，应该优先做量化还是剪枝？'),['量化','剪枝']);
 assert.deepEqual(parseOptions('三人创业团队做后端，选 Go 还是 Node.js？'),['Go','Node.js']);
 const s=assignStances('三人创业团队做后端，选 Go 还是 Node.js？',['a','b','c']);
 assert.match(s.a,/主张「Go」/);assert.match(s.b,/主张「Node.js」/);assert.notEqual(s.a,s.b);assert.match(s.c,/条件派/);
 assert.equal(assignStances('Go 还是 Node？',['a','b'],['我方偏好 Rust']).a,'我方偏好 Rust');
 const g=assignStances('人类是否应当赋予 AGI 宪法级权利？',['a','b']);assert.match(g.a,/主张方/);assert.match(g.b,/质疑方/);
});

test('prompts drop the old agreement-seeking wording; opening is blind; rebuttal targets the opponent claim',()=>{
 const f=fixture(()=>'');try{const r=create(f);
  const opening=arguePrompt(r,'a');assert.doesNotMatch(opening,/可原样复用|尽量提出可达成共识/);assert.match(opening,/独立立论/);assert.match(opening,/主张「Go」/);
  const m=f.store.message(r,'b','argument','Node 生态更快');m.cycle=1;m.meta={claim:'Node 的 npm 生态让三人团队交付更快'};
  assert.doesNotMatch(arguePrompt(r,'a'),/Node 生态更快/,'opening round must not show same-cycle opponent speech');
  r.cycle=1;const reb=arguePrompt(r,'a');assert.match(reb,/不允许 AGREE/);assert.match(reb,/「Node 的 npm 生态让三人团队交付更快」/);
 }finally{f.done();}
});

test('AGREE during the first minCycles is rejected and never reaches the judge',async()=>{
 const f=fixture((id,p)=>isJudge(p)?judgeSays('CONSENSUS'):speaker(99)(id,p));
 try{const r=create(f,{maxCycles:2});f.engine.start(r.id);await settle(r,f.engine);
  assert.equal(r.status,'unresolved');assert.equal(r.outcome.kind,'cycle-cap');
  assert.equal(f.calls.filter(c=>c.id==='j').length,0);
  assert.equal(r.messages.filter(m=>m.meta?.rule==='early-agree').length,4);
  assert.ok(r.messages.filter(m=>m.kind==='argument').every(m=>m.meta.vote==='OBJECT'));
 }finally{f.done();}
});

test('judge CONSENSUS with grounded evidence ends the debate after the rebuttal phase; AGREE-with-edit is discarded',async()=>{
 const f=fixture((id,p)=>isJudge(p)?judgeSays('CONSENSUS'):speaker(3)(id,p));
 try{const r=create(f);f.engine.start(r.id);await settle(r,f.engine);
  assert.equal(r.status,'consensus');assert.equal(r.cycle+1,3);
  assert.equal(r.proposal.text,'b 方案 2');assert.equal(r.proposal.author,'b');
  assert.equal(r.verdict.verdict,'CONSENSUS');assert.ok(verifyArgueConsensus(r));
  assert.equal(f.calls.filter(c=>c.id==='j').length,1);
  assert.ok(!r.messages.some(m=>m.kind==='proposal'&&m.content==='顺手改一句'));
 }finally{f.done();}
});

test('judge CONTINUE vetoes the candidate, resets assents and feeds back; veto cap ends as unresolved',async()=>{
 const f=fixture((id,p)=>isJudge(p)?judgeSays('CONTINUE'):speaker(3)(id,p));
 try{const r=create(f,{maxCycles:10});f.engine.start(r.id);await settle(r,f.engine);
  assert.equal(r.status,'unresolved');assert.equal(r.outcome.kind,'judge-veto-cap');assert.equal(r.judgeVetoes,2);
  assert.ok(r.cycle<10,'must stop before the cycle cap');
  const after=f.calls.findIndex(c=>c.id==='j');assert.match(f.calls[after+1].p,/独立裁判此前认为尚未达成真正共识/);
  assert.equal(verifyArgueConsensus(r),false);
 }finally{f.done();}
});

test('judge CONSENSUS without a verbatim quote is retried once, then fails closed',async()=>{
 const f=fixture((id,p)=>isJudge(p)?judgeSays('CONSENSUS','记录里根本没有这句话啊'):speaker(3)(id,p));
 try{const r=create(f,{maxCycles:3});f.engine.start(r.id);await settle(r,f.engine);
  assert.notEqual(r.status,'consensus');assert.equal(r.verdict.verdict,'CONTINUE');
  assert.ok(f.calls.filter(c=>c.id==='j').length>=2);
 }finally{f.done();}
});

test('deadlock: permanent objection terminates at the cycle cap with the last proposal kept',async()=>{
 const f=fixture((id,p)=>isJudge(p)?judgeSays('CONSENSUS'):JSON.stringify({claim:'不让步',argument:'坚持',vote:'OBJECT',proposal:`${id} 的方案`}));
 try{const r=create(f,{maxCycles:5});f.engine.start(r.id);await settle(r,f.engine);
  assert.equal(r.status,'unresolved');assert.equal(r.cycle,5);assert.equal(r.outcome.kind,'cycle-cap');
  assert.equal(f.calls.length,10);assert.equal(f.calls.filter(c=>c.id==='j').length,0);assert.ok(r.proposal.text);
  f.engine.start(r.id);await settle(r,f.engine);assert.equal(r.maxCycles,7);assert.equal(r.status,'unresolved');
 }finally{f.done();}
});

test('author cannot vote for own proposal; verdict for an older version does not count',()=>{
 const r={agents:['a','b'],judge:'j',minCycles:2,cycle:2,proposal:{text:'x',version:'2d711642b726b044'.slice(0,16),author:'a'},assents:{a:{vote:'AGREE',version:'2d711642b726b044'},b:{vote:'AGREE',version:'2d711642b726b044'}},verdict:{verdict:'CONSENSUS',version:'old',evidence:[{grounded:true}]}};
 assert.equal(verifyArgueConsensus(r),false);
 assert.equal(checkVerdict({verdict:'MAYBE',reason:'x'},{topic:'',proposal:{text:''},messages:[]}).ok,false);
});

test('server defaults to argue mode with an independent judge and rejects a debater as judge',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'argue-server-'));
 const providerList=async()=>['agy','grok','agy-claude'].map(id=>({id,name:id,available:true}));
 const {server}=createApp({dataPath:path.join(dir,'r.json'),providerInvoke:async()=>'{}',providerList});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const post=b=>fetch(base+'/api/rounds',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(async r=>({status:r.status,body:await r.json()}));
 try{
  const ok=await post({topic:'量化还是剪枝？',agents:['agy','grok'],maxCycles:4});
  assert.equal(ok.status,201);assert.equal(ok.body.round.mode,'argue');assert.equal(ok.body.round.judge,'agy-claude');assert.equal(ok.body.round.minCycles,2);assert.match(ok.body.round.stances.agy,/量化/);
  assert.equal((await post({topic:'t',agents:['agy','grok'],maxCycles:4,judge:'grok'})).status,400);
  assert.equal((await post({topic:'t',agents:['agy','grok'],maxCycles:2})).status,400);
  assert.equal((await post({topic:'t',agents:['agy','grok'],maxCycles:2,mode:'classic'})).body.round.mode,undefined);
 }finally{server.close();rmSync(dir,{recursive:true,force:true});}
});

test('judge CONSENSUS for a wrong proposal version fails closed (no longer rewritten to the current version)',async()=>{
 const f=fixture((id,p)=>isJudge(p)?JSON.stringify({...JSON.parse(judgeSays('CONSENSUS')),version:'incorrect'}):speaker(3)(id,p));
 try{const r=create(f,{maxCycles:3});f.engine.start(r.id);await settle(r,f.engine);
  assert.notEqual(r.status,'consensus');assert.equal(r.verdict.verdict,'CONTINUE');assert.match(r.verdict.reason,/版本/);
 }finally{f.done();}
});

test('pause requested while a debater is speaking does not go on to call the judge',async()=>{
 let release;const gate=new Promise(r=>release=r);let gated=false;
 const f=fixture(async(id,p)=>{if(isJudge(p))return judgeSays('CONSENSUS');if(!gated&&/当前第 3\//.test(p)){gated=true;await gate;}return speaker(3)(id,p);});
 try{const r=create(f);f.engine.start(r.id);for(let i=0;i<200&&!gated;i++)await sleep(5);f.engine.stop(r.id);release();await settle(r,f.engine);
  assert.equal(r.status,'paused');assert.equal(f.calls.filter(c=>c.id==='j').length,0);
 }finally{f.done();}
});
