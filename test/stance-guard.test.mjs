// 真实淘汰记录、已发布卡与引擎回放：立场核验必须共用判据，不改 fixture。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DebateStore,DebateEngine} from '../lib/debate.mjs';
import {buildCard,verifyConcession,cardArguments,cardTranscript,editorPrompt} from '../lib/card.mjs';
import {copyReason,selfPointReason,COPY_MIN,COPY_MARGIN,SELF_POINT_MIN,SELF_POINT_MARGIN} from '../lib/stance.mjs';
import {publicCardData,validateCardData,cardVersion} from '../lib/export.mjs';
const load=name=>JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`,import.meta.url),'utf8'));
const hit=(fx,ref)=>{const i=fx.speeches.findIndex(s=>s.ref===ref);return copyReason(fx.speeches[i],fx.speeches.slice(0,i));};
function setup(fx,fn){
 const dir=mkdtempSync(path.join(tmpdir(),'stance-')),store=new DebateStore(path.join(dir,'r.json'));
 const r=store.create({topic:fx.topic,agents:fx.agents,mode:'card',judge:fx.judge,stances:fx.stances,facts:fx.facts});
 return {r,store,engine:new DebateEngine(store,fn),dispose:()=>rmSync(dir,{recursive:true,force:true})};
}
function recorded(fx){
 const ctx=setup(fx);for(const s of fx.speeches){const m=ctx.store.message(ctx.r,fx.agents[s.side==='A'?0:1],'argument',s.argument);m.meta={...s,missing:[]};}return ctx;
}
async function replay(fx,{replacement,fail=false,lowBudget=false}={}){
 const counts={},prompts=[];
 const ctx=setup(fx,async(agent,p)=>{
  prompts.push(p);if(p.includes('你是独立编辑'))return JSON.stringify(fx.editor);
  const ref=p.match(/你是 ([AB]) 方辩手/)[1]+p.match(/当前第 (\d)\/3 拍/)[1];counts[ref]=(counts[ref]||0)+1;
  if(counts[ref]>1&&fail)throw new Error('重试连接失败');
  const original=fx.speeches.find(s=>s.ref===ref);
  return JSON.stringify(counts[ref]>1&&replacement?{...original,...replacement(ref)}:original);
 });
 const oldBudget=process.env.ARGUE_CARD_BUDGET_MS,oldReserve=process.env.ARGUE_CARD_EDITOR_RESERVE_MS;
 try{
  if(lowBudget){process.env.ARGUE_CARD_BUDGET_MS='1000';process.env.ARGUE_CARD_EDITOR_RESERVE_MS='2000';}
  await ctx.engine.runCard(ctx.r,{stop:false});return {...ctx,counts,prompts};
 }catch(e){ctx.dispose();throw e;}
 finally{if(oldBudget===undefined)delete process.env.ARGUE_CARD_BUDGET_MS;else process.env.ARGUE_CARD_BUDGET_MS=oldBudget;if(oldReserve===undefined)delete process.env.ARGUE_CARD_EDITOR_RESERVE_MS;else process.env.ARGUE_CARD_EDITOR_RESERVE_MS=oldReserve;}
}
for(const id of ['05b194ec','097b6d21'])test(`copy ${id}：A2 抄 B1，B2 重复己方 B1 不误伤`,()=>{
 const fx=load(`stance-${id}`),a=hit(fx,'A2');assert.equal(a.ref,'B1');assert.equal(a.field,'claim');assert.equal(a.score,1);assert.equal(hit(fx,'B2'),null);
});
test('copy：云端逐字照抄、3B 近似照抄及真实先后中的底线照抄',()=>{
 assert.equal(hit(load('concession-echo-0069aa79'),'B2').ref,'A2');
 const a=hit(load('stance-23d9ad03'),'A2');assert.equal(a.ref,'B1');assert.equal(a.score,0.76);
 const b=hit(load('stance-097b6d21'),'B3');assert.equal(b.field,'bottomLine');assert.equal(b.ref,'A3');
});
for(const name of ['concession-echo-c3e92d9e','published-c3e92d9e','published-47dfa0ac','published-b56d86da','concession-echo-9a8dd9ce','stance-df883345'])test(`copy ${name}：全部发言字面不命中`,()=>{
 const fx=load(name);for(const s of fx.speeches)assert.equal(hit(fx,s.ref),null,s.ref);
});
test('copy：阈值、短句规范化、英文词数、正文/反驳与开局立场均不参与',()=>{
 assert.deepEqual([COPY_MIN,COPY_MARGIN,SELF_POINT_MIN,SELF_POINT_MARGIN],[0.7,0.2,0.65,0.2]);
 const prior=[{ref:'A1',side:'A',claim:'天地玄黄',bottomLine:'All four words match'}];
 assert.equal(copyReason({ref:'B2',side:'B',claim:'天 地，玄黄！'},prior).score,1);
 assert.equal(copyReason({ref:'B2',side:'B',claim:'ALL FOUR WORDS MATCH!'},prior).score,1);
 assert.equal(copyReason({ref:'B2',side:'B',claim:'天玄黄'},prior),null);
 assert.equal(copyReason({ref:'B2',side:'B',claim:'完全不同的话',argument:'天地玄黄',rebuttal:'天地玄黄'},prior),null);
});
const ownRewrite=()=>({claim:'礼金必须控制在新人负担得起的范围，婚后积蓄不能耗尽',argument:'小家庭要先留下生活备用金，不能为了礼金掏空积蓄。'});
test('引擎：B2 退回后改正，六条有效发言；审计原文不进入后续记录与公开数据',async()=>{
 const fx=load('concession-echo-0069aa79'),ctx=await replay(fx,{replacement:ownRewrite});try{
  const {r,prompts,counts}=ctx,old=r.messages.find(m=>m.status==='superseded');assert.equal(counts.B2,2);assert.equal(r.card.complete,true);
  assert.equal(old.meta.ref,'B2');assert.equal(old.meta.superseded,true);assert.equal(old.meta.copy.ref,'A2');assert.equal(old.content,fx.speeches.find(s=>s.ref==='B2').argument);
  assert.ok(r.messages.some(m=>m.meta?.rule==='copy-retry'&&m.meta.ref==='B2'));assert.equal(cardArguments(r).length,6);assert.equal(cardArguments(r).find(m=>m.meta.ref==='B2').meta.claim,ownRewrite().claim);
  const retry=prompts.find(p=>p.includes('上一次输出被退回'));assert.ok(retry.includes('对方 A2'));assert.ok(retry.includes(fx.speeches.find(s=>s.ref==='A2').claim));assert.ok(retry.includes(fx.stances[1]));
  for(const p of prompts.filter(p=>p.includes('当前第 3/3 拍')||p.includes('你是独立编辑')))assert.ok(!p.includes(old.content));
  assert.ok(!cardTranscript(r).includes(old.content));const d=publicCardData(r);assert.equal(d.speeches.length,6);assert.ok(!JSON.stringify(d).includes(old.content));
  assert.equal(r.timing.calls.filter(c=>c.ref==='B2').length,2);
 }finally{ctx.dispose();}
});
test('引擎：重试仍抄，只重试一次，第二版有效并标为不完整',async()=>{
 const ctx=await replay(load('concession-echo-0069aa79'));try{
  assert.equal(ctx.counts.B2,2);assert.equal(ctx.r.card.complete,false);assert.match(ctx.r.card.issues.join(),/B2.*照抄/);
  const b=cardArguments(ctx.r).find(m=>m.meta.ref==='B2');assert.equal(b.meta.copyRetried,true);assert.equal(b.meta.copy.ref,'A2');assert.equal(cardArguments(ctx.r).length,6);assert.doesNotThrow(()=>publicCardData(ctx.r));
 }finally{ctx.dispose();}
});
test('引擎：预算不足不重试，第一次有效并如实标注',async()=>{
 const ctx=await replay(load('concession-echo-0069aa79'),{lowBudget:true});try{
  assert.equal(ctx.counts.B2,1);assert.equal(ctx.r.card.complete,false);const b=cardArguments(ctx.r).find(m=>m.meta.ref==='B2');assert.equal(b.meta.copyRetried,false);assert.match(ctx.r.card.issues.join(),/预算不足未重试/);assert.ok(!ctx.r.messages.some(m=>m.status==='superseded'));
 }finally{ctx.dispose();}
});
test('引擎：05b194ec A2 重试修正，B2 的己方来源不误伤',async()=>{
 const ctx=await replay(load('stance-05b194ec'),{replacement:()=>({claim:'未婚双方各付一半，账目清楚才能保持各自自主'})});try{
  assert.equal(ctx.counts.A2,2);assert.equal(ctx.counts.B2,1);assert.equal(ctx.r.card.complete,true);
 }finally{ctx.dispose();}
});
test('引擎：重试调用抛错沿用辩手调用失败路径，不调用编辑',async()=>{
 const ctx=await replay(load('concession-echo-0069aa79'),{fail:true});try{
  assert.equal(ctx.r.card.complete,false);assert.match(ctx.r.card.issues.join(),/辩手调用失败.*重试连接失败/);assert.ok(ctx.r.messages.some(m=>m.status==='failed'));assert.ok(!ctx.prompts.some(p=>p.includes('你是独立编辑')));
 }finally{ctx.dispose();}
});
const self={by:'B',point:'B 承认平摊影响储蓄',opponentRef:'A3',opponentQuote:'平摊会导致收入低的一方存不下钱',acceptRef:'B3',acceptQuote:'我承认平摊会带来低收入一方存不下钱的问题'};
test('selfPoint：097b6d21 依赖开局立场拒收自己让自己；无立场时如实保留判据边界',()=>{
 const fx=load('stance-097b6d21'),ctx=recorded(fx);try{
  const v=verifyConcession(ctx.r,self);assert.equal(v.ok,false);assert.match(v.why,/自己让自己/);
  assert.equal(selfPointReason(self,fx.speeches),null,'公开数据没有开局立场，该真实样本只能在引擎侧拒收');
 }finally{ctx.dispose();}
});
for(const name of ['concession-echo-0069aa79','concession-echo-9a8dd9ce','concession-echo-c3e92d9e','stance-df883345'])test(`selfPoint ${name}：原本核验通过的真实让步保留`,()=>{
 const fx=load(name),ctx=recorded(fx);try{
  const cs=name==='stance-df883345'?fx.editor.concessions:fx.editor.concessions.filter(c=>c.by==='A');
  for(const c of cs){assert.equal(verifyConcession(ctx.r,c).ok,true);assert.equal(selfPointReason(c,fx.speeches,{A:fx.stances[0],B:fx.stances[1]}),null);}
 }finally{ctx.dispose();}
});
test('selfPoint：仅使用 opponentRef 之前的主张；双方已有同一论点时 margin 放行，正文引用不误伤',()=>{
 const c={by:'B',opponentRef:'A2',opponentQuote:'共享房租按收入比例分配更公平'};
 const own={ref:'B1',side:'B',claim:c.opponentQuote},opp={ref:'A2',side:'A',claim:c.opponentQuote};
 assert.match(selfPointReason(c,[own,opp]),/自己让自己/);
 assert.equal(selfPointReason(c,[{...own,side:'A',ref:'A1'},own,opp]),null);
 assert.equal(selfPointReason(c,[opp,{...own,ref:'B2'}]),null);
 assert.equal(selfPointReason(c,[{...own,claim:'另一个独立论点',content:c.opponentQuote,rebuttal:c.opponentQuote},opp]),null);
});
test('stanceBreaks：核验引文后标为不完整；伪引文进 rejected；旧编辑无字段兼容',()=>{
 const fx=load('stance-df883345'),ctx=recorded(fx);try{
  const original=buildCard(ctx.r,fx.editor);assert.equal(original.complete,true);
  const empty=buildCard(ctx.r,{...fx.editor,stanceBreaks:[]});assert.deepEqual({...original,createdAt:''},{...empty,createdAt:''});
  const quote=fx.speeches.find(s=>s.ref==='B2').claim.slice(0,20),broken=buildCard(ctx.r,{...fx.editor,stanceBreaks:[{ref:'B2',quote,why:'主张实际替 A 方固定报酬辩护'}]});
  assert.equal(broken.complete,false);assert.match(broken.issues.join(),/B2.*替对方立场说话/);assert.ok(broken.issues.join().includes(quote));
  const invalid=buildCard(ctx.r,{...fx.editor,stanceBreaks:[{ref:'B2',quote:'这一句并不存在于真实发言里',why:'换边'}]});assert.equal(invalid.complete,true);assert.match(invalid.rejected.at(-1).why,/引文对不上/);
  const prompt=editorPrompt(ctx.r);assert.match(prompt,/6\. stanceBreaks/);assert.match(prompt,/6–60 字/);assert.match(prompt,/局部论点/);
 }finally{ctx.dispose();}
});
test('发布：三张已发布卡及全部审核卡原样通过，含译文的 version 不变',()=>{
 const names=['published-47dfa0ac','published-b56d86da','published-c3e92d9e'];
 const dir=new URL('../cards/',import.meta.url),all=[...names.map(load),...readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(new URL(f,dir),'utf8')))];
 for(const d of all){const out=validateCardData(d);assert.deepEqual(out,d);assert.equal(cardVersion(out),d.version);for(const c of d.card.concessions)assert.equal(selfPointReason(c,d.speeches),null);}
});
test('发布：complete:true 的照抄卡被拒；complete:false 保留审计结果',()=>{
 const ctx=recorded(load('concession-echo-0069aa79'));try{
  ctx.r.card=buildCard(ctx.r,load('concession-echo-0069aa79').editor);assert.equal(ctx.r.card.complete,false);const d=publicCardData(ctx.r);
  d.card.complete=true;d.version=cardVersion(d);assert.throws(()=>validateCardData(d),/complete 为 true 但 B2 照抄对方 A2/);
 }finally{ctx.dispose();}
});
test('发布：不用开局立场，主张本身就足以拒收自己让自己',()=>{
 const d=structuredClone(load('published-47dfa0ac')),q='共享房租按收入比例分配更公平';
 d.card.complete=false;d.card.concessions=[{by:'B',point:'B 承认比例分摊更公平',opponentRef:'A3',opponentQuote:q,acceptRef:'B3',acceptQuote:`我承认${q}`}];
 for(const s of d.speeches){s.claim=`${s.ref} 自己独立的主张`;s.bottomLine='';s.conceded=[];}
 d.speeches.find(s=>s.ref==='B1').claim=q;d.speeches.find(s=>s.ref==='A3').claim=q;d.speeches.find(s=>s.ref==='B3').content=`我承认${q}`;
 d.card.unresolved=null;d.version=cardVersion(d);assert.throws(()=>validateCardData(d),/自己让自己/);
});
