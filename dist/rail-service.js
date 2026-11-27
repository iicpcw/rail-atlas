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
async function station(name,signal){
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
  try{groups.push(trip.overrides?.[name]?[{name,xy:trip.overrides[name],tags:{},operator:''}]:await station(name,signal));indices.push(i)}
  catch(e){if(e.stationMissing&&trip.timetable&&i>0&&i<names.length-1)continue;throw e}
 }
 if(groups.length<2)throw Error('有效铁路站点不足');
 const chosen=StationMatch.joint(groups,trip);
 trip._routeStopIndices=indices;
 trip._railMainline=StationMatch.context(trip).label==='国铁'||chosen.every(c=>c.tags?.subway!=='yes'&&c.tags?.station!=='subway'&&!/地下鉄|地铁|Metro|Subway/i.test(c.operator));
 trip._matchedStations=chosen.map((c,i)=>({input:names[indices[i]],name:c.name,osmId:c.osmId,xy:c.xy}));
 return chosen.map(c=>c.xy);
}
function validate(data,points){
 const feature=data?.features?.find(f=>f.geometry?.type==='LineString'),coords=feature?.geometry?.coordinates;
 if(!coords||coords.length<3)throw Error('铁路寻路没有返回有效轨道几何');
 const path=coords.map(c=>[c[1],c[0]]);
 if(path.some(p=>!p.every(Number.isFinite)||Math.abs(p[0])>85||Math.abs(p[1])>180))throw Error('铁路路径坐标无效');
 const rows=feature.properties?.messages,index=rows?.[0]?.indexOf('WayTags');
 if(index==null||index<0||rows.length<2)throw Error('铁路寻路缺少轨道标签，未采用此结果');
 for(const row of rows.slice(1))if(!/(?:^|\s)railway=(rail|light_rail|narrow_gauge|tram|subway)(?:\s|$)/.test(String(row[index]||'')))throw Error('路径包含非铁路段，已拒绝作为铁路轨迹');
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
 throw Error('途经站两侧轨道未连接，未用直线拼接；请核对站台或途经线路');
}
async function route(points,signal,progress,trip={}){
 if(points.length<2)throw Error('至少需要两个铁路站点');
 const mainline=trip._railMainline??(StationMatch.context(trip).label==='国铁');let full=[];
 for(let i=1;i<points.length;i++){
  if(signal?.aborted)throw Error('已停止');if(Core.km(points[i-1],points[i])<.001)continue;
  progress?.('铁路分段寻路 '+i+'/'+(points.length-1));
  const start=full.length?full.at(-1):points[i-1],pair=[start,points[i]],key='rail-leg:v4:'+mainline+':'+JSON.stringify(pair);
  let leg=await Services.read(key,30*86400000);
  const stops=trip.timetable?.stops,indices=trip._routeStopIndices||points.map((_,n)=>n),expected=stops?Number(stops[indices[i]]?.mileage)-Number(stops[indices[i-1]]?.mileage):0;
  if(!leg){
   const {data}=await RailProviders.request(pair,mainline,signal);leg=validate(data,pair);
   if(mainline){const rows=data.features.find(f=>f.geometry?.type==='LineString').properties.messages,n=rows[0].indexOf('WayTags');if(rows.slice(1).some(r=>!/(?:^|\s)railway=rail(?:\s|$)/.test(r[n])))throw Error('干线铁路结果混入其他轨道，未采用')}
   leg=RailQuality.trimArrivalLoop(leg,points[i]).path;
   RailQuality.assess(leg,pair,{expectedKm:expected>0?expected:0});
   await Services.write(key,leg);
  }else RailQuality.assess(leg,pair,{expectedKm:expected>0?expected:0});
  full=merge(full,leg,points[i-1]);
 }
 if(full.length<3)throw Error('铁路路径为空');
 for(const p of points)if((RailQuality.nearest(full,p)?.distance??Infinity)>1)throw Error('拼接路径未经过指定停站');
 return full;
}
return{station,locate,route,validate,candidates,merge};})();
if(typeof module!=='undefined')module.exports=RailService;
