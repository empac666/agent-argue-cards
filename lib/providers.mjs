import {invokeHttp} from './http-providers.mjs';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {accessSync,constants as fsConstants} from 'node:fs';
import path from 'node:path';
const env=process.env;
// 单次 Agent 调用超时，默认 150 秒；Grok 深度推理较慢时可用 ARGUE_AGENT_TIMEOUT_MS 调大（上限 15 分钟）。
const timeoutMs=()=>{const n=Number(env.ARGUE_AGENT_TIMEOUT_MS);return Number.isFinite(n)&&n>=1000?Math.min(n,900000):150000;};
// 超时后先 SIGTERM，宽限期内不退出则 SIGKILL；再等不到 close 也必定 reject，避免队列被挂死。
const KILL_GRACE_MS=5000,SETTLE_GRACE_MS=3000;
// 先查 PATH（Windows 依次尝试 .exe/.cmd），再退回各 CLI 官方安装脚本的默认位置；不写死任何个人机器路径。
function defaultBin(name,fallbacks){/* 不找 .cmd/.bat：spawn(shell:false) 启动不了它们，开 shell 又会把 prompt 交给命令解释器 */const exts=process.platform==='win32'?['.exe']:[''];for(const dir of String(env.PATH||'').split(path.delimiter).filter(Boolean))for(const ext of exts){const p=path.join(dir,name+ext);try{accessSync(p,fsConstants.X_OK);return p;}catch{}}return fallbacks.find(p=>{try{accessSync(p,fsConstants.X_OK);return true;}catch{return false;}})||fallbacks[0];}
const win=process.platform==='win32';
const agyBin=()=>env.AGY_BIN||defaultBin('agy',win?[path.join(homedir(),'AppData','Local','agy','agy.exe')]:[path.join(homedir(),'.local','bin','agy'),'/usr/local/bin/agy']);
const grokBin=()=>env.GROK_BIN||defaultBin('grok',[path.join(homedir(),'.grok','bin',win?'grok.exe':'grok'),...(win?[]:['/usr/local/bin/grok'])]);
const cli={agy:{name:'AGY',bin:agyBin()},'agy-claude':{name:'AGY · Claude（默认裁判）',role:'JUDGE',bin:agyBin(),model:env.AGY_JUDGE_MODEL||'claude-sonnet-4-6'},grok:{name:'Grok',bin:grokBin()}};
const apis={openai:{name:'OpenAI compatible',ready:!!(env.OPENAI_BASE_URL&&env.OPENAI_MODEL),reason:'需配置 OPENAI_BASE_URL 与 OPENAI_MODEL'},anthropic:{name:'Claude / Anthropic',ready:!!(env.ANTHROPIC_API_KEY&&env.ANTHROPIC_MODEL),reason:'需配置 ANTHROPIC_API_KEY 与 ANTHROPIC_MODEL'},gemini:{name:'Gemini',ready:!!(env.GEMINI_API_KEY&&env.GEMINI_MODEL),reason:'需配置 GEMINI_API_KEY 与 GEMINI_MODEL'},ollama:{name:'Ollama',ready:!!env.OLLAMA_MODEL,reason:'需配置 OLLAMA_MODEL 并运行本地服务'}};
function customAgents(){
 let items;try{items=JSON.parse(env.ARGUE_CLI_AGENTS||'[]');}catch{return [];}
 if(!Array.isArray(items))return [];
 const reserved=new Set([...Object.keys(cli),...Object.keys(apis)]),seen=new Set();
 return items.filter(a=>{
  if(!a||typeof a!=='object'||typeof a.id!=='string'||!/^[a-z][a-z0-9_-]{1,31}$/.test(a.id)||reserved.has(a.id)||seen.has(a.id))return false;
  if(typeof a.name!=='string'||!a.name.trim()||a.name.length>80||typeof a.command!=='string'||!path.isAbsolute(a.command))return false;
  if(!Array.isArray(a.args)||a.args.length>20||a.args.some(x=>typeof x!=='string'||x.length>500))return false;
  if(!a.args.some(x=>x.includes('{prompt}')||x.includes('{promptFile}')))return false;
  seen.add(a.id);return true;
 });
}
async function has(bin){try{await access(bin);return true;}catch{return false;}}
export async function listAgents(){const out=[];for(const [id,c] of Object.entries(cli)){const available=await has(c.bin);out.push({id,name:c.name,...(c.role?{role:c.role}:{}),available,reason:available?(c.model?`通过 AGY 调用 ${c.model}，与 Gemini/Grok 辩手异构，适合当裁判`:'命令存在；登录状态将在调用时验证'):'未找到本机命令'});}for(const [id,c] of Object.entries(apis))out.push({id,name:c.name,available:c.ready,reason:c.ready?'已配置；连接将在调用时验证':c.reason});for(const c of customAgents()){const available=await has(c.command);out.push({id:c.id,name:c.name,available,reason:available?'通用 CLI 已配置；调用协议将在发送时验证':'未找到 CLI 可执行文件'});}return out;}
async function run(bin,args,cwd){return new Promise((resolve,reject)=>{const p=spawn(bin,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false});let stdout='',stderr='',size=0,done=false,timed=false;let killTimer=null,settleTimer=null;const finish=()=>{clearTimeout(timer);clearTimeout(killTimer);clearTimeout(settleTimer);};const timer=setTimeout(()=>{timed=true;p.kill('SIGTERM');killTimer=setTimeout(()=>{try{p.kill('SIGKILL');}catch{}settleTimer=setTimeout(()=>{if(done)return;done=true;finish();reject(Error('Agent 超时且进程未能及时退出；交付状态不明，请先检查记录，勿盲目重发'));},SETTLE_GRACE_MS);},KILL_GRACE_MS);},timeoutMs());for(const [stream,key] of [[p.stdout,'out'],[p.stderr,'err']])stream.on('data',b=>{size+=b.length;if(size>120000){p.kill();return;}if(key==='out')stdout+=b.toString();else stderr+=b.toString();});p.on('error',e=>{if(done)return;done=true;finish();reject(e);});p.on('close',code=>{if(done)return;done=true;finish();if(timed)return reject(Error('Agent 超时；交付状态不明，请先检查记录，勿盲目重发'));if(size>120000)return reject(Error('输出超过 120 KB'));if(code!==0)return reject(Error((stderr||stdout||'Agent 退出码 '+code).slice(-1500)));if(!stdout.trim())return reject(Error('Agent 返回空内容'));resolve(stdout.trim());});});}
async function local(id,prompt){const dir=await mkdtemp(path.join(tmpdir(),'agent-argue-'));try{if(id==='agy'||cli[id].model)return await run(cli[id].bin,['--print',prompt,...(cli[id].model?['--model',cli[id].model]:[]),'--print-timeout',Math.max(10,Math.floor(timeoutMs()/1000)-10)+'s','--output-format','text','--disable-slash-commands'],dir);const file=path.join(dir,'prompt.txt');await writeFile(file,prompt);return await run(cli.grok.bin,['--prompt-file',file,'--cwd',dir,'--output-format','plain','--disable-web-search','--no-subagents','--max-turns','1'],dir);}finally{await rm(dir,{recursive:true,force:true});}}
async function custom(c,prompt){const dir=await mkdtemp(path.join(tmpdir(),'agent-argue-custom-'));try{const file=path.join(dir,'prompt.txt');await writeFile(file,prompt);const args=c.args.map(x=>x.replaceAll('{promptFile}',file).replaceAll('{prompt}',prompt));return await run(c.command,args,dir);}finally{await rm(dir,{recursive:true,force:true});}}
async function invokeDirect(id,prompt){if(cli[id])return local(id,prompt);const c=customAgents().find(x=>x.id===id);if(c)return custom(c,prompt);if(!apis[id]?.ready)throw Error('Provider 未配置');return invokeHttp(id,prompt,env);}
const queues=new Map();
export function invoke(id,prompt){const previous=queues.get(id)||Promise.resolve();const current=previous.catch(()=>{}).then(()=>invokeDirect(id,prompt));queues.set(id,current);current.finally(()=>{if(queues.get(id)===current)queues.delete(id);}).catch(()=>{});return current;}
