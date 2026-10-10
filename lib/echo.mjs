// 让步「复读」核验（出卡时 buildCard 与发布前 validateCardData 共用，纯函数、无依赖）。
// 真实故障（彩礼 0069aa79 / 9a8dd9ce）：A3 承认了 B 的论点（A 让步）；B3 只是把 A3 这句让步换个说法复述一遍，
// 编辑却把它记成「B 承认了 A3 的论点」——opponentQuote 引的是 A 的让步原文，acceptQuote 是对这句让步的复读。
// 原文、说话人、先后都对，旧核验查不出；语义上是 B 在「承认」自己的论点（自己让自己）。
// 判据（只比对「对方已做出的让步」，不比对对方的普通论点——真让步本来就会复述对方论点，不能一概判为复制）：
//  1) 所谓「对方论点」其实是对方的让步原文：opponentQuote 与对方的让步文字（发言的自报让步，或卡上已核验的对方让步的 acceptQuote）高度重合；
//  2) 本方的承认原文复读了对方此前已做出的让步：acceptQuote 与上述对方让步文字高度重合。
// 只认「承认原文所在发言之前」的对方让步，避免把后来者的复读反过来算到先让步的一方头上。
const ACCEPT_WORDS=/我(?:也)?(?:承认|接受|同意|认可|认同)|承认|的确|确实|\b(?:i|we)\s+(?:also\s+)?(?:admit|accept|agree|concede)(?:\s+that)?\b/giu;
const tokens=s=>String(s??'').toLowerCase().replace(ACCEPT_WORDS,' ').replace(/[\p{P}\p{S}]+/gu,' ').match(/[\u3400-\u9fff]|[\p{L}\p{N}]+/gu)||[];
// 相邻两个记号组成的片段集合：中文按字、英文按词。
function shingles(s){const t=tokens(s),o=new Set();if(t.length===1)o.add(t[0]);for(let i=0;i+1<t.length;i++)o.add(t[i]+'\u0001'+t[i+1]);return o;}
// q 的片段有多少比例出现在 t 中（0–1）。q 太短（<4 个片段）不判，返回 0。
export function containment(q,t){const a=shingles(q);if(a.size<4)return 0;const b=shingles(t);let n=0;for(const x of a)if(b.has(x))n++;return n/a.size;}
export const ECHO_POINT_MIN=0.6,ECHO_ACCEPT_MIN=0.5;
// c：{by,opponentRef,opponentQuote,acceptRef,acceptQuote}；speeches：按发言先后排列的 [{ref,side,conceded:[]}]；
// accepted：已通过基础核验的让步（任一方），用于取对方已做出的让步原文。返回拒收理由，或 null。
export function echoReason(c,speeches,accepted=[]){
 const pos=ref=>speeches.findIndex(s=>s.ref===ref),at=pos(c.acceptRef);if(at<0)return null;
 const other=speeches.find(s=>s.ref===c.opponentRef)?.side;
 const prior=[...speeches.filter((s,i)=>s.side===other&&i<at).flatMap(s=>s.conceded||[]),
  ...accepted.filter(x=>x&&x.by===other&&pos(x.acceptRef)>=0&&pos(x.acceptRef)<at).map(x=>x.acceptQuote)].filter(Boolean);
 if(!prior.length)return null;
 const best=q=>Math.max(0,...prior.map(t=>containment(q,t)));
 if(best(c.opponentQuote)>=ECHO_POINT_MIN)return '所谓「对方论点」其实是对方的让步原文（对方承认的是本方论点），不能再记成本方让步';
 if(best(c.acceptQuote)>=ECHO_ACCEPT_MIN)return '承认原文是在复读对方已做出的让步，不是本方的让步';
 return null;
}
