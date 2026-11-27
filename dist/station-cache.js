const StationCache=(()=>{
 const pending=new Map(),remote='https://raw.githubusercontent.com/iicpcw/rail-atlas-data/main/';
 async function lookup(name,signal){const n=String(name).trim().replace(/站$/,'');if(!n)return[];const part=n.codePointAt(0)%16,key='data/stations/'+part+'.json';
  if(!pending.has(key))pending.set(key,(async()=>{let value;try{value=await Services.json(key,{signal,timeout:5000})}catch(e){if(signal?.aborted)throw e;value=await Services.json(remote+key,{signal,timeout:8000})}if(value.schema!==1||!value.stations)throw Error('车站坐标缓存格式无效');return value})().catch(e=>{pending.delete(key);throw e}));
  const data=await pending.get(key);return(data.stations[n]||[]).filter(r=>Number.isFinite(r[0])&&Number.isFinite(r[1])&&Math.abs(r[0])<85&&Math.abs(r[1])<180).map(r=>({name:n,xy:r.slice(0,2),operator:'中国国家铁路',tags:{name:n,railway:'station',train:'yes'},stationId:r[2]}));
 }
 return{lookup};
})();
if(typeof module!=='undefined')module.exports=StationCache;
