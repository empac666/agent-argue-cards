// Synthetic fixtures only; no model calls or publication data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DebateStore,DebateEngine} from '../lib/debate.mjs';
import {publicCardData,validateCardData,cardVersion,renderStaticCard} from '../lib/export.mjs';
import {echoReason} from '../lib/echo.mjs';
const claims={A:['文化谱系决定传承关系','作品的来源值得保留','文化传承无需血缘证明'],B:['独立分类需要讨论门槛','命名应说明判断条件','扩展概念应提出独立标准'],C:['计算结构不能授予身份','数学机制不产生生物分类','函数工具须接受事实检验']};
test('three sides: blind openings, nine speeches, C provenance, quote integrity, missing C3 rejected',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'three-side-'));
 try{
  const store=new DebateStore(path.join(dir,'rounds.json')),seen=[];
  const r=store.create({topic:'三方合成测试',mode:'card',agents:['a','b','c'],judge:'j',stances:['文化传承','独立分类','函数工具']});
  const engine=new DebateEngine(store,async(id,p)=>{
   seen.push(p);
   if(id==='j')return JSON.stringify({sides:Object.fromEntries(['A','B','C'].map(k=>[k,{label:k+'方',stance:claims[k][2]}])),concessions:[],unresolved:{issue:'判断标准的边界',...Object.fromEntries(['A','B','C'].map(k=>['quote'+k,{ref:k+'3',quote:claims[k][2]}]))}});
   const k=p.match(/你是 ([ABC]) 方辩手/)[1],b=Number(p.match(/当前第 (\d)/)[1]);
   return JSON.stringify({claim:claims[k][b-1],argument:k+'方的合成测试说明',rebuttal:b===2?'对其他两方判断前提提出质疑':'',concessions:[],bottomLine:b===3?claims[k][2]:''});
  });
  await engine.run(r,{stop:false});
  assert.equal(r.card.complete,true);assert.equal(r.stances.c,'函数工具');assert.equal(r.card.unresolvedConfirmed,true);
  assert.ok(seen.slice(0,3).every(p=>!p.includes('已记录发言')));
  const d=publicCardData(r);assert.equal(d.speeches.length,9);assert.deepEqual(d.provenance.debaters,['a','b','c']);assert.equal(d.card.unresolved.quotes.length,3);
  assert.match(renderStaticCard(d),/A \/ B \/ C \/ 信息不足/);
  assert.match(renderStaticCard(d,{sourcesHref:'https://example.org/sources'}),/科学来源与观点边界/);
  const changed=structuredClone(d);changed.card.unresolved.quotes[2].quote='虚构的第三方引用';changed.version=cardVersion(changed);
  assert.throws(()=>validateCardData(changed),/引文不在发言 C3/);
  const missing=structuredClone(d);missing.speeches=missing.speeches.filter(s=>s.ref!=='C3');missing.version=cardVersion(missing);
  assert.throws(()=>validateCardData(missing),/三拍发言不完整/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('third-side echo is checked against the actual quoted opponent',()=>{
 const point='扩展概念应提出独立标准';
 const speeches=[{ref:'A1',side:'A',conceded:[]},{ref:'C2',side:'C',conceded:[point]},{ref:'B3',side:'B',conceded:[]}];
 assert.match(echoReason({by:'B',opponentRef:'C2',opponentQuote:point,acceptRef:'B3',acceptQuote:'我承认'+point},speeches),/让步原文/);
});
