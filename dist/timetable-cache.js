// Same-origin, immutable public timetable snapshots. Never use future data for a past trip.
const TimetableCache=(()=>{
const remote=typeof location!=='undefined'?'https://raw.githubusercontent.com/iicpcw/rail-atlas-data/main/':'';
let catalog;const books=new Map(),pending=new Map();
async function index(signal){
 if(!catalog){let origin=remote,value;try{value=await Services.json(origin+'data/timetables/index.json',{signal,timeout:5000})}catch(e){if(signal?.aborted)throw e;origin='';value=await Services.json('data/timetables/index.json',{signal,timeout:5000})}if(value.schema!==1||!Array.isArray(value.snapshots))throw Error('时刻表缓存索引无效');let history={snapshots:[]};try{history=await Services.json(origin+'data/timetable-history/index.json',{signal,timeout:5000});if(history.schema!==1||!Array.isArray(history.snapshots))history={snapshots:[]}}catch(e){if(signal?.aborted)throw e}catalog={...value,bulkCount:value.snapshots.length,historyRecords:history.snapshots.reduce((n,s)=>n+s.schedules,0),snapshots:[...value.snapshots.map(s=>({...s,origin})),...history.snapshots.map(s=>({...s,origin}))]}}
 return catalog;
}
async function book(item,signal){
 if(books.has(item.file))return books.get(item.file);
 if(pending.has(item.file))return pending.get(item.file);
 const job=(async()=>{
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,20000);
  if(signal?.aborted){clearTimeout(timer);throw Error('已停止')}
  signal?.addEventListener('abort',abort,{once:true});
  try{
   if(!/^[a-f0-9]{64}\.json\.gz$/.test(item.file))throw Error('时刻表文件名无效');
   const base=item.base==='data/timetable-history/'?item.base:'data/timetables/';const r=await fetch((item.origin===remote?remote:'')+base+item.file,{signal:controller.signal});if(!r.ok)throw Error('本站时刻表 HTTP '+r.status);
   const bytes=await r.arrayBuffer(),stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
   const data=await new Response(stream).arrayBuffer();
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),v=>v.toString(16).padStart(2,'0')).join('');
   if(digest!==item.sha256)throw Error('时刻表缓存校验失败');
   const value=JSON.parse(new TextDecoder().decode(data));if(value.schema!==1||!value.index||!Array.isArray(value.records))throw Error('时刻表数据无效');
   books.set(item.file,value);if(books.size>3)books.delete(books.keys().next().value);return value;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
 })();pending.set(item.file,job);try{return await job}finally{pending.delete(item.file)}
}
function select(data,train,trip,section){
 const keys=train.split('/'),ids=[...new Set([train,...keys].flatMap(k=>data.index[k]||[]))];
 const matches=[];
 for(const id of ids){
  const record=data.records[id];if(!record)continue;
  const stops=record.stops.map((s,i)=>({station_name:s[0],arrive_time:s[1],start_time:s[2],arrive_day_diff:s[3],start_day_diff:s[4]??s[3],station_no:i+1,anomaly:s[5]||false,mileage:s[6]}));
  try{const selected=section(stops,trip.from,trip.to,trip.time.departure),boardingDay=selected[0].start_day_diff||0,originDay=new Date(Date.parse(trip.time.label+'T00:00:00Z')-boardingDay*86400000).toISOString().slice(0,10).replaceAll('-','');matches.push({record,stops:selected,exactDate:record.dates?.includes(originDay)||false})}catch{}
 }
 let found=matches.some(m=>m.exactDate)?matches.filter(m=>m.exactDate):matches;
 if(found.length>1&&trip.time.departure){const timed=found.filter(m=>m.stops[0].start_time===trip.time.departure);if(timed.length)found=timed}
 const unique=new Map(found.map(m=>[JSON.stringify(m.stops),m]));
 if(unique.size>1)throw Error('缓存包含多个不同停站方案，请核对出发时间或途经站');
 return unique.values().next().value||null;
}
async function lookup(trip,train,section,{signal,knownVersions=[]}={}){
 const meta=await index(signal),day=trip.time.label.replaceAll('-','.');
 const available=meta.snapshots.filter(s=>s.date<=day&&(!s.codes||[train,...train.split('/')].some(c=>s.codes.includes(c)))).sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
 if(!available.length)return null;
 // A newer known snapshot must not silently be replaced by an older cached one.
 const newest=knownVersions.filter(v=>v<=day).sort().at(-1);
 if(newest&&newest>available[0].date)return null;
 const date=available[0].date;
 for(const item of available.filter(s=>s.date===date)){
  const data=await book(item,signal),hit=select(data,train,trip,section);
  if(hit)return {version:item.date,train:hit.record.codes.join('/'),stops:hit.stops,names:hit.stops.map(s=>s.station_name),source:item.source+' · GitHub 缓存 '+item.date+'（快照参考，不保证当日开行）'};
 }
 return null;
}
return{index,lookup,select};})();
if(typeof module!=='undefined')module.exports=TimetableCache;
