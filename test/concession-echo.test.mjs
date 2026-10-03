// 回归：真实跑次（彩礼 0069aa79 / 9a8dd9ce，已淘汰）里 B3 复读了 A3 的让步（A 承认的是 B 的论点），
// 编辑把它记成「B 方让步」，旧核验（原文/说话人/字段/先后）全部通过。新核验必须剔除这一条、保留 A 的真让步。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DebateStore,DebateEngine} from '../lib/debate.mjs';
import {verifyConcession,buildCard} from '../lib/card.mjs';
import {publicCardData,validateCardData,cardVersion} from '../lib/export.mjs';
import {echoReason,containment} from '../lib/echo.mjs';
const load=id=>JSON.parse(readFileSync(new URL(`./fixtures/concession-echo-${id}.json`,import.meta.url),'utf8'));
const REAL=['0069aa79','9a8dd9ce'];
const ECHO=/对方的让步原文|复读对方/;
// 把记录还原成一局 card 辩论（与引擎写入的 meta 结构一致）。
function roundOf(fx,dir){
 const store=new DebateStore(path.join(dir,'r.json'));
 const r=store.create({topic:fx.topic,agents:fx.agents,maxCycles:3,mode:'card',judge:fx.judge,facts:fx.facts,stances:fx.stances});
 for(const s of fx.speeches){const m=store.message(r,fx.agents[s.side==='A'?0:1],'argument',s.argument);m.meta={ref:s.ref,side:s.side,beat:s.beat,claim:s.claim,rebuttal:s.rebuttal,concessions:s.concessions,bottomLine:s.bottomLine,missing:[]};}
 return {r,store};
}
const tmp=()=>mkdtempSync(path.join(tmpdir(),'echo-'));

for(const id of REAL){
 test(`echo ${id}: 真实编辑输出 → B 方「复读让步」被剔除，A 方真让步保留，卡片仍按原规则产出`,()=>{
  const fx=load(id),dir=tmp();try{
   const {r}=roundOf(fx,dir);
   const [a,b]=fx.editor.concessions;assert.equal(a.by,'A');assert.equal(b.by,'B');
   // 故障复现前提：这条 B 方「让步」的引文本身都对得上（这正是旧核验漏掉它的原因）。
   assert.equal(b.opponentRef,'A3');assert.equal(b.acceptRef,'B3');
   assert.ok(fx.recordedCard.concessions.some(x=>x.by==='B'),'旧版本确实把它收录进了卡片');
   const v=verifyConcession(r,b);assert.equal(v.ok,false);assert.match(v.why,ECHO);
   assert.equal(verifyConcession(r,a).ok,true,'A 承认 B 的论点是真让步');
   const card=buildCard(r,fx.editor);
   assert.deepEqual(card.concessions.map(x=>`${x.by}:${x.opponentRef}->${x.acceptRef}`),[`A:${a.opponentRef}->A3`]);
   assert.equal(card.rejected.length,1);assert.equal(card.rejected[0].by,'B');assert.match(card.rejected[0].why,ECHO);
   assert.equal(card.complete,true,'被剔除的让步按既有规则进 rejected，不影响三拍完整性');
   // 与编辑给出的顺序无关
   const rev=buildCard(r,{...fx.editor,concessions:[b,a]});assert.deepEqual(rev.concessions.map(x=>x.by),['A']);assert.match(rev.rejected[0].why,ECHO);
  }finally{rmSync(dir,{recursive:true,force:true});}
 });

 test(`echo ${id}: 复读的承认原文即使配上 A3 里非让步的句子，也会因为复读对方让步被剔除`,()=>{
  const fx=load(id),dir=tmp();try{
   const {r}=roundOf(fx,dir);const b=fx.editor.concessions[1];
   const a3=fx.speeches.find(s=>s.ref==='A3');
   const other=a3.bottomLine.slice(0,30);// A3 的底线：不是让步
   const v=verifyConcession(r,{...b,opponentQuote:other});assert.equal(v.ok,false);assert.match(v.why,/复读对方/);
  }finally{rmSync(dir,{recursive:true,force:true});}
 });

 test(`echo ${id}: 引擎全流程回放真实发言与编辑输出 → 卡上只剩 A 方让步`,async()=>{
  const fx=load(id),dir=tmp();
  const by=Object.fromEntries(fx.speeches.map(s=>[s.ref,s]));
  const store=new DebateStore(path.join(dir,'r.json'));
  const engine=new DebateEngine(store,async(agent,p)=>{
   if(p.includes('你是独立编辑'))return '```json\n'+JSON.stringify(fx.editor)+'\n```';
   const side=p.match(/你是 ([AB]) 方辩手/)[1],beat=p.match(/当前第 (\d)\/3 拍/)[1];const s=by[side+beat];
   return JSON.stringify({claim:s.claim,rebuttal:s.rebuttal,argument:s.argument,concessions:s.concessions,bottomLine:s.bottomLine});});
  try{
   const r=store.create({topic:fx.topic,agents:fx.agents,maxCycles:3,mode:'card',judge:fx.judge,facts:fx.facts,stances:fx.stances});
   engine.start(r.id);for(let i=0;i<400&&(engine.jobs.has(r.id)||r.status==='running');i++)await new Promise(q=>setTimeout(q,5));
   assert.equal(r.status,'card');assert.deepEqual(r.card.concessions.map(x=>x.by),['A']);assert.match(r.card.rejected.map(x=>x.why).join(),ECHO);
  }finally{rmSync(dir,{recursive:true,force:true});}
 });

 test(`echo ${id}: 发布前复核同样拦截——旧卡片数据（含复读让步）即使版本号重算也不能导出/发布`,()=>{
  const fx=load(id),dir=tmp();try{
   const {r}=roundOf(fx,dir);
   r.card={...buildCard(r,fx.editor),concessions:fx.recordedCard.concessions};// 模拟旧版本产出的卡
   assert.throws(()=>publicCardData(r),ECHO);
   r.card=buildCard(r,fx.editor);const d=publicCardData(r);assert.deepEqual(d.card.concessions.map(x=>x.by),['A']);
   const hand=structuredClone(d);hand.card.concessions.push(fx.recordedCard.concessions.find(x=>x.by==='B'));hand.version=cardVersion(hand);
   assert.throws(()=>validateCardData(hand),ECHO,'手改 cards/*.json 加回复读让步也会被拒');
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
}

test('echo c3e92d9e: 同一故障在保留卡的跑次里也出现过，当时只因编辑拼错引文才被剔除；引文改成逐字原文后，新核验照样拦下',()=>{
 const fx=load('c3e92d9e'),dir=tmp();try{
  const {r}=roundOf(fx,dir);const [a,b]=fx.editor.concessions;
  const card=buildCard(r,fx.editor);
  assert.deepEqual(card.concessions,fx.recordedCard.concessions,'保留卡的让步与当初出卡结果一致');
  assert.match(card.rejected[0].why,/找不到/);
  const exact='我承认女方陪嫁确实只是返还一部分而非全额，男方父母一下子动用半数养老积蓄也确实面临切实的财务压力。';
  const echoed='我承认女方陪嫁确实只能返还一部分，且男方父母一次性动用半数养老积蓄会带来实际的财务压力';// B3 原文（编辑把「；」改成了「。」）
  assert.ok(fx.speeches.find(s=>s.ref==='A3').argument.includes(exact));assert.ok(fx.speeches.find(s=>s.ref==='B3').argument.includes(echoed));
  const fixed=buildCard(r,{...fx.editor,concessions:[a,{...b,opponentQuote:exact,acceptQuote:echoed}]});
  assert.deepEqual(fixed.concessions.map(x=>x.by),['A']);assert.match(fixed.rejected[0].why,ECHO);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('echo: 不误伤——对方先让步、本方再承认对方另一个论点，照常收录；对方普通论点被复述不算复读',()=>{
 const sp=[{ref:'A1',side:'A',conceded:[]},{ref:'B1',side:'B',conceded:[]},{ref:'A2',side:'A',conceded:[]},{ref:'B2',side:'B',conceded:[]},
  {ref:'A3',side:'A',conceded:['春运来回确实把假期耗掉不少']},{ref:'B3',side:'B',conceded:['父母一年就盼这几天团聚']}];
 const aC={by:'A',opponentRef:'B1',opponentQuote:'春运来回折腾把假期全耗在路上',acceptRef:'A3',acceptQuote:'我承认春运来回确实把假期耗掉不少'};
 const bC={by:'B',opponentRef:'A1',opponentQuote:'回家过年是父母一年里最大的盼头',acceptRef:'B3',acceptQuote:'我承认回家过年是父母一年里最大的盼头，父母一年就盼这几天团聚'};
 assert.equal(echoReason(aC,sp,[aC,bC]),null);assert.equal(echoReason(bC,sp,[aC,bC]),null);
 // 复读：B 把 A3 的让步当成「A 的论点」再承认一遍
 const echo={by:'B',opponentRef:'A3',opponentQuote:'我承认春运来回确实把假期耗掉不少',acceptRef:'B3',acceptQuote:'我承认春运来回会把假期耗掉不少'};
 assert.match(echoReason(echo,sp,[aC]),/对方的让步原文/);
 // 后发生的让步不会反过来算到先让步的一方头上
 assert.equal(echoReason(aC,sp,[aC,echo]),null);
 assert.equal(containment('短','短'),0,'过短的文字不判');
 assert.ok(containment('I admit the train ride eats two days of the holiday','the train ride eats two days of the holiday')>0.9,'英文按词比对');
});

test('echo: 仓库里所有已审核卡片（cards/*.json）都通过新的复读核验',()=>{
 const dir=new URL('../cards/',import.meta.url);const files=readdirSync(dir).filter(f=>f.endsWith('.json'));
 assert.ok(files.length>=2);
 for(const f of files)assert.doesNotThrow(()=>validateCardData(JSON.parse(readFileSync(new URL(f,dir),'utf8')),{onWarn:()=>{}}),f);
});
