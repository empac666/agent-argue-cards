// 演示模式（node server.mjs --demo）：不需要任何 API Key 或 CLI。
// - 打开即可看到两局预录的真实辩论与站队卡（demo/rounds.json，来自真实模型运行，已去掉站队记录）；
// - 新开的站队卡由「预设台词」演示辩手完成，流程/核验/出卡与真实一致，但内容是固定模板，不是模型生成。
import {copyFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DEMO_DATA=path.join(root,'demo','rounds.json');
// 每次启动复制一份到临时目录，演示里的发布/新辩论不会改动仓库里的预录数据。
export function demoDataPath(){const dir=mkdtempSync(path.join(tmpdir(),'agent-argue-demo-'));const p=path.join(dir,'rounds.json');copyFileSync(DEMO_DATA,p);return p;}
const why='演示模式：预设台词，不调用任何模型';
export async function demoAgents(){return [
 {id:'demo-a',name:'演示辩手 A（预设台词）',available:true,reason:why},
 {id:'demo-b',name:'演示辩手 B（预设台词）',available:true,reason:why},
 {id:'demo-editor',name:'演示编辑（预设整理）',role:'JUDGE',available:true,reason:why}];}
const SPEECH={
 A:{1:{claim:'长期算下来，A 方的做法最少扯皮。',argument:'长期算下来，A 方的做法最少扯皮。一次说清楚，以后每次都照着来，谁也不用猜。'},
  2:{claim:'感受可以照顾，但规矩得先定下来。',rebuttal:'只讲感受不讲规矩，下次还得再吵一遍。',argument:'只讲感受不讲规矩，下次还得再吵一遍。感受可以照顾，但规矩得先定下来。'},
  3:{claim:'先定规矩，再留例外。',argument:'我承认规矩定死了确实可能伤感情，可以留例外。但大方向还得按规矩来。',concessions:['规矩要留例外'],bottomLine:'大方向必须先按规矩定下来。'}},
 B:{1:{claim:'眼下每个人的感受，比长期省事更重要。',argument:'眼下每个人的感受，比长期省事更重要。家里的事不是做账，算得太清反而生分。'},
  2:{claim:'规矩是人定的，不能比人还大。',rebuttal:'规矩定死了，遇到特殊情况反而更伤感情。',argument:'规矩定死了，遇到特殊情况反而更伤感情。规矩是人定的，不能比人还大。'},
  3:{claim:'具体情况具体商量。',argument:'我不认同先定规矩，具体情况具体商量才公平。',concessions:[],bottomLine:'每次都要按当下的具体情况商量。'}}};
const EDIT={sides:{A:{label:'规矩派',stance:'先定规矩，再给特殊情况留例外'},B:{label:'商量派',stance:'不定死规矩，每次按具体情况商量'}},
 concessions:[{by:'A',point:'规矩派承认规矩定死可能伤感情，同意留例外',opponentRef:'B2',opponentQuote:'规矩定死了，遇到特殊情况反而更伤感情',acceptRef:'A3',acceptQuote:'我承认规矩定死了确实可能伤感情'}],
 unresolved:{issue:'该先定一条大家都照着来的规矩，还是每次按具体情况商量',quoteA:{ref:'A3',quote:'大方向必须先按规矩定下来'},quoteB:{ref:'B3',quote:'每次都要按当下的具体情况商量'}}};
export async function demoInvoke(id,prompt){
 await new Promise(r=>setTimeout(r,Number(process.env.ARGUE_DEMO_DELAY_MS??600)));
 if(id==='demo-editor'||prompt.startsWith('你是独立编辑'))return JSON.stringify(EDIT);
 const side=(prompt.match(/^你是 ([AB]) 方辩手/)||[])[1],beat=Number((prompt.match(/当前第 (\d)\/3 拍/)||[])[1]);
 if(!side||!SPEECH[side][beat])throw new Error('演示模式只支持「站队卡」模式');
 return JSON.stringify(SPEECH[side][beat]);
}
