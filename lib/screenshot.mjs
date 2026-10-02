// 零依赖截图：用 --remote-debugging-pipe 直连无头 Chrome 的 CDP，渲染本地 HTML 为 PNG。
// 只渲染我们自己生成并已转义的 HTML（file:// 临时文件），不访问网络页面。
import {spawn} from 'node:child_process';
import {accessSync,constants as fsConstants} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function findChrome(){
 const cands=[process.env.CHROME_BIN,'google-chrome','google-chrome-stable','chromium','chromium-browser','chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean);
 for(const c of cands){
  if(path.isAbsolute(c)){try{accessSync(c,fsConstants.X_OK);return c;}catch{continue;}}
  for(const dir of String(process.env.PATH||'').split(path.delimiter).filter(Boolean)){const p=path.join(dir,c);try{accessSync(p,fsConstants.X_OK);return p;}catch{}}
 }
 return null;
}

export const MAX_HEIGHT=16000;
// 同时最多跑 N 个 Chrome（默认 2），其余排队，避免连点导出把本机拖垮。
const slots={max:Math.max(1,Number(process.env.ARGUE_SCREENSHOT_CONCURRENCY||2)),busy:0,queue:[]};
// 释放时把槽位直接交给排队者（busy 不变），不存在「先减后加」的窗口。
async function acquire(){if(slots.busy<slots.max){slots.busy++;return;}await new Promise(r=>slots.queue.push(r));}
function release(){const next=slots.queue.shift();if(next)next();else slots.busy--;}
export const _slots=slots;
// 默认开启 Chrome 沙箱；容器/CI 里以 root 运行或没有用户命名空间时，设 ARGUE_CHROME_NO_SANDBOX=1 显式关闭（只渲染本地生成的已转义页面）。
export function sandboxArgs(){return process.env.ARGUE_CHROME_NO_SANDBOX==='1'||process.getuid?.()===0?['--no-sandbox']:[];}
// opts: {width, height(视口；fullPage 时为最小高度), fullPage, scale, timeoutMs}
export async function htmlToPng(html,opts={}){
 const chrome=findChrome();
 if(!chrome)throw new Error('找不到 Chrome/Chromium：请安装或设置 CHROME_BIN');
 await acquire();
 try{return await shoot(chrome,html,opts);}finally{release();}
}
async function shoot(chrome,html,opts){
 const width=opts.width||1080,minH=opts.height||800,scale=opts.scale||1,timeoutMs=opts.timeoutMs||45000;
 const dir=await mkdtemp(path.join(tmpdir(),'argue-shot-'));
 let child=null,timer=null;
 try{
 const file=path.join(dir,'page.html');
 await writeFile(file,html,'utf8');
 const args=['--headless=new','--remote-debugging-pipe','--no-first-run','--no-default-browser-check','--disable-gpu','--hide-scrollbars','--mute-audio',
  '--disable-extensions','--disable-background-networking','--disable-sync','--font-render-hinting=none',`--user-data-dir=${path.join(dir,'profile')}`,...sandboxArgs(),'about:blank'];
 // detached：Chrome 自成进程组，结束时整组杀掉，不留渲染子进程。
 child=spawn(chrome,args,{stdio:['ignore','ignore','pipe','pipe','pipe'],detached:process.platform!=='win32'});
 let stderr='';child.stderr.on('data',d=>{if(stderr.length<4000)stderr+=d;});
 const out=child.stdio[3],inp=child.stdio[4];
 let pipeErr=null;for(const st of [out,inp,child.stderr])st.on('error',e=>{pipeErr=e;});
 let id=0,buf='';const pending=new Map(),waiters=[];
 inp.on('data',chunk=>{buf+=chunk;let i;while((i=buf.indexOf('\0'))>=0){const raw=buf.slice(0,i);buf=buf.slice(i+1);let msg;try{msg=JSON.parse(raw);}catch{continue;}
  if(msg.id&&pending.has(msg.id)){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(new Error(`CDP ${p.method}: ${msg.error.message}`)):p.resolve(msg.result);}
  else if(msg.method){for(const w of [...waiters])if(w.method===msg.method&&(!w.sessionId||w.sessionId===msg.sessionId)){waiters.splice(waiters.indexOf(w),1);w.resolve(msg.params);}}}});
 // 用 exit 而不是 close：主进程崩了但渲染子进程还握着管道时，close 要等到超时才来。
 const exited=new Promise(res=>child.on('exit',res));
 const fail=new Promise((_,rej)=>{child.on('error',e=>rej(new Error(`启动 Chrome 失败：${e.message}`)));exited.then(code=>rej(new Error(`Chrome 提前退出（${code}）${pipeErr?'，'+pipeErr.message:''}：${stderr.slice(-500)}`)));});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{if(!out.writable)return reject(new Error('CDP 管道已关闭'));const n=++id;pending.set(n,{resolve,reject,method});out.write(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})})+'\0');});
 const once=(method,sessionId)=>new Promise(resolve=>waiters.push({method,sessionId,resolve}));
 const timeout=new Promise((_,rej)=>{timer=setTimeout(()=>rej(new Error(`截图超时（${timeoutMs}ms）`)),timeoutMs);});
 const work=(async()=>{
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const s=(m,p)=>send(m,p,sessionId);
  await s('Page.enable');
  await s('Emulation.setDeviceMetricsOverride',{width,height:minH,deviceScaleFactor:scale,mobile:false});
  const loaded=once('Page.loadEventFired',sessionId);
  await s('Page.navigate',{url:pathToFileURL(file).href});
  await loaded;
  const {result}=await s('Runtime.evaluate',{expression:'document.fonts.ready.then(()=>Math.ceil(Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0)))',awaitPromise:true,returnByValue:true});
  const full=Number(result.value)||minH;
  // 超高不静默裁切：宁可失败，也不输出缺了未决点/站队提示却看似完整的图。
  if(opts.fullPage&&full>MAX_HEIGHT)throw new Error(`页面高 ${full}px，超过长图上限 ${MAX_HEIGHT}px，未导出（请精简卡片内容）`);
  const height=opts.fullPage?Math.max(minH,full):minH;
  await s('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:scale,mobile:false});
  const shot=await s('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height,scale:1}});
  send('Browser.close').catch(()=>{});
  return {png:Buffer.from(shot.data,'base64'),width:width*scale,height:height*scale};
 })();
 return await Promise.race([work,fail,timeout]);
 }finally{
  clearTimeout(timer);
  if(child?.pid){
   // 不论主进程是否已退出都清理整个进程组：主进程先崩时渲染子进程可能还活着。
   const alive=()=>{try{process.kill(process.platform!=='win32'?-child.pid:child.pid,0);return true;}catch{return false;}};
   const kill=sig=>{try{process.platform!=='win32'?process.kill(-child.pid,sig):child.kill(sig);}catch{}};
   if(alive()){kill('SIGTERM');const t0=Date.now();while(alive()&&Date.now()-t0<3000)await new Promise(r=>setTimeout(r,50));if(alive())kill('SIGKILL');}
  }
  await rm(dir,{recursive:true,force:true}).catch(()=>{});
 }
}
