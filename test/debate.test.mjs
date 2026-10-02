import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DebateStore,DebateEngine} from '../lib/debate.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function settle(round,engine){for(let i=0;i<200;i++){if(!engine.jobs.has(round.id)&&round.status!=='running')return;await sleep(10);}throw Error('did not settle');}
function fixture(invoke){const dir=mkdtempSync(path.join(tmpdir(),'argue-test-')),store=new DebateStore(path.join(dir,'rounds.json')),engine=new DebateEngine(store,invoke);return {dir,store,engine};}
test('same proposal requires every agent explicit matching assent',async()=>{
 const f=fixture(async(id,p)=>p.includes('只输出 JSON 对象：{"vote"')?JSON.stringify({vote:'AGREE',version:p.match(/方案版本：(\w+)/)?.[1],reason:'接受'}):JSON.stringify({argument:'可行',proposal:'共同方案 A'}));
 try{const r=f.store.create({topic:'如何做？',agents:['a','b'],maxCycles:2});f.engine.start(r.id);await settle(r,f.engine);assert.equal(r.status,'consensus');assert.equal(Object.keys(r.assents).length,2);assert.equal(r.proposal.text,'共同方案 A');}finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('one objection cannot be overridden by votes or repeated assent from others',async()=>{
 const f=fixture(async(id,p)=>p.includes('只输出 JSON 对象：{"vote"')?JSON.stringify({vote:id==='b'?'OBJECT':'AGREE',version:p.match(/方案版本：(\w+)/)?.[1],reason:'不同意'}):JSON.stringify({argument:'看法',proposal:'方案 A'}));
 try{const r=f.store.create({topic:'选择',agents:['a','b'],maxCycles:1});r.votes.a=999;f.engine.start(r.id);await settle(r,f.engine);assert.equal(r.status,'unresolved');assert.equal(r.assents.b.vote,'OBJECT');}finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('proposal revision resets old assents and preserves record',async()=>{
 let n=0;const f=fixture(async(id,p)=>{if(p.includes('只输出 JSON 对象：{"vote"'))return JSON.stringify({vote:id==='b'&&n<2?'OBJECT':'AGREE',version:p.match(/方案版本：(\w+)/)?.[1],reason:'review'});if(id==='b')n++;return JSON.stringify({argument:'revision',proposal:n>=2?'方案 B':'方案 A'});});
 try{const r=f.store.create({topic:'选择',agents:['a','b'],maxCycles:3});f.engine.start(r.id);await settle(r,f.engine);assert.equal(r.status,'consensus');assert.equal(r.proposal.text,'方案 B');assert.equal(r.assents.a.version,r.proposal.version);assert.ok(r.messages.some(m=>m.kind==='proposal'&&m.content==='方案 A'));}finally{rmSync(f.dir,{recursive:true,force:true});}
});
