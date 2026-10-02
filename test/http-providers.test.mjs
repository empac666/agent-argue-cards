import test from 'node:test';import assert from 'node:assert/strict';import {invokeHttp} from '../lib/http-providers.mjs';
const fixtures={
 openai:{env:{OPENAI_BASE_URL:'https://example.test/v1',OPENAI_MODEL:'x'},body:{choices:[{message:{content:'ok'}}]},path:'/chat/completions'},
 anthropic:{env:{ANTHROPIC_API_KEY:'x',ANTHROPIC_MODEL:'x'},body:{content:[{type:'text',text:'ok'}]},path:'/v1/messages'},
 gemini:{env:{GEMINI_API_KEY:'x',GEMINI_MODEL:'x'},body:{candidates:[{content:{parts:[{text:'ok'}]}}]},path:':generateContent'},
 ollama:{env:{OLLAMA_BASE_URL:'http://localhost:11434',OLLAMA_MODEL:'x'},body:{message:{content:'ok'}},path:'/api/chat'}
};
for(const [id,f] of Object.entries(fixtures))test(id+' request and output',async()=>{const old=globalThis.fetch;let request;globalThis.fetch=async(url,options)=>{request={url,options};return new Response(JSON.stringify(f.body),{status:200,headers:{'content-type':'application/json'}});};try{assert.equal(await invokeHttp(id,'hello',f.env),'ok');assert.ok(request.url.includes(f.path));assert.ok(JSON.stringify(request.options.body).includes('hello'));}finally{globalThis.fetch=old;}});
test('HTTP failures and empty output reject',async()=>{const old=globalThis.fetch;try{globalThis.fetch=async()=>new Response('bad',{status:503});await assert.rejects(invokeHttp('ollama','hi',{OLLAMA_MODEL:'x'}),/503/);globalThis.fetch=async()=>new Response(JSON.stringify({message:{content:''}}),{status:200});await assert.rejects(invokeHttp('ollama','hi',{OLLAMA_MODEL:'x'}),/empty output/);}finally{globalThis.fetch=old;}});
