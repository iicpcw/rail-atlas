const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(__dirname+'/../dist/services.js','utf8');
const sandbox={module:{exports:{}},AbortController,URL,URLSearchParams,Map,Date,setTimeout,clearTimeout,fetch:null};
let calls=0;sandbox.fetch=async()=>{calls++;return calls===1?{ok:false,status:502}:{ok:true,json:async()=>({elements:[{id:7}]})}};
vm.runInNewContext(source,sandbox);const S=sandbox.module.exports;
(async()=>{assert.equal((await S.overpass('node(7);out;'))[0].id,7);assert.equal(calls,2);await S.overpass('node(7);out;');assert.equal(calls,2);sandbox.fetch=()=>new Promise(()=>{});const start=Date.now();await assert.rejects(S.json('timeout',{timeout:20}),/超时/);assert(Date.now()-start<500);const c=new AbortController();const pending=S.json('cancel',{signal:c.signal});c.abort();await assert.rejects(pending,/已停止/);console.log('PASS: 502 fallback, cache reuse, hung fetch timeout and cancel');})().catch(e=>{console.error(e);process.exitCode=1});
