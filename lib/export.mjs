// 站队卡导出：把一局 card 辩论变成「可公开的卡片数据」，再渲染成三种发布物：
// 1) 自包含静态卡片页（数据内嵌，零后端调用，带 OG 元信息，可放 GitHub Pages）；
// 2) 微信长图用的 1080px 页面；3) 1200×630 的 OG 预览图页面。
// 只导出白名单字段：不含匿名站队标识、票数明细、耗时、被剔除的让步、本机路径或原始回包。
import {createHash} from 'node:crypto';
const clean=s=>String(s??'').trim();
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// JSON 嵌进 <script> 时防止 </script> 截断与 U+2028/2029。
const jsonForScript=o=>JSON.stringify(o).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const isCJK=s=>/[\u3400-\u9fff]/.test(String(s));

export const UI={
 zh:{brand:'群聊站队卡',noVerdict:'不判输赢',complete:'三拍完整',incomplete:'内容不完整',facts:'背景',bottomLine:'底线',conceded:'两边已认的账',noConcession:'未发现可核验的明确让步',crux:'还没谈拢的一句',noCrux:'双方已没有明确分歧',cruxUnconfirmed:'未决点未确认',lastClaim:'最后主张',replay:'看完整三拍回放',beat:'第 {n} 拍',reply:'回 A / B / 信息不足 + 一句理由',replyHint:'在群里回复站队：',debaters:'辩手',editor:'编辑',provenance:'引用出处经程序校验，语义由模型整理，不代表任何结论。',translated:'译文',original:'原文',viewOriginal:'看原文',viewTranslation:'看译文',index:'站队卡合集',cardNo:'卡号',version:'版本',respondsTo:'回应',side:'站{label}',unsure:'信息不足',voted:'你已站队，可以改：',pick:'你站哪边？',tally:'匿名站队记录：{a} {na} · {b} {nb} · 信息不足 {u}（不代表独立人数）',tallyHidden:'站队后可见大家怎么站。',comments:'留言说说你站哪边',demo:'演示卡：预设台词，不是 AI 针对本题的真实辩论',voteFailed:'没提交成功：'},
 en:{brand:'Side-Taking Card',noVerdict:'No winner declared',complete:'All 3 beats',incomplete:'Incomplete',facts:'Context',bottomLine:'Bottom line',conceded:'What each side conceded',noConcession:'No verifiable concession found',crux:'The one thing still unresolved',noCrux:'No remaining disagreement',cruxUnconfirmed:'Crux not confirmed',lastClaim:'Final claim',replay:'Full 3-beat replay',beat:'Beat {n}',reply:'Reply A / B / Not sure + one reason',replyHint:'Take a side in the chat:',debaters:'Debaters',editor:'Editor',provenance:'Quote provenance is checked by code; wording is summarised by a model. Not a verdict.',translated:'Translation',original:'Original',viewOriginal:'Original',viewTranslation:'Translation',index:'Side-Taking Cards',cardNo:'Card',version:'ver',respondsTo:'replying to',side:'Side with {label}',unsure:'Not sure',voted:'You picked a side (you can change it):',pick:'Which side are you on?',tally:'Anonymous picks: {a} {na} · {b} {nb} · not sure {u} (not unique people)',tallyHidden:'Pick a side to see how others picked.',comments:'Comment with your side',demo:'DEMO card: scripted lines, not a real AI debate on this topic',voteFailed:'Not saved: '}
};
const t=(lang,key,vars={})=>String((UI[lang]||UI.zh)[key]).replace(/\{(\w+)\}/g,(_,k)=>vars[k]??'');

// 可公开卡片数据（schema 1）。round 必须是已生成卡片的 card 模式辩论。
export function publicCardData(r){
 if(!r||r.mode!=='card'||!r.card)throw new Error('只有已生成卡片的 card 模式辩论可以导出');
 const c=r.card;
 const body={schema:1,id:r.id,short:r.id.slice(0,8),topic:clean(r.topic),facts:clean(r.facts),lang:isCJK(r.topic)?'zh':'en',createdAt:c.createdAt||r.createdAt,
  card:{complete:!!c.complete,
   sides:c.sides.map(s=>({key:s.key,label:clean(s.label),stance:clean(s.stance),bottomLine:clean(s.bottomLine),finalClaim:clean(s.finalClaim),agent:clean(s.agent)})),
   concessions:(c.concessions||[]).map(x=>({by:x.by,point:clean(x.point),opponentRef:x.opponentRef,opponentQuote:clean(x.opponentQuote),acceptRef:x.acceptRef,acceptQuote:clean(x.acceptQuote)})),
   concessionNote:clean(c.concessionNote),unresolved:c.unresolved?{issue:clean(c.unresolved.issue),quotes:(c.unresolved.quotes||[]).map(q=>({ref:q.ref,quote:clean(q.quote)}))}:null,
   unresolvedConfirmed:!!c.unresolvedConfirmed,issues:(c.issues||[]).map(clean)},
  speeches:r.messages.filter(m=>m.kind==='argument'&&m.status==='completed'&&m.meta?.ref).map(m=>({ref:m.meta.ref,side:m.meta.side,beat:m.meta.beat,claim:clean(m.meta.claim),rebuttal:clean(m.meta.rebuttal),content:clean(m.content),bottomLine:clean(m.meta.bottomLine),conceded:(m.meta.concessions||[]).map(clean).filter(Boolean)})),
  provenance:{debaters:r.agents.slice(0,2),editor:r.judge||null}};
 return validateCardData({...body,version:cardVersion(body)});
}
export function cardVersion(body){const {version,translations,...rest}=body;return createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0,12);}
export const LANGS=['zh','en'];
// 译文自身的版本：对译文内容（不含 version）做哈希。人工改译文后必须用 `export-cards.mjs stamp` 重新盖章，改了没盖章的译文校验不过。
export function translationVersion(t){const {version,...rest}=t||{};return createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0,12);}
// 从 cards/*.json 读入的数据按白名单逐字段重建：未知字段一律拒绝（防止内部备注/凭据混进公开页），
// 类型、长度、引用编号、语言键都校验；返回的是重建后的对象，渲染只用它。
// restamp：仅供 `export-cards.mjs stamp` 在人工审核译文后使用——把译文绑到当前版本并按规范化内容重算译文版本。
export function validateCardData(d,{onWarn=m=>console.warn(m),restamp=false}={}){
 const id=d?.id;const bad=m=>{throw new Error(`卡片数据不合法（${typeof id==='string'?id.slice(0,40):'?'}）：${m}`);};
 const obj=(o,w)=>{if(!o||typeof o!=='object'||Array.isArray(o))bad(`${w} 必须是对象`);return o;};
 const only=(o,keys,w)=>{obj(o,w);const extra=Object.keys(o).filter(k=>!keys.includes(k));if(extra.length)bad(`${w} 含未知字段 ${extra.join(',')}`);return o;};
 const str=(v,w,max,{req=false}={})=>{if(v===undefined||v===null){if(req)bad(`缺少 ${w}`);return '';}if(typeof v!=='string')bad(`${w} 必须是字符串`);if(v.length>max)bad(`${w} 超过 ${max} 字`);if(req&&!v.trim())bad(`缺少 ${w}`);return v;};
 const arr=(v,w,max)=>{if(!Array.isArray(v))bad(`${w} 必须是数组`);if(v.length>max)bad(`${w} 超过 ${max} 项`);return v;};
 const REF=/^[AB][1-3]$/,side=(v,w)=>{if(v!=='A'&&v!=='B')bad(`${w} 只能是 A/B`);return v;},ref=(v,w)=>{if(typeof v!=='string'||!REF.test(v))bad(`${w} 不是合法发言编号`);return v;};
 only(d,['schema','id','short','topic','facts','lang','createdAt','card','speeches','provenance','version','translations'],'顶层');
 if(d.schema!==1)bad('schema 必须为 1');
 if(typeof id!=='string'||!/^[a-f0-9-]{8,64}$/.test(id))bad('id 格式不对');
 if(d.short!==id.slice(0,8))bad('short 必须是 id 前 8 位');
 if(!LANGS.includes(d.lang))bad(`lang 只能是 ${LANGS.join('/')}`);
 const c=only(d.card,['complete','sides','concessions','concessionNote','unresolved','unresolvedConfirmed','issues'],'card');
 const sides=arr(c.sides,'sides',2);if(sides.length!==2)bad('sides 必须两项');
 const out={schema:1,id,short:d.short,topic:str(d.topic,'topic',200,{req:true}),facts:str(d.facts,'facts',600),lang:d.lang,createdAt:str(d.createdAt,'createdAt',40),
  card:{complete:c.complete===true,
   sides:sides.map((x,i)=>{only(x,['key','label','stance','bottomLine','finalClaim','agent'],`sides[${i}]`);if(x.key!==['A','B'][i])bad(`sides[${i}].key 必须是 ${['A','B'][i]}`);
    return {key:x.key,label:str(x.label,'label',40,{req:true}),stance:str(x.stance,'stance',300),bottomLine:str(x.bottomLine,'bottomLine',300),finalClaim:str(x.finalClaim,'finalClaim',400),agent:str(x.agent,'agent',64)};}),
   concessions:arr(c.concessions,'concessions',8).map((x,i)=>{only(x,['by','point','opponentRef','opponentQuote','acceptRef','acceptQuote'],`concessions[${i}]`);
    return {by:side(x.by,'by'),point:str(x.point,'point',200,{req:true}),opponentRef:ref(x.opponentRef,'opponentRef'),opponentQuote:str(x.opponentQuote,'opponentQuote',200,{req:true}),acceptRef:ref(x.acceptRef,'acceptRef'),acceptQuote:str(x.acceptQuote,'acceptQuote',200,{req:true})};}),
   concessionNote:str(c.concessionNote,'concessionNote',200),
   unresolved:c.unresolved===null||c.unresolved===undefined?null:(only(c.unresolved,['issue','quotes'],'unresolved'),{issue:str(c.unresolved.issue,'issue',200),quotes:arr(c.unresolved.quotes,'quotes',2).map((q,i)=>(only(q,['ref','quote'],`quotes[${i}]`),{ref:ref(q.ref,'ref'),quote:str(q.quote,'quote',200,{req:true})}))}),
   unresolvedConfirmed:c.unresolvedConfirmed===true,issues:arr(c.issues||[],'issues',10).map((x,i)=>str(x,`issues[${i}]`,300))},
  speeches:arr(d.speeches,'speeches',6).map((x,i)=>{only(x,['ref','side','beat','claim','rebuttal','content','bottomLine','conceded'],`speeches[${i}]`);if(![1,2,3].includes(x.beat))bad('beat 只能是 1–3');
   if(x.ref!==`${x.side}${x.beat}`)bad(`speeches[${i}] 的编号 ${String(x.ref).slice(0,4)} 与 side/beat 不符`);
   return {ref:ref(x.ref,'ref'),side:side(x.side,'side'),beat:x.beat,claim:str(x.claim,'claim',400),rebuttal:str(x.rebuttal,'rebuttal',1200),content:str(x.content,'content',2000,{req:true}),bottomLine:str(x.bottomLine,'bottomLine',300),conceded:arr(x.conceded||[],'conceded',4).map(c=>str(c,'conceded',300))};}),
  provenance:(only(d.provenance,['debaters','editor'],'provenance'),{debaters:arr(d.provenance.debaters,'debaters',2).map(x=>str(x,'debater',64,{req:true})),editor:d.provenance.editor===null?null:str(d.provenance.editor,'editor',64)})};
 // 引文复核：手改 cards/*.json 也不能编造或张冠李戴——每段引文都必须逐字出自所指发言，且说话人、先后顺序正确（与出卡时的核验一致）。
 const refs=new Map();for(const sp of out.speeches){if(refs.has(sp.ref))bad(`发言编号 ${sp.ref} 重复`);refs.set(sp.ref,sp);}
 const ws=x=>String(x??'').replace(/\s+/g,' ').trim();
 const quoted=(r,q,w)=>{const sp=refs.get(r);if(!sp)bad(`${w} 指向不存在的发言 ${r}`);if(![sp.claim,sp.rebuttal,sp.content,sp.bottomLine,...sp.conceded].some(f=>ws(f).includes(ws(q))))bad(`${w} 的引文不在发言 ${r} 中`);return sp;};
 const pos=r=>out.speeches.findIndex(x=>x.ref===r);
 out.card.concessions.forEach((x,i)=>{const o=quoted(x.opponentRef,x.opponentQuote,`concessions[${i}].opponent`),a=quoted(x.acceptRef,x.acceptQuote,`concessions[${i}].accept`);
  if(o.side===x.by||a.side!==x.by)bad(`concessions[${i}] 的说话人与 by 不符`);if(pos(x.acceptRef)<=pos(x.opponentRef))bad(`concessions[${i}] 的承认早于对方论点`);});
 out.card.unresolved?.quotes.forEach((q,i)=>quoted(q.ref,q.quote,`unresolved.quotes[${i}]`));
 if(cardVersion(out)!==d.version)bad('version 与内容不符（内容被改过但没重算版本）');
 out.version=d.version;
 if(d.translations!==undefined){
  const tr=obj(d.translations,'translations');out.translations={};
  for(let [lang,t] of Object.entries(tr)){
   if(!LANGS.includes(lang)||lang===out.lang)bad(`translations 的语言键 ${JSON.stringify(lang).slice(0,20)} 不合法`);
   only(t,['version','sourceVersion','note','topic','facts','sides','concessions','unresolved'],`translations.${lang}`);
   // 译文绑定原文版本：原文一改，旧译文失效——只丢弃这份译文并警告，不连累原文卡片下架。
   if(restamp)t={...t,sourceVersion:out.version};
   if(t.sourceVersion!==out.version){onWarn(`卡片 ${out.short} 的 ${lang} 译文对应旧版本 ${String(t.sourceVersion).slice(0,12)}，已忽略；请重新翻译审核后 stamp`);continue;}
   // 先规范化再算哈希：盖章、校验、嵌入页面用的是同一份表示，内嵌 JSON 再校验也一致。
   const n={sourceVersion:t.sourceVersion,note:str(t.note,'note',300),topic:str(t.topic,'topic',300),facts:str(t.facts,'facts',900),
    sides:arr(t.sides||[],'sides',2).map((x,i)=>(only(x,['label','stance','bottomLine'],`translations.sides[${i}]`),{label:str(x.label,'label',60),stance:str(x.stance,'stance',450),bottomLine:str(x.bottomLine,'bottomLine',450)})),
    concessions:arr(t.concessions||[],'concessions',8).map((x,i)=>(only(x,['point'],`translations.concessions[${i}]`),{point:str(x.point,'point',300)})),
    unresolved:t.unresolved?(only(t.unresolved,['issue'],'translations.unresolved'),{issue:str(t.unresolved.issue,'issue',300)}):null};
   const tv=translationVersion(n);
   if(!restamp&&t.version!==tv)bad(`translations.${lang}.version 与译文内容不符（译文被改过但没重新 stamp）`);
   out.translations[lang]={version:tv,...n};
  }
  if(!Object.keys(out.translations).length)delete out.translations;
 }
 return out;
}
function view(d,lang){
 // 有译文且请求该语言时用译文字段覆盖展示文字；逐字引文始终保留原文。
 const tr=lang!==d.lang?d.translations?.[lang]:null;
 const sides=d.card.sides.map((s,i)=>({...s,label:tr?.sides?.[i]?.label||s.label,stance:tr?.sides?.[i]?.stance||s.stance,bottomLine:tr?.sides?.[i]?.bottomLine||s.bottomLine}));
 const concessions=d.card.concessions.map((x,i)=>({...x,point:tr?.concessions?.[i]?.point||x.point}));
 const unresolved=d.card.unresolved?{...d.card.unresolved,issue:tr?.unresolved?.issue||d.card.unresolved.issue}:null;
 return {topic:tr?.topic||d.topic,facts:tr?.facts||d.facts,sides,concessions,unresolved,translated:!!tr};
}
const isDemo=d=>(d.provenance?.debaters||[]).some(a=>String(a).startsWith('demo-'));
const nameOf=(v,k)=>v.sides.find(s=>s.key===k)?.label||k;
const STYLE=`:root{--ink:#16130f;--muted:#6f675d;--paper:#f6f1e7;--card:#fffdf8;--a:#c8402f;--b:#1f5fa8;--hi:#ffd84a;--line:#e3dccd}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Noto Sans SC",sans-serif;-webkit-text-size-adjust:100%}
a{color:inherit}main{max-width:440px;margin:0 auto;padding:14px 12px 40px}
.poster{background:var(--card);border:2px solid var(--ink);border-radius:14px;padding:16px;box-shadow:4px 4px 0 var(--ink)}
.kicker{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted);gap:8px}
.badge{border:1px solid currentColor;border-radius:999px;padding:1px 8px;font-size:11px;white-space:nowrap}.badge.warn{color:#9a5b00;background:#fff4d6}
h1{font-size:22px;line-height:1.3;margin:8px 0 4px;font-weight:800}.facts{font-size:12.5px;color:var(--muted);margin:0 0 10px}
.vs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}.side{border-radius:10px;padding:10px;color:#fff}.side.A{background:var(--a)}.side.B{background:var(--b)}
.side .label{font-weight:800;font-size:16px}.side .stance{font-size:13px;margin-top:4px}.side .bl{font-size:12px;margin-top:6px;border-top:1px solid rgba(255,255,255,.4);padding-top:5px}
h2{font-size:13px;letter-spacing:.06em;margin:14px 0 6px;color:var(--muted)}
.conc{border-left:4px solid var(--line);padding:4px 0 4px 10px;margin:6px 0}.conc.A{border-color:var(--a)}.conc.B{border-color:var(--b)}.conc .pt{font-weight:650}
.q{font-size:12px;color:var(--muted);margin-top:2px}.none{font-size:13px;color:var(--muted);font-style:italic}
.crux{background:var(--hi);border:2px solid var(--ink);border-radius:10px;padding:10px 12px}.crux .issue{font-size:17px;font-weight:800;line-height:1.35}.crux .q{color:#3b3428}
.foot{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--muted);margin-top:12px}
.box{margin-top:14px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}.box p{margin:0 0 8px;font-weight:700}
.reply{font-size:16px;font-weight:800}
.btns{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}button{font:inherit;border:2px solid var(--ink);border-radius:10px;padding:10px 4px;background:#fff;font-weight:700;cursor:pointer;min-height:44px}
button.A{color:var(--a)}button.B{color:var(--b)}button.on{background:var(--ink);color:#fff}.tally{font-size:13px;color:var(--muted);margin-top:8px}
details{margin-top:14px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px}summary{font-weight:700;cursor:pointer}
.sp{margin:10px 0;padding-top:8px;border-top:1px dashed var(--line);font-size:13.5px}.sp b{font-size:12px}
.demo{background:#16130f;color:#ffd84a;font-weight:800;text-align:center;border-radius:8px;padding:6px;margin-bottom:10px}.prov{font-size:11px;color:var(--muted);margin-top:10px}.lang{font-size:12px;text-align:right;margin-bottom:6px}`;

function posterHtml(d,v,lang){
 const c=d.card,L=k=>t(lang,k);
 const conc=v.concessions.length?v.concessions.map(x=>`<div class="conc ${esc(x.by)}"><div class="pt">${esc(nameOf(v,x.by))}：${esc(x.point)}</div><div class="q">「${esc(x.acceptQuote)}」（${esc(x.acceptRef)}，${L('respondsTo')} ${esc(x.opponentRef)}）</div></div>`).join(''):`<div class="none">${L('noConcession')}</div>`;
 let crux;
 if(v.unresolved?.issue)crux=`<div class="issue">${esc(v.unresolved.issue)}</div>${v.unresolved.quotes.map(q=>`<div class="q">${esc(nameOf(v,q.ref[0]))}：「${esc(q.quote)}」</div>`).join('')}`;
 else if(c.unresolvedConfirmed&&!c.unresolved)crux=`<div class="issue">${L('noCrux')}</div>`;
 else crux=`<div class="issue">${L('cruxUnconfirmed')}</div>${v.sides.filter(s=>s.finalClaim).map(s=>`<div class="q">${esc(s.label)} ${L('lastClaim')}：${esc(s.finalClaim)}</div>`).join('')}`;
 return `<section class="poster">
${isDemo(d)?`<div class="demo">${L('demo')}</div>`:''}<div class="kicker"><span>${L('brand')} · ${L('noVerdict')}${v.translated?` · ${L('translated')}`:''}</span><span class="badge${c.complete?'':' warn'}">${c.complete?L('complete'):L('incomplete')}</span></div>
<h1>${esc(v.topic)}</h1>${v.facts?`<p class="facts">${L('facts')}：${esc(v.facts)}</p>`:''}
<div class="vs">${v.sides.map(s=>`<div class="side ${esc(s.key)}"><div class="label">${esc(s.label)}</div><div class="stance">${esc(s.stance)}</div>${s.bottomLine?`<div class="bl">${L('bottomLine')}：${esc(s.bottomLine)}</div>`:''}</div>`).join('')}</div>
<h2>${L('conceded')}</h2>${conc}
<h2>${L('crux')}</h2><div class="crux">${crux}</div>
${!c.complete&&c.issues.length?`<div class="q">${esc(c.issues.join('；'))}</div>`:''}
<div class="foot"><span>${L('cardNo')} ${esc(d.short)} · ${L('version')} ${esc(d.version)}${v.translated?` · ${L('translated')} ${esc(d.translations[lang].version)}`:''}</span><span>Agent Argue</span></div>
</section>`;
}
// 自包含静态卡片页。opts: {lang, baseUrl, ogImage, indexHref, voteEndpoint, giscus:{repo,repoId,category,categoryId,mapping?}, altHref}
// giscus.mapping='card'：按卡片映射（原文题目 + 卡号作为讨论标题），中英文页共用同一个讨论串；其余值原样交给 giscus（如 pathname）。
export function renderStaticCard(d,opts={}){
 const lang=opts.lang||d.lang,v=view(d,lang),L=k=>t(lang,k);
 const pageUrl=opts.baseUrl?new URL(opts.path||`cards/${d.id}${lang===d.lang?'':'.'+lang}.html`,opts.baseUrl).href:'';
 const og=opts.ogImage?(opts.baseUrl?new URL(opts.ogImage,opts.baseUrl).href:opts.ogImage):'';
 const desc=v.unresolved?.issue?`${t(lang,'crux')}${lang==='en'?': ':'：'}${v.unresolved.issue}`:`${v.sides[0].label} vs ${v.sides[1].label}`;
 const title=`${v.topic} · ${L('brand')}`;
 const vote=opts.voteEndpoint?`<section class="box" id="vote" data-endpoint="${esc(opts.voteEndpoint)}"><p id="vote-q">${L('pick')}</p><div class="btns">${['A','B'].map(k=>`<button class="${k}" data-side="${k}">${esc(t(lang,'side',{label:nameOf(v,k)}))}</button>`).join('')}<button data-side="unsure">${L('unsure')}</button></div><div class="tally" id="tally">${L('tallyHidden')}</div></section>`
  :`<section class="box"><p>${L('replyHint')}</p><div class="reply">${L('reply')}</div></section>`;
 const g=opts.giscus;
 const giscus=g&&g.repo&&g.repoId&&g.category&&g.categoryId?`<section class="box"><p>${L('comments')}</p><script src="https://giscus.app/client.js" data-repo="${esc(g.repo)}" data-repo-id="${esc(g.repoId)}" data-category="${esc(g.category)}" data-category-id="${esc(g.categoryId)}" data-mapping="${g.mapping==='card'?'specific':esc(g.mapping||'pathname')}"${g.mapping==='card'?` data-term="${esc(`${d.topic} · ${d.short}`)}"`:''} data-loading="lazy" data-strict="1" data-reactions-enabled="1" data-emit-metadata="0" data-input-position="top" data-theme="light" data-lang="${lang==='zh'?'zh-CN':'en'}" crossorigin="anonymous" async></script></section>`
  :`<!-- giscus 未启用：在 site.config.json 里填 giscus.repo/repoId/category/categoryId 后才会嵌入（需要公开仓库并开启 Discussions） -->`;
 const replay=`<details><summary>${L('replay')}（${d.speeches.length}）</summary>${d.speeches.map(s=>`<div class="sp"><b>${esc(s.ref)} · ${esc(nameOf(v,s.side))} · ${esc(t(lang,'beat',{n:s.beat}))}${v.translated?` · ${L('original')}`:''}</b><div>${esc(s.content)}</div>${s.bottomLine?`<div class="q">${L('bottomLine')}：${esc(s.bottomLine)}</div>`:''}</div>`).join('')}</details>`;
 const prov=`<div class="prov">${L('debaters')}：${esc(d.provenance.debaters.join(' vs '))}${d.provenance.editor?` · ${L('editor')}：${esc(d.provenance.editor)}`:''} · ${L('provenance')}</div>`;
 const voteSrc=opts.voteEndpoint?`(function(){var box=document.getElementById('vote');if(!box)return;var ep=box.getAttribute('data-endpoint'),T=${jsonForScript({voted:t(lang,'voted'),failed:t(lang,'voteFailed'),tally:(UI[lang]||UI.zh).tally,a:nameOf(v,'A'),b:nameOf(v,'B')})};
function show(j){if(!j)return;document.querySelectorAll('#vote button').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-side')===j.mySide)});if(j.mySide)document.getElementById('vote-q').textContent=T.voted;if(j.tally)document.getElementById('tally').textContent=T.tally.replace('{a}',T.a).replace('{na}',j.tally.A||0).replace('{b}',T.b).replace('{nb}',j.tally.B||0).replace('{u}',j.tally.unsure||0);}
fetch(ep,{credentials:'same-origin'}).then(function(r){return r.ok?r.json():null}).then(show).catch(function(){});
box.addEventListener('click',function(e){var s=e.target.getAttribute&&e.target.getAttribute('data-side');if(!s)return;fetch(ep,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({side:s})}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j&&j.error||r.status);return j;})}).then(show).catch(function(e){document.getElementById('tally').textContent=T.failed+e.message;});});})();`:'';
 const voteJs=voteSrc?`<script>${voteSrc}</script>`:'';
 const hasGiscus=giscus.startsWith('<section');
 const csp=["default-src 'none'",`style-src 'unsafe-inline'${hasGiscus?' https://giscus.app':''}`,"img-src 'self' data: https:",`script-src ${[voteSrc&&`'sha256-${createHash('sha256').update(voteSrc).digest('base64')}'`,hasGiscus&&'https://giscus.app'].filter(Boolean).join(' ')||"'none'"}`,`connect-src ${voteSrc?"'self'":"'none'"}`,`frame-src ${hasGiscus?'https://giscus.app':"'none'"}`,"base-uri 'none'","form-action 'none'"].join('; ');
 return `<!doctype html>
<html lang="${lang==='zh'?'zh-CN':'en'}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(v.topic)}">
<meta property="og:description" content="${esc(desc)}">
${pageUrl?`<meta property="og:url" content="${esc(pageUrl)}">\n<link rel="canonical" href="${esc(pageUrl)}">`:''}
${og?`<meta property="og:image" content="${esc(og)}">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">`:''}
<meta name="twitter:card" content="${og?'summary_large_image':'summary'}">
<meta name="twitter:title" content="${esc(v.topic)}">
<meta name="twitter:description" content="${esc(desc)}">
${og?`<meta name="twitter:image" content="${esc(og)}">`:''}
<style>${STYLE}</style>
</head>
<body>
<main>
${opts.altHref||opts.indexHref?`<div class="lang">${opts.indexHref?`<a href="${esc(opts.indexHref)}">${L('index')}</a>`:''}${opts.altHref?` · <a href="${esc(opts.altHref)}">${esc(opts.altLabel||'')}</a>`:''}</div>`:''}
${posterHtml(d,v,lang)}
${vote}
${replay}
${giscus}
${prov}
</main>
<script type="application/json" id="card-data">${jsonForScript(d)}</script>
${voteJs}
</body>
</html>
`;
}
export function renderIndex(cards,opts={}){
 const lang=opts.lang||'zh',L=k=>t(lang,k);
 const items=cards.map(d=>{const v=view(d,lang),l=lang!==d.lang&&d.translations?.[lang]?lang:d.lang;return `<li class="box"><a href="${esc(opts.hrefOf?opts.hrefOf(d,l):`cards/${d.id}${l===d.lang?'':'.'+l}.html`)}"><b>${esc(v.topic)}</b></a><div class="q">${esc(v.sides[0].label)} vs ${esc(v.sides[1].label)}${v.unresolved?.issue?` · ${esc(v.unresolved.issue)}`:''}</div></li>`;}).join('\n');
 return `<!doctype html>
<html lang="${lang==='zh'?'zh-CN':'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${L('index')} · Agent Argue</title><meta property="og:title" content="${L('index')} · Agent Argue"><meta name="description" content="Agent Argue · ${L('brand')}">
<style>${STYLE} ul{list-style:none;padding:0}</style></head>
<body><main><h1>${L('index')}</h1><p class="facts">${L('provenance')}</p><ul>
${items}
</ul></main></body></html>
`;
}
// 微信长图：1080px 宽，字号放大，底部强提示「回 A / B / 信息不足 + 一句理由」。
export function renderLongImageHtml(d,opts={}){
 const lang=opts.lang||d.lang,v=view(d,lang),L=k=>t(lang,k);
 return `<!doctype html><html lang="${lang==='zh'?'zh-CN':'en'}"><head><meta charset="utf-8"><style>${STYLE}
html,body{width:1080px;background:var(--paper)}main{max-width:none;width:1080px;padding:44px 48px 40px;font-size:34px;line-height:1.5}
.poster{border-width:4px;border-radius:28px;padding:40px;box-shadow:10px 10px 0 var(--ink)}.kicker{font-size:26px}.badge{font-size:24px;padding:2px 18px}
h1{font-size:58px;margin:18px 0 10px}.facts{font-size:28px}.vs{gap:20px;margin:24px 0}.side{border-radius:20px;padding:24px}.side .label{font-size:40px}.side .stance{font-size:30px}.side .bl{font-size:27px}
h2{font-size:30px;margin:32px 0 12px}.conc{border-left-width:8px;padding:8px 0 8px 22px}.conc .pt{font-size:33px}.q{font-size:26px}.none{font-size:30px}
.crux{border-width:4px;border-radius:20px;padding:24px 28px}.crux .issue{font-size:42px}.foot{font-size:24px;margin-top:26px}
.cta{margin-top:30px;background:var(--ink);color:#fff;border-radius:24px;padding:30px 36px;text-align:center}.cta .big{font-size:50px;font-weight:900;letter-spacing:.02em}.cta .small{font-size:26px;opacity:.8;margin-top:6px}
</style></head><body><main>${posterHtml(d,v,lang)}
<div class="cta"><div class="big">${esc(L('reply'))}</div><div class="small">${L('cardNo')} ${esc(d.short)} · ${L('provenance')}</div></div>
</main></body></html>`;
}
// OG 预览图：1200×630，横版，一眼看到题目、双方与未决点。英文字符窄，截断上限按语言放宽（英文题目约 90 字符仍能两行放下）。
export function renderOgHtml(d,opts={}){
 const lang=opts.lang||d.lang,v=view(d,lang),L=k=>t(lang,k);
 const cut=(s,n)=>{s=String(s);if(s.length<=n)return s;const h=s.slice(0,n-1);return (lang==='en'&&/\s/.test(h)?h.replace(/[\s,;:—-]+\S*$/,''):h)+'…';};
 return `<!doctype html><html lang="${lang==='zh'?'zh-CN':'en'}"><head><meta charset="utf-8"><style>${STYLE}
html,body{width:1200px;height:630px;overflow:hidden;background:var(--paper)}
.og{position:absolute;inset:28px;background:var(--card);border:4px solid var(--ink);border-radius:28px;box-shadow:10px 10px 0 var(--ink);padding:34px 42px;display:flex;flex-direction:column}
.og .k{font-size:24px;color:var(--muted);display:flex;justify-content:space-between}.og h1{font-size:54px;margin:10px 0 18px;line-height:1.2}
.og .vs{grid-template-columns:1fr 1fr;gap:18px;margin:0}.og .side{border-radius:18px;padding:16px 20px}.og .label{font-size:34px}.og .stance{font-size:24px}
.og .crux{margin-top:auto;border-width:4px;border-radius:18px;padding:14px 20px}.og .crux .issue{font-size:30px}
</style></head><body><div class="og">${isDemo(d)?`<div class="demo" style="font-size:24px">${L('demo')}</div>`:''}<div class="k"><span>${L('brand')} · ${L('noVerdict')}</span><span>Agent Argue</span></div>
<h1>${esc(cut(v.topic,lang==='en'?90:40))}</h1>
<div class="vs">${v.sides.map(s=>`<div class="side ${esc(s.key)}"><div class="label">${esc(s.label)}</div><div class="stance">${esc(cut(s.stance,lang==='en'?72:44))}</div></div>`).join('')}</div>
<div class="crux"><div class="issue">${esc(cut(v.unresolved?.issue?`${L('crux')}${lang==='en'?': ':'：'}${v.unresolved.issue}`:(d.card.unresolvedConfirmed?L('noCrux'):L('cruxUnconfirmed')),lang==='en'?130:70))}</div></div>
</div></body></html>`;
}
