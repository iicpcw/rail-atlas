const RailService=(()=>{
let stationBlockedUntil=0;
const normalize=s=>String(s||'').trim().replace(/(站|駅)$/,'');
function candidates(data,name){
 if(!Array.isArray(data))throw Error('车站索引响应无效');
 const target=normalize(StationMatch.aliases[name]||name),original=normalize(name);
 return data.filter(r=>/^(station|halt|tram_stop)$/.test(r.railway||r['disused:railway']||'')&&StationMatch.names(r).some(n=>n===target||n===original)).map(r=>{
  StationMatch.learn(r);
  return{name:r.name,operator:[r.operator,r['operator:en'],r.network].filter(Boolean).join(' / '),xy:[Number(r.latitude),Number(r.longitude)],tags:r,osmId:r.osm_id};
 }).filter(r=>r.xy.every(Number.isFinite)&&Math.abs(r.xy[0])<=85&&Math.abs(r.xy[1])<=180);
}
async function station(name,signal,useLocal=false){
 if(useLocal&&typeof StationCache!=='undefined'){try{const cached=await StationCache.lookup(name,signal);if(cached.length)return cached}catch(e){if(signal?.aborted)throw e}}
 const query=StationMatch.aliases[name]||name,key='orm-station:v3:'+query,hit=await Services.read(key,30*86400000);
 if(hit){hit.forEach(c=>StationMatch.learn(c.tags));return hit}
 if(Date.now()<stationBlockedUntil)throw Error('铁路车站索引暂时限流，请稍后再试');
 try{
  const data=await Services.json('https://api.openrailwaymap.org/v2/facility?'+new URLSearchParams({name:query,limit:'50'}),{signal,timeout:8000}),result=candidates(data,name);
  if(!result.length){const e=Error('铁路索引未找到当前名称或历史名称：'+name);e.stationMissing=true;throw e}
  await Services.write(key,result);return result;
 }catch(e){if(e.status===429)stationBlockedUntil=Date.now()+60000;else if(!signal?.aborted&&/HTTP|超时|fetch/i.test(e.message))stationBlockedUntil=Date.now()+15000;throw e}
}
async function locate(names,trip,signal,progress){
 const groups=[],indices=[];
 for(let i=0;i<names.length;i++){
  const name=names[i];if(signal?.aborted)throw Error('已停止');progress?.('铁路站点索引：'+name);
  try{groups.push(trip.overrides?.[name]?[{name,xy:trip.overrides[name],tags:{},operator:''}]:await station(name,signal,StationMatch.context(trip).label==='国铁'));indices.push(i)}
  catch(e){if(e.stationMissing&&trip.timetable&&i>0&&i<names.length-1)continue;throw e}
 }
 if(groups.length<2)throw Error('有效铁路站点不足');
 const chosen=StationMatch.joint(groups,trip);
 trip._routeStopIndices=indices;
 trip._railMainline=StationMatch.context(trip).label==='国铁'||chosen.every(c=>c.tags?.subway!=='yes'&&c.tags?.station!=='subway'&&!/地下鉄|地铁|Metro|Subway/i.test(c.operator));
 trip._matchedStations=chosen.map((c,i)=>({input:names[indices[i]],name:c.name,osmId:c.osmId,xy:c.xy}));
 return chosen.map(c=>c.xy);
}
function validate(data,points,mainline=false){
 const feature=data?.features?.find(f=>f.geometry?.type==='LineString'),coords=feature?.geometry?.coordinates;
 if(!coords||coords.length<3)throw Error('铁路寻路没有返回有效轨道几何');
 const path=coords.map(c=>[c[1],c[0]]);
 if(path.some(p=>!p.every(Number.isFinite)||Math.abs(p[0])>85||Math.abs(p[1])>180))throw Error('铁路路径坐标无效');
 const rows=feature.properties?.messages,index=rows?.[0]?.indexOf('WayTags');
 if(index==null||index<0||rows.length<2)throw Error('铁路寻路缺少轨道标签，未采用此结果');
 for(const row of rows.slice(1))if(!/(?:^|\s)railway=(rail|light_rail|narrow_gauge|tram|subway)(?:\s|$)/.test(String(row[index]||'')))throw Error('路径包含非铁路段，已拒绝作为铁路轨迹');
 if(mainline&&rows.slice(1).some(r=>!/(?:^|\s)railway=rail(?:\s|$)/.test(r[index])))throw Error('干线铁路结果混入其他轨道');
 if(Core.km(points[0],path[0])>1||Core.km(points.at(-1),path.at(-1))>1)throw Error('铁路吸附点偏离车站超过 1 km');
 for(const p of points)if(!path.some(q=>Core.km(p,q)<1))throw Error('铁路路径未经过指定途经站');
 return path;
}
function merge(full,leg,station){
 if(!full.length)return leg.slice();
 const joined=(left,right,split=false)=>{const result=left.concat(right),breaks=[...(full.breaks||[]).filter(i=>i<left.length)];if(split)breaks.push(left.length);if(breaks.length)result.breaks=breaks;return result};
 const key=p=>p[0]+','+p[1];if(key(full.at(-1))===key(leg[0]))return joined(full,leg.slice(1));
 // Fractional segment endpoints may differ by coordinate rounding, not by platform.
 if(typeof RailQuality!=='undefined'&&Core.km(full.at(-1),leg[0])<.02){
  const hit=RailQuality.nearest(leg,full.at(-1),0,Math.min(4,leg.length-1));
  if(hit&&hit.distance<.002)return joined(full,leg.slice(hit.index));
 }
 const near=new Map();for(let i=0;i<leg.length;i++)if(Core.km(leg[i],station)<1)near.set(key(leg[i]),i);
 for(let i=full.length-1;i>=0;i--)if(Core.km(full[i],station)<1&&near.has(key(full[i])))return joined(full.slice(0,i+1),leg.slice(near.get(key(full[i]))+1));
 // Distinct tracks inside one station stay distinct: export two line parts, no fake connector.
 if(Core.km(full.at(-1),leg[0])<.05&&Core.km(leg[0],station)<.35)return joined(full,leg,true);
 // BRouter rounds OSM coordinates; accept sub-two-metre geometry agreement only.
 if(typeof RailQuality!=='undefined')for(let i=full.length-1;i>=0;i--){
  if(Core.km(full[i],station)>1)continue;const hit=RailQuality.nearest(leg,full[i]);
  if(hit?.distance<.002)return joined(full.slice(0,i+1),leg.slice(hit.index));
 }
 throw Error('途经站两侧轨道未连接，未用直线拼接；请核对站台或途经线路');
}
async function route(points,signal,progress,trip={}){
 if(points.length<2)throw Error('至少需要两个铁路站点');
 const mainline=trip._railMainline??(StationMatch.context(trip).label==='国铁');let full=[];
 for(let i=1;i<points.length;i++){
  if(signal?.aborted)throw Error('已停止');if(Core.km(points[i-1],points[i])<.001)continue;
  progress?.('铁路分段寻路 '+i+'/'+(points.length-1));
  const start=full.length?full.at(-1):points[i-1],pair=[start,points[i]],key='rail-leg:v5:'+mainline+':'+JSON.stringify(pair);
  let leg=await Services.read(key,30*86400000);
  const stops=trip.timetable?.stops,indices=trip._routeStopIndices||points.map((_,n)=>n),expected=stops?Number(stops[indices[i]]?.mileage)-Number(stops[indices[i-1]]?.mileage):0;
  const check=(path)=>{RailQuality.assess(path,pair,{expectedKm:expected>0?expected:0});merge(full,path,points[i-1]);return path};
  try{if(leg)check(leg)}catch{leg=null}
  if(!leg){
   const errors=[];
   // Retry bounded alternatives for every problematic interval, not train-specific exceptions.
   for(let attempt=0;attempt<4&&!leg;attempt++){
    if(signal?.aborted)throw Error('已停止');
    const reverse=attempt===1||attempt===2,query=reverse?[pair[1],pair[0]]:pair;
    if(attempt)progress?.('自动修复铁路区间 '+i+'：重新匹配股道 '+attempt+'/3');
    try{
     const {data}=await RailProviders.request(query,mainline,signal);
     let candidate=validate(data,query,mainline);
     if(mainline){const rows=data.features.find(f=>f.geometry?.type==='LineString').properties.messages,n=rows[0].indexOf('WayTags');if(rows.slice(1).some(r=>!/(?:^|\s)railway=rail(?:\s|$)/.test(r[n])))throw Error('干线铁路结果混入其他轨道，未采用')}
     if(reverse)candidate.reverse();
     candidate=RailQuality.trimArrivalLoop(candidate,pair[1]).path;
     // A departure platform can cause the same detour as an arrival platform.
     candidate=RailQuality.trimArrivalLoop(candidate.slice().reverse(),pair[0]).path.slice().reverse();
     leg=check(candidate);
    }catch(e){if(signal?.aborted)throw e;errors.push(e.message);if(e.status===400||e.status===403||e.status===429||/服务暂不可用/.test(e.message))break}
   }
   // Query a wider railway corridor so an intermediate station does not force a bad track snap.
   if(!leg&&points.length>2&&!signal?.aborted){
    const corridor=[points[Math.max(0,i-2)],points[Math.min(points.length-1,i+1)]];
    try{
     progress?.('自动修复铁路区间 '+i+'：跨相邻站校验线路');
     const {data}=await RailProviders.request(corridor,mainline,signal),path=validate(data,corridor,mainline);
     const a=RailQuality.nearest(path,pair[0]),b=RailQuality.nearest(path,pair[1]);
     if(a&&b&&a.distance<.35&&b.distance<.35&&a.index<=b.index){
      const candidate=[a.point,...path.slice(a.index,b.index),b.point];leg=check(candidate);
     }
    }catch(e){if(signal?.aborted)throw e;errors.push(e.message)}
   }
   if(!leg&&typeof Services.overpass==='function'&&Core.km(...pair)<120){
    try{
     progress?.('自动修复铁路区间 '+i+'：读取现有轨道并在本机寻路');
     const margin=.12,box=[Math.min(...pair.map(p=>p[0]))-margin,Math.min(...pair.map(p=>p[1]))-margin,Math.max(...pair.map(p=>p[0]))+margin,Math.max(...pair.map(p=>p[1]))+margin];
     const approach=full.length?([...full].reverse().find(p=>Core.km(p,pair[0])>.8)||full[0]):pair[0];
     const solve=network=>check(Core.route(network,approach,pair[1],{snapSlack:.75}));
     const cached=typeof RailNetworkCache!=='undefined'?await RailNetworkCache.lookup(pair,signal):null;
     if(cached)try{leg=solve(cached)}catch(e){if(signal?.aborted)throw e}
     for(const padding of [.12,.3]){
      if(leg)break;if(signal?.aborted)throw Error('已停止');
      const region=[box[0]-(padding-margin),box[1]-(padding-margin),box[2]+padding-margin,box[3]+padding-margin];
      try{progress?.('自动修复铁路区间 '+i+'：'+(padding>.12?'扩大路网范围并重新连接':'匹配站区可连通股道'));
       const network=await Services.overpass('way["railway"="rail"]["service"!~"^(yard|siding|spur)$"]('+region.join(',')+');out geom;',signal,progress);leg=solve(network);
      }catch(e){if(signal?.aborted)throw e;errors.push(e.message);if(/镜像暂不可用/.test(e.message))break}
     }

    }catch(e){if(signal?.aborted)throw e;errors.push(e.message)}
   }
   if(!leg&&!signal?.aborted){
    for(const endpoint of [0,1]){
     for(const offset of [[.001,0],[-.001,0],[0,.0012],[0,-.0012]]){
      if(leg)break;if(signal?.aborted)throw Error('已停止');
      try{
       progress?.('自动修复铁路区间 '+i+'：搜索车站邻近股道');
       const query=pair.map(p=>p.slice());query[endpoint]=query[endpoint].map((n,k)=>n+offset[k]);
       const {data}=await RailProviders.request(query,mainline,signal);
       let candidate=validate(data,pair,mainline);
       candidate=RailQuality.trimArrivalLoop(candidate,pair[1]).path;
       candidate=RailQuality.trimArrivalLoop(candidate.slice().reverse(),pair[0]).path.slice().reverse();
       leg=check(candidate);
      }catch(e){if(signal?.aborted)throw e;errors.push(e.message);if(e.status===403||e.status===429||/服务暂不可用/.test(e.message))break}
     }
     if(leg)break;
    }
   }
   if(!leg)throw Error('自动修复未成功（已尝试 '+errors.length+' 次）：'+errors.at(-1));
   await Services.write(key,leg);
  }
  full=merge(full,leg,points[i-1]);
 }
 if(full.length<3)throw Error('铁路路径为空');
 for(const p of points)if((RailQuality.nearest(full,p)?.distance??Infinity)>1)throw Error('拼接路径未经过指定停站');
 return full;
}
return{station,locate,route,validate,candidates,merge};})();
if(typeof module!=='undefined')module.exports=RailService;
