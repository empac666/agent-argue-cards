// 站队卡立场核验：只比核心主张与底线，正文里的引用、反驳不作为来源。
import {containment} from './echo.mjs';
export const COPY_MIN=0.70,COPY_MARGIN=0.20,SELF_POINT_MIN=0.65,SELF_POINT_MARGIN=0.20;
const FIELDS=['claim','bottomLine'],LABEL={claim:'核心主张',bottomLine:'底线'};
const normalized=s=>String(s??'').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'');
const units=s=>String(s??'').match(/[\u3400-\u9fff]|[\p{L}\p{N}]+/gu)||[];
// 四字/词的完全相同短句也认作照抄；containment 本身至少需要四个二元片段。
const overlap=(q,t)=>normalized(q)===normalized(t)&&units(q).length>=4?1:containment(q,t);
function best(q,speeches,compare=overlap){
 let hit={score:0};for(const s of speeches)for(const field of FIELDS){const score=compare(q,s[field]);if(score>hit.score)hit={score,ref:s.ref,refField:field};}return hit;
}
export function copyReason(speech,prior){
 for(const field of FIELDS){
  const opp=best(speech[field],prior.filter(s=>s.side!==speech.side)),own=best(speech[field],prior.filter(s=>s.side===speech.side)).score;
  if(opp.score>=COPY_MIN&&opp.score-own>=COPY_MARGIN)return {field,ref:opp.ref,refField:opp.refField,score:opp.score,own,why:`${speech.ref} 的${LABEL[field]}与对方 ${opp.ref} 的${LABEL[opp.refField]}高度重合（照抄对方）`};
 }return null;
}
export function selfPointReason(c,speeches,stances={}){
 const at=speeches.findIndex(s=>s.ref===c.opponentRef);if(at<0)return null;
 const prior=speeches.slice(0,at),other=c.by==='A'?'B':'A';
 const score=side=>Math.max(best(c.opponentQuote,prior.filter(s=>s.side===side),containment).score,containment(c.opponentQuote,stances?.[side]));
 const own=score(c.by),oppOwn=score(other);
 return own>=SELF_POINT_MIN&&own-oppOwn>=SELF_POINT_MARGIN?'所谓「对方论点」其实是让步方自己此前的主张或立场（自己让自己），不能记成让步':null;
}
