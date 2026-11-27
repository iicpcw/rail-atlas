// services.js
const Services=(()=>{
const memory=new Map(),pending=new Map();
const db=typeof indexedDB==='undefined'?Promise.resolve(null):new Promise(resolve=>{const timer=setTimeout(()=>resolve(null),1500);const r=indexedDB.open('rail-atlas-data',1);r.onupgradeneeded=()=>r.result.createObjectStore('cache');r.onsuccess=()=>{clearTimeout(timer);resolve(r.result)};r.onblocked=r.onerror=()=>{clearTimeout(timer);resolve(null)}});
async function read(key,age=Infinity){if(memory.has(key)){const v=memory.get(key);if(Date.now()-v.at<age)return v.value}try{const d=await db;if(!d)return;const v=await new Promise(resolve=>{const r=d.transaction('cache').objectStore('cache').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve()});if(v&&Date.now()-v.at<age){memory.set(key,v);return v.value}}catch{}}
async function write(key,value){const v={at:Date.now(),value};memory.set(key,v);try{const d=await db;if(d)d.transaction('cache','readwrite').objectStore('cache').put(v,key)}catch{}return value}
const queues=new Map(),nextAt=new Map(),blocked=new Map();
function pause(ms,signal){if(signal?.aborted)return Promise.reject(Error('已停止'));return new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(Error('已停止'))},timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},ms);signal?.addEventListener('abort',abort,{once:true})})}
function hostOf(url){try{return new URL(url).hostname}catch{return ''}}
function blockUntil(host){let stored=0;try{stored=Number(localStorage.getItem('rail-cooldown:'+host))||0}catch{}return Math.max(blocked.get(host)||0,stored)}
async function json(url,{signal,timeout=12000,...options}={}){const host=hostOf(url),interval=host==='api.openrailwaymap.org'?1500:['brouter.de','bikerouter.de'].includes(host)?2500:host==='api.raillog.top'?500:0;
 const task=async()=>{if(signal?.aborted)throw Error('已停止');if(blockUntil(host)>Date.now()){const e=Error(host+' 暂停请求：此前服务拒绝访问或限流，请在 '+new Date(blockUntil(host)).toLocaleTimeString()+' 后重试');e.status=blocked.has(host)?403:429;e.service=host;e.blocked=true;throw e}if(interval)await pause(Math.max(0,(nextAt.get(host)||0)-Date.now()),signal);nextAt.set(host,Date.now()+interval);
 const c=new AbortController();let timer;const abort=()=>c.abort();signal?.addEventListener('abort',abort,{once:true});try{return await Promise.race([fetch(url,{...options,signal:c.signal}).then(async r=>{if(!r.ok){let detail='';try{detail=(await r.text()).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,350)}catch{}const e=Error((host?host+'：':'')+'HTTP '+r.status+(detail?' · '+detail:''));e.status=r.status;e.service=host;e.detail=detail;if(r.status===403||r.status===429){const value=r.headers?.get?.('Retry-After'),seconds=Number(value),retry=value?(Number.isFinite(seconds)?seconds*1000:Date.parse(value)-Date.now()):0,until=Date.now()+Math.max(r.status===403?3600000:60000,retry||0);blocked.set(host,until);try{localStorage.setItem('rail-cooldown:'+host,String(until))}catch{}e.blocked=true;e.message+='；已暂停该服务请求，避免继续触发限制'}throw e}return r.json()}),new Promise((_,reject)=>{timer=setTimeout(()=>{c.abort();reject(Error((host?host+'：':'')+'查询超时'))},timeout);c.signal.addEventListener('abort',()=>reject(Error(signal?.aborted?'已停止':'查询超时')),{once:true})})])}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}};
 if(!interval)return task();const job=(queues.get(host)||Promise.resolve()).catch(()=>{}).then(task);queues.set(host,job);return job;
}
const health=new Map();let sequence=0;
const endpoints=['https://maps.mail.ru/osm/tools/overpass/api/interpreter','https://overpass.private.coffee/api/interpreter','https://overpass-api.de/api/interpreter'];
async function overpass(q,signal,progress=()=>{}){const key='osm:'+q;const hit=await read(key,30*86400000);if(hit)return hit;if(pending.has(key))return pending.get(key);
const job=(async()=>{let errors=[];const available=endpoints.filter(e=>Date.now()>=(health.get(e)?.retryAt||0)).sort((a,b)=>(health.get(a)?.lastUsed||0)-(health.get(b)?.lastUsed||0));for(const endpoint of available){const state=health.get(endpoint)||{failures:0,lastUsed:0,latency:0};state.lastUsed=++sequence;health.set(endpoint,state);const start=Date.now();progress('查询 OSM · '+new URL(endpoint).hostname+'（最多 15 秒）');try{const data=await json(endpoint,{signal,timeout:15000,method:'POST',body:new URLSearchParams({data:'[out:json][timeout:12];'+q})});if(data.remark||!Array.isArray(data.elements))throw Error(data.remark||'无效响应');state.failures=0;state.retryAt=0;state.latency=Date.now()-start;return await write(key,data.elements)}catch(e){if(signal?.aborted)throw e;state.failures++;state.retryAt=Date.now()+Math.min(300000,30000*2**(state.failures-1));errors.push(new URL(endpoint).hostname+': '+e.message);progress('镜像暂不可用，自动切换：'+new URL(endpoint).hostname)}}throw Error('OSM 镜像暂不可用'+(errors.length?'（'+errors.join(' / ')+'）':'，节点正在冷却，请稍后重试')+'；行程已保留。')})();pending.set(key,job);try{return await job}finally{pending.delete(key)}}
let airports;
async function airport(code,signal){if(!airports)airports=await json('data/airports.json',{signal});const xy=airports[code.trim().toUpperCase()];if(!xy)throw Error('机场代码 '+code+' 不在坐标库，请核对三字码或补充坐标');return xy}
return{read,write,json,overpass,airport};})();
if(typeof module!=='undefined')module.exports=Services;

;
// stations.js
const StationMatch=(()=>{
const aliases={'新桥':'新橋','东京':'東京','惠比寿':'恵比寿','成田机场':'成田空港','京成上野':'京成上野'};
const identities=new Map();
const normalize=s=>String(s||'').trim().replace(/(站|駅)$/,'');
function names(tags){return [...new Set(Object.entries(tags).filter(([k])=>/^(?:(?:old_|alt_|official_|short_|former_)?name)(?::|$)|^uic_name$/.test(k)).flatMap(([,v])=>String(v||'').split(';')).map(normalize).filter(Boolean))]}
function learn(tags){const id=tags.osm_id;if(!id)return;for(const n of names(tags)){const set=identities.get(n)||new Set();set.add(id);identities.set(n,set)}}
function same(a,b){a=normalize(a);b=normalize(b);if(a===b||(aliases[a]||a)===(aliases[b]||b))return true;const x=identities.get(a),y=identities.get(b);return !!x&&!!y&&x.size===1&&y.size===1&&[...x][0]===[...y][0]}
function context(t={}){const pair=[t.from,t.to].join('|'),carrier=t.raw?.['承运']||'';
if(/广东城际|廣東城際/.test(carrier)||/琶洲|白云机场东/.test(pair))return{label:'广东城际',operator:/广东城际|廣東城際|Guangdong Intercity|广州地铁集团|Guangzhou Metro Group/i,center:[23.2,113.4]};
if(/京成|Keisei/i.test(pair+' '+carrier))return{label:'京成电铁',operator:/京成|Keisei/i,center:[35.75,140]};
if(/JRE|JR East|東日本旅客|东日本旅客/i.test(carrier)||/^(新桥|新橋|上野)\|(新桥|新橋|上野)$/.test(pair))return{label:'JR 东日本',operator:/JR.?East|東日本旅客|东日本旅客|JRE/i,center:[35.7,139.77]};
if(/国铁|國鐵|铁路局|铁路集团|局集团|China Railway/i.test(carrier)||/嘉兴南|上海南/.test(pair)||/^[GDKTZYCSP]\d/i.test(t.raw?.['班次']||''))return{label:'国铁',operator:/中国铁路|中國鐵路|国铁|國鐵|China Railway|铁路局|局集团|铁路集团/i,center:/嘉兴南|上海南/.test(pair)?[31,121]:null};return{label:carrier,operator:null,center:null}}
function rank(candidates,name,t){const ctx=context(t),anchor=t?._lastPoint||ctx.center;function score(c){return(ctx.operator?.test(c.operator)?1000:0)+(c.name===(aliases[name]||name)?100:0)-(anchor?Core.km(c.xy,anchor):0)}return [...candidates].sort((a,b)=>score(b)-score(a))}
function joint(groups,trip){
 const ctx=context(trip);let best=null;
 // Resolve a consistent pair/network rather than greedily picking each closest namesake.
 for(const first of groups[0])for(const last of groups.at(-1)){
  const op=c=>String(c.tags?.['operator:wikidata']||c.tags?.operator||c.operator||'').split(';')[0].trim();
  const common=op(first)&&op(first)===op(last),subway=c=>c.tags?.subway==='yes'||c.tags?.station==='subway';
  const distance=Core.km(first.xy,last.xy),explicit=ctx.operator;
  let score=distance+(subway(first)?4:0)+(subway(last)?4:0)-(common?40:0);
  if(explicit)score+=(explicit.test(first.operator)?0:10000)+(explicit.test(last.operator)?0:10000);
  if(ctx.center)score+=Core.km(first.xy,ctx.center)+Core.km(last.xy,ctx.center);
  if(!best||score<best.score)best={score,first,last,operator:common?op(first):null};
 }
 const selected=groups.map((g,i)=>i===0?best.first:i===groups.length-1?best.last:rank(g,'',{...trip,_lastPoint:best.first.xy}).sort((a,b)=>Number(!!best.operator&&!(String(a.tags?.['operator:wikidata']||a.tags?.operator||a.operator).split(';')[0]===best.operator))-Number(!!best.operator&&!(String(b.tags?.['operator:wikidata']||b.tags?.operator||b.operator).split(';')[0]===best.operator)))[0]);
 return selected;
}
return{aliases,context,rank,names,learn,same,joint};})();
if(typeof module!=='undefined')module.exports=StationMatch;

;
// core.js
/* Pure routing helpers: original OSM node IDs preserve topology. */
const Core=(()=>{
function km(a,b){let r=Math.PI/180,p=(b[0]-a[0])*r,q=(b[1]-a[1])*r,s=Math.sin(p/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(q/2)**2;return 12742*Math.asin(Math.sqrt(Math.min(1,s)))}
function ellipse(a,b,bend=.04){
 const rad=Math.PI/180,project=lat=>Math.log(Math.tan(Math.PI/4+Math.max(-85,Math.min(85,lat))*rad/2));
 let end=b[1];while(end-a[1]>180)end-=360;while(end-a[1]<-180)end+=360;
 const ax=a[1]*rad,ay=project(a[0]),bx=end*rad,by=project(b[0]),dx=bx-ax,dy=by-ay;
 // Use a common polar bound for every curve in the group; distinct bends remain distinct.
 const room=Math.max(0,project(85)-Math.max(Math.abs(ay),Math.abs(by))),scale=Math.abs(dx)>.000001?Math.min(1,room/(.55*Math.abs(dx))):1;
 const out=[];for(let i=0;i<=100;i++){const t=Math.PI*i/100,u=(1-Math.cos(t))/2,v=bend*scale*Math.sin(t);out.push([(2*Math.atan(Math.exp(ay+dy*u+dx*v))-Math.PI/2)/rad,(ax+dx*u-dy*v)/rad])}
 out[0]=[...a];out[100]=[b[0],end];return out;
}
function geoJSONPath(path){
 if(path.breaks?.length){const bounds=[0,...path.breaks,path.length],parts=[];for(let i=1;i<bounds.length;i++){const segment=path.slice(bounds[i-1],bounds[i]);if(segment.length<2)continue;const g=geoJSONPath(segment);parts.push(...(g.type==='LineString'?[g.coordinates]:g.coordinates))}return{type:'MultiLineString',coordinates:parts}}
 const wrap=x=>((x+180)%360+360)%360-180,segments=[];let current=[[wrap(path[0][1]),path[0][0]]];
 for(let i=1;i<path.length;i++){let a=current.at(-1),lon=wrap(path[i][1]),lat=path[i][0],delta=lon-a[0];
   if(Math.abs(delta)>180){let adjusted=lon+(delta>180?-360:360),edge=delta>180?-180:180,t=(edge-a[0])/(adjusted-a[0]),cross=a[1]+(lat-a[1])*t;current.push([edge,cross]);segments.push(current);current=[[-edge,cross],[lon,lat]]}else current.push([lon,lat]);
 }segments.push(current);return segments.length===1?{type:'LineString',coordinates:segments[0]}:{type:'MultiLineString',coordinates:segments};
}
class Heap{constructor(){this.h=[]}push(v){let h=this.h;h.push(v);let i=h.length-1;while(i){let p=(i-1)>>1;if(h[p][0]<=v[0])break;h[i]=h[p];i=p}h[i]=v}pop(){let h=this.h,r=h[0],v=h.pop();if(h.length){let i=0;while(i*2+1<h.length){let j=i*2+1;if(j+1<h.length&&h[j+1][0]<h[j][0])j++;if(h[j][0]>=v[0])break;h[i]=h[j];i=j}h[i]=v}return r}}
function route(elements,a,b,options={}){let points=new Map(),graph=new Map();for(const w of elements){if(w.type!=='way'||!w.geometry||!w.nodes)continue;w.nodes.forEach((id,i)=>{const g=w.geometry[i];if(g)points.set(id,[g.lat,g.lon])});for(let i=1;i<w.nodes.length;i++){const u=w.nodes[i-1],v=w.nodes[i];if(!points.has(u)||!points.has(v))continue;const d=km(points.get(u),points.get(v));if(!graph.has(u))graph.set(u,[]);if(!graph.has(v))graph.set(v,[]);graph.get(u).push([v,d]);graph.get(v).push([u,d])}}
function candidates(p){let all=[];for(const [id,xy]of points){const d=km(p,xy);if(d<=1.5&&graph.has(id))all.push([id,d])}all.sort((a,b)=>a[1]-b[1]);if(!all.length)return [];return all.filter(x=>x[1]<=all[0][1]+.12)}
const starts=options.startNodeId!=null?(graph.has(options.startNodeId)?[[options.startNodeId,0]]:[]):options.exactStart?candidates(a).filter(x=>x[1]<1e-7):candidates(a),ends=new Map(candidates(b));if(!starts.length||!ends.size)throw Error('站点附近 1.5 km 内未找到轨道，请检查站点坐标');let heap=new Heap(),cost=new Map(),prev=new Map(),best=Infinity,finish=null;
for(const [id,snap]of starts){cost.set(id,snap*4);heap.push([snap*4,id])}
while(heap.h.length){let [d,u]=heap.pop();if(d!==cost.get(u))continue;if(d>=best)break;if(ends.has(u)){const total=d+ends.get(u)*4;if(total<best){best=total;finish=u}}for(const [v,w]of graph.get(u)||[]){let nd=d+w;if(nd<(cost.get(v)??Infinity)){cost.set(v,nd);prev.set(v,u);heap.push([nd,v])}}}
if(finish!==null){let u=finish,out=[points.get(u)],ids=[u];while(prev.has(u)){u=prev.get(u);out.push(points.get(u));ids.push(u)}out.reverse();out.nodeIds=ids.reverse();return out}throw Error('OSM 铁路网络不连通或超出查询范围；请补充途经站后重试')}

return{km,ellipse,route,geoJSONPath};})();
if(typeof module!=='undefined')module.exports=Core;


;
// rail-quality.js
// Geometry checks operate on real railway polylines, never synthetic connecting chords.
const RailQuality=(()=>{
function length(path){let total=0;for(let i=1;i<path.length;i++)if(!path.breaks?.includes(i))total+=Core.km(path[i-1],path[i]);return total}
function project(p,a,b){const x=Math.cos(p[0]*Math.PI/180),dx=(b[1]-a[1])*x,dy=b[0]-a[0],den=dx*dx+dy*dy,t=den?Math.max(0,Math.min(1,((p[1]-a[1])*x*dx+(p[0]-a[0])*dy)/den)):0;const point=[a[0]+dy*t,a[1]+(b[1]-a[1])*t];return{point,t,distance:Core.km(p,point)}}
function nearest(path,p,from=0,to=path.length-1){let best=null;for(let i=Math.max(1,from+1);i<=to;i++){if(path.breaks?.includes(i))continue;const hit=project(p,path[i-1],path[i]);if(!best||hit.distance<best.distance)best={...hit,index:i}}return best}
function trimArrivalLoop(path,target){
 const total=length(path);if(total<15)return{path,corrected:false};
 // Look for an earlier pass through the destination station before a long excursion.
 // Exclude the final 10 km; only snap to an existing segment within 350 m.
 let remaining=0,end=path.length-1;while(end>1&&remaining<10){remaining+=Core.km(path[end],path[end-1]);end--}
 const hit=nearest(path,target,0,end);if(!hit||hit.distance>.35)return{path,corrected:false};
 const shortened=path.slice(0,hit.index).concat([hit.point]),distance=length(shortened);
 if(distance<.1||total-distance<10||distance>total*.8)return{path,corrected:false};
 return{path:shortened,corrected:true,savedKm:total-distance,snapKm:hit.distance};
}
function assess(path,points,{expectedKm=0}={}){
 const distance=length(path),direct=Core.km(points[0],points.at(-1));
 for(const p of points)if((nearest(path,p)?.distance??Infinity)>1)throw Error('路径未经过指定车站区域');
 // A timetable interval mileage is stronger evidence than straight-line distance.
 if(expectedKm>0&&distance>expectedKm*1.65+12)throw Error('轨迹长度 '+distance.toFixed(1)+' km 显著超过时刻表区间 '+expectedKm.toFixed(1)+' km，疑似股道吸附或网络断连');
 if(!expectedKm&&direct<35&&distance>direct*3+12)throw Error('短途铁路出现异常绕行（'+distance.toFixed(1)+' km），需重新匹配站点或轨道');
 return{distance,direct};
}
return{length,project,nearest,trimArrivalLoop,assess};})();
if(typeof module!=='undefined')module.exports=RailQuality;

;
// rail-providers.js
const RailProviders=(()=>{
const providers=[{id:'primary',url:'https://brouter.de/brouter',profile:'custom_1795737045785'},{id:'bikerouter',url:'https://bikerouter.de/brouter-engine/brouter',profile:'custom_1795757041317'}];
const rules='---context:global\nassign continueStraight false\nassign downhillcost 0\nassign uphillcost 0\n---context:way\nassign turncost 0\nassign initialcost 0\nassign costfactor switch railway=rail 1 100000\n---context:node\nassign initialcost 0\n';
let cursor=0;
async function request(points,mainline,signal){
 const order=providers.map((_,i)=>providers[(cursor+i)%providers.length]);cursor=(cursor+1)%providers.length;
 const errors=[];
 for(const p of order){
  if(signal?.aborted)throw Error('已停止');
  let profile=mainline?(await Services.read('rail-profile:v2:'+p.id)||p.profile):'rail';
  const fetchRoute=()=>Services.json(p.url+'?'+new URLSearchParams({lonlats:points.map(q=>q[1]+','+q[0]).join('|'),profile,alternativeidx:'0',format:'geojson'}),{signal,timeout:45000});
  try{let data;try{data=await fetchRoute()}catch(e){
   if(mainline&&[400,404,500].includes(e.status)&&/profile.*(not found|does not exist|unknown)|FileNotFound/i.test(e.detail||'')){
    const r=await Services.json(p.url+'/profile',{signal,method:'POST',headers:{'Content-Type':'text/plain'},body:rules,timeout:12000});
    if(!/^custom_\d+$/.test(r.profileid||''))throw Error('铁路规则加载失败');profile=r.profileid;await Services.write('rail-profile:v2:'+p.id,profile);data=await fetchRoute();
   }else throw e;
  }return{data,provider:p.id};
  }catch(e){if(signal?.aborted)throw e;errors.push(p.id+': '+e.message);if(!e.blocked&&e.status===400&&!/no track|profile/i.test(e.detail||''))throw e}
 }
 throw Error('铁路寻路服务暂不可用：'+errors.join(' / '));
}
return{request,providers};})();
if(typeof module!=='undefined')module.exports=RailProviders;

;
// rail-service.js
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

;
// trips.js
const TripData=(()=>{
const pad=n=>String(n).padStart(2,'0');
function clock(value){let s=String(value??'').trim().replace(/\+\s*\d+\s*(?:天|日|d)?/ig,'').replace(/\d+\s*(?:天|日)后|次日|翌日|第三天|后天|当日|当天|[()（）]/g,'').trim(),h,m;if(!s)return null;
if(/^0?\.\d+$/.test(s)){let n=Math.round(Number(s)*1440);h=Math.floor(n/60);m=n%60}
else{let x=s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)||s.match(/^(\d{1,2})(\d{2})$/);if(!x)return null;h=+x[1];m=+x[2]}
return h>=0&&h<24&&m>=0&&m<60?{minutes:h*60+m,label:pad(h)+':'+pad(m)}:null}
function date(raw,sheet,cell,date1904=false){const years=String(sheet).match(/(?:19|20)\d{2}/g)||[],year=years.length===1?+years[0]:null;let y,m,d,note='',s=String(raw['日期']??'').trim();
if(cell?.t==='n'&&(cell.v>10000||cell.dateFormatted)){const dt=new Date(Date.UTC(1899,11,30)+(Math.floor(cell.v)+(date1904?1462:0))*86400000);y=dt.getUTCFullYear();m=dt.getUTCMonth()+1;d=dt.getUTCDate()}
else{const full=s.match(/^(\d{4})[年.\/-](\d{1,2})[月.\/-](\d{1,2})(?:日)?(?:[ T].*)?$/),short=s.match(/^(\d{1,2})[月.\/-](\d{1,2})日?$/);if(full){[,y,m,d]=full.map(Number)}else if(short&&year){y=year;m=+short[1];d=+short[2]}else note=s?'日期无法识别或缺少年份':'未填写日期'}
const departure=clock(raw['出发时间']),arrival=clock(raw['到达时间']);let day=null;if(y&&m&&d){let v=Date.UTC(y,m-1,d),dt=new Date(v);if(dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d)day=v;else note='无效日期';if(day!==null&&year&&year!==y)note='日期年份与 Sheet 不一致，按日期年份排序'}
if(String(raw['出发时间']??'').trim()&&!departure)note+=(note?'；':'')+'出发时间无法识别';
let label=day===null?(s||'日期未知')+(year?'（'+year+'）':''):y+'-'+pad(m)+'-'+pad(d);return{day,sort:day===null?null:day+(departure?.minutes??0)*60000,label,departure:departure?.label||'',arrival:arrival?.label||'',note}}
function newest(a,b){const x=a.time?.sort,y=b.time?.sort;return (x==null?1:0)-(y==null?1:0)||(y??0)-(x??0)||a.id-b.id}
function key(t){return JSON.stringify([t.mode,...[t.from,t.to].sort()])}
function counts(trips){const c=new Map();for(const t of trips)if(t.mode==='rail'&&t.from&&t.to)c.set(key(t),(c.get(key(t))||0)+1);return c}
function clickable(t,c){return t.mode==='air'||!!t.from&&!!t.to&&(c.get(key(t))||0)<=6}
function bends(trips){const groups=new Map(),result=new Map();for(const t of trips)if(t.mode==='air'){const k=JSON.stringify([t.from.toUpperCase(),t.to.toUpperCase()].sort());if(!groups.has(k))groups.set(k,[]);groups.get(k).push(t)}for(const group of groups.values()){group.sort(newest);group.forEach((t,i)=>{const level=Math.floor(i/2),levels=Math.ceil(group.length/2),magnitude=group.length===1?.04:.015+(levels>1?.045*level/(levels-1):0);const sign=(i%2?-1:1)*(t.from.toUpperCase()>t.to.toUpperCase()?-1:1);result.set(t.id,magnitude*sign)})}return result}
function unitPrice(raw){const n=Number(raw['每公里单价']||raw['腐败率']);if((raw['每公里单价']||raw['腐败率'])&&Number.isFinite(n))return n.toFixed(3)+' /km';const price=Number(raw['价格']),km=Number(raw['里程']);return raw['价格']&&km>0&&Number.isFinite(price)?(price/km).toFixed(3)+' /km':'—'}
return{unitPrice,clock,date,newest,key,counts,clickable,bends};})();
if(typeof module!=='undefined')module.exports=TripData;

;
// calendar.js
// Calendar days are local itinerary dates, represented as UTC midnight (no timezone conversion).
const TripCalendar=(()=>{
const DAY=86400000,iso=n=>new Date(n).toISOString().slice(0,10);
function kind(t){if(t.mode==='air')return'air';const text=[t.from,t.to,t.raw?.['承运'],t.raw?.['交通方式'],t.sheet].join(' ');if(/^[GDKTZYCSP]\d/i.test(t.raw?.['班次']||''))return'china';if(/日本|新橋|新桥|横浜|橫濱|横滨|日暮里|秋葉原|秋叶原|大宮|大宫|浅草|淺草|八王子|船橋|船桥|広島|广岛|福岡|福冈|倉敷|金沢|金泽|小倉|小仓|新大阪|JR(?:E|W|東|西|东|九州|北海道|四国)?|東日本|西日本|京成|小田急|東急|东急|京急|東京|东京|上野|新宿|渋谷|涩谷|渋谷|浜松町|滨松町|亀戸|龟户|恵比寿|惠比寿|吉祥寺|下北沢|下北泽|梅田|大阪|京都|名古屋|博多|なんば|札幌|品川|池袋|成田|羽田|[ぁ-んァ-ヶ]/i.test(text))return'japan';if(/广东城际|廣東城際|地铁|地下铁|有轨电车/.test(text))return'local';return'china'}
function mode(raw,from,to){return /航空|飞行|航班/.test(raw['交通方式']||'')||!!raw['航班号']||/^(?!JR)(?:[A-Z]{2}|\d[A-Z])\d{1,4}[A-Z]?$/i.test(raw['班次']||'')||(/^[a-z]{3}$/i.test(from)||/^[a-z]{3}$/i.test(to))?'air':'rail'}
function normalize(raw){raw['日期']=raw['出发日期']||raw['日期']||'';raw['班次']=raw['班次']||raw['车次']||raw['航班号']||'';return raw}
function validate(t){const errors=[],type=kind(t);if(!t.from)errors.push('缺少出发地');if(!t.to)errors.push('缺少到达地');if(type==='air'){if(t.from&&!/^[A-Z]{3}$/i.test(t.from))errors.push('出发地必须为机场三字码');if(t.to&&!/^[A-Z]{3}$/i.test(t.to))errors.push('到达地必须为机场三字码');if(!String(t.raw?.['班次']||'').trim())errors.push('缺少航班号')}else{if(t.time?.day==null)errors.push('缺少有效出发日期（年份可取自 Sheet）');if(type==='china'&&!String(t.raw?.['班次']||'').trim())errors.push('中国国铁缺少车次')}return errors}
function markedClock(value){const s=String(value||'').trim();let offset=null;const plus=s.match(/\+\s*(\d+)\s*(?:天|日|d)?/i),after=s.match(/(\d+)\s*(?:天|日)后/);if(plus)offset=+plus[1];else if(after)offset=+after[1];else if(/次日|翌日/.test(s))offset=1;else if(/第三天|后天/.test(s))offset=2;else if(/当日|当天/.test(s))offset=0;const clean=s.replace(/\+\s*\d+\s*(?:天|日|d)?/ig,'').replace(/\d+\s*(?:天|日)后|次日|翌日|第三天|后天|当日|当天|[()（）]/g,'').trim();return{clock:TripData.clock(clean),offset}}
function span(t){const start=t.time?.day;if(start==null)return{start:null,end:null,note:''};const raw=t.raw||{},arrival=markedClock(raw['到达时间']),departure=TripData.clock(raw['出发时间']),explicit=String(raw['到达日期']||'').trim();let end=start,note='';
 if(explicit){let parsed=TripData.date({'日期':explicit},String(new Date(start).getUTCFullYear()),t.arrivalCell,t.date1904).day;if(parsed!=null&&parsed<start&&/^\d{1,2}[月.\/-]\d{1,2}日?$/.test(explicit))parsed=TripData.date({'日期':explicit},String(new Date(start).getUTCFullYear()+1)).day;if(parsed==null||parsed<start)return{start,end:start,note:'到达日期无效或早于出发日期，日历暂按出发日显示'};end=parsed;note='按到达日期'}
 else if(arrival.offset!=null){if(arrival.offset>366)return{start,end:start,note:'跨日标记超过 366 天，请核对'};end=start+arrival.offset*DAY;note='按到达时间跨日标记'}
 else if(t.timetable?.stops?.length){const first=t.timetable.stops[0],last=t.timetable.stops.at(-1),da=TripData.clock(first.arrive_time),dd=TripData.clock(first.start_time);const startOffset=Number(first.arrive_day_diff)+(da&&dd&&dd.minutes<da.minutes?1:0),offset=Number(last.arrive_day_diff)-startOffset;if(Number.isFinite(offset)&&offset>=0){end=start+offset*DAY;note='跨日参考历史停站表'}else if(arrival.clock&&departure&&arrival.clock.minutes<departure.minutes){end=start+DAY;note='按到达时刻推定次日'}}
 else if(arrival.clock&&departure&&arrival.clock.minutes<departure.minutes){end=start+DAY;note=t.mode==='air'?'按时刻推定次日；跨时区航班请填写到达日期':'按到达时刻推定次日'}
 if(end-start>366*DAY)return{start,end:start,note:'行程跨日范围超过 366 天，请核对到达日期'};return{start,end,note};
}
function includes(t,day){const r=span(t);return day==='unknown'?r.start==null:!day||r.start!=null&&day>=iso(r.start)&&day<=iso(r.end)}
function days(trips){const result=new Map();for(const t of trips){const r=span(t);if(r.start==null)continue;for(let d=r.start;d<=r.end;d+=DAY){const k=iso(d);result.set(k,(result.get(k)||0)+1)}}return result}
return{kind,mode,normalize,validate,span,includes,days,iso,markedClock};})();
if(typeof module!=='undefined')module.exports=TripCalendar;

;
// cards.js
let mapPopup=null;
function displayPaths(){const bends=TripData.bends(trips),paths=new Map();for(const t of trips)if(t.path)paths.set(t.id,t.mode==='air'?Core.ellipse(t.path[0],t.path.at(-1),bends.get(t.id)):t.path);return paths}
function showMapCards(event){const counts=TripData.counts(trips),selected=new Set((event.features||[]).map(f=>Number(f.properties.id))),railKeys=new Set(trips.filter(t=>selected.has(t.id)&&t.mode==='rail'&&TripData.clickable(t,counts)).map(TripData.key));const rows=visible().filter(t=>t.selected!==false).filter(t=>t.mode==='air'?selected.has(t.id):railKeys.has(TripData.key(t))&&TripData.clickable(t,counts)).sort(TripData.newest);if(!rows.length)return;
const node=document.createElement('div');node.className='route-cards';node.innerHTML='<h3>行程详情 <small>'+rows.length+' 条</small></h3>'+rows.map(t=>'<article class="route-card"><div class="card-date">'+esc(t.time?.label||'日期未知')+' '+esc(t.time?.departure||'')+'</div><h4>'+esc(t.from)+' → '+esc(t.to)+'</h4><div class="card-tags">'+(t.mode==='air'?'飞行':'铁路 · 同站往返共 '+counts.get(TripData.key(t))+' 次')+'</div><dl>'+[['班次',t.raw['班次']],['承运',t.raw['承运']],['出发时间',t.time?.departure||t.raw['出发时间']],['到达时间',t.time?.arrival||t.raw['到达时间']],['席位',t.raw['席位']],['型号',t.raw['型号']],['价格',t.raw['价格']],['每公里单价',TripData.unitPrice(t.raw)],['里程',t.raw['里程']?t.raw['里程']+' km':'']].map(([k,v])=>'<div><dt>'+k+'</dt><dd>'+esc(v||'—')+'</dd></div>').join('')+'</dl><p>'+esc(t.timetable?.source||t.routeBasis||'')+'</p><p>'+esc(t.routingNote||'')+'</p><p>'+esc(t.timetable?.names.join(' → ')||'')+'</p><p>'+esc(t.sheet)+' · 第 '+t.row+' 行'+(t.time?.note?' · '+esc(t.time.note):'')+'</p><button data-trip="'+t.id+'">完整记录与修正</button></article>').join('');node.addEventListener('click',e=>{const b=e.target.closest('[data-trip]');if(b){mapPopup?.remove();showTrip(trips.find(t=>t.id===Number(b.dataset.trip)))}});mapPopup?.remove();mapPopup=new maplibregl.Popup({maxWidth:'360px',closeButton:true,offset:10}).setLngLat(event.lngLat).setDOMContent(node).addTo(map);
}

;
// timetable-cache.js
// Same-origin, immutable public timetable snapshots. Never use future data for a past trip.
const TimetableCache=(()=>{
let catalog;const books=new Map(),pending=new Map();
async function index(signal){
 if(!catalog){const value=await Services.json('data/timetables/index.json',{signal,timeout:5000});if(value.schema!==1||!Array.isArray(value.snapshots))throw Error('时刻表缓存索引无效');let history={snapshots:[]};try{history=await Services.json('data/timetable-history/index.json',{signal,timeout:5000});if(history.schema!==1||!Array.isArray(history.snapshots))history={snapshots:[]}}catch(e){if(signal?.aborted)throw e}catalog={...value,bulkCount:value.snapshots.length,historyRecords:history.snapshots.reduce((n,s)=>n+s.schedules,0),snapshots:[...value.snapshots,...history.snapshots]}}
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
   const base=item.base==='data/timetable-history/'?item.base:'data/timetables/';const r=await fetch(base+item.file,{signal:controller.signal});if(!r.ok)throw Error('本站时刻表 HTTP '+r.status);
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

;
// timetable.js
// RailLog public snapshot API. A snapshot is never asserted to be the train's actual running day.
const Timetable=(()=>{
const cache=new Map();let knownVersions;
function versionFor(versions,day){return versions.filter(v=>/^\d{4}\.\d{2}\.\d{2}$/.test(v)&&v.replaceAll('.','-')<=day).sort().at(-1)||null}
function sameStation(a,b){return typeof StationMatch!=='undefined'?StationMatch.same(a,b):a===b}
function section(stops,from,to,depart){const found=[];for(let i=0;i<stops.length;i++)if(sameStation(stops[i].station_name,from))for(let j=i+1;j<stops.length;j++)if(sameStation(stops[j].station_name,to))found.push(stops.slice(i,j+1));if(!found.length)throw Error('快照停站表不包含该方向的起终站');let selected=found;if(found.length>1&&depart)selected=found.filter(s=>s[0].start_time===depart);if(selected.length!==1)throw Error('同一车次有多个符合区间，请核对途经站');if(selected[0].some(s=>s.anomaly))throw Error('历史时刻表存在异常标记，请人工核对');return selected[0]}
async function get(path,signal){if(signal?.aborted)throw Error('已停止');if(cache.has(path))return cache.get(path);const svc=typeof Services!=='undefined'?Services:null,key='timetable:'+path,age=path.endsWith('/versions')?86400000:Infinity;let hit=svc?await svc.read(key,age):null;if(hit){cache.set(path,hit);return hit}try{let d;if(svc)d=await svc.json('https://api.raillog.top'+path,{signal,timeout:8000});else{const c=new AbortController(),abort=()=>c.abort(),timer=setTimeout(abort,8000);signal?.addEventListener('abort',abort,{once:true});try{const r=await fetch('https://api.raillog.top'+path,{signal:c.signal});if(!r.ok)throw Error('时刻表服务返回 '+r.status);d=await r.json()}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}}cache.set(path,d);if(svc)await svc.write(key,d);return d}catch(e){if(signal?.aborted)throw e;if(svc&&path.endsWith('/versions')){const d=await svc.json('data/timetable-versions.json',{signal});cache.set(path,d);return d}throw e}}

async function lookup(t,{signal}={}){if(t.time?.day==null)throw Error('未提供完整日期，将按 OSM 网络生成（不套用当前车次停站）');const train=String(t.raw['班次']||'').trim().toUpperCase();if(!/^[A-Z]?\d+(?:\/[A-Z]?\d+)*$/.test(train))throw Error('未填写可查询的中国铁路车次号');if(typeof TimetableCache!=='undefined'){try{const known=knownVersions||(knownVersions=await Services.json('data/timetable-versions.json',{signal,timeout:5000}));const hit=await TimetableCache.lookup(t,train,section,{signal,knownVersions:known});if(hit)return hit}catch(e){if(signal?.aborted)throw e;if(e.message.includes('多个不同停站'))throw e}}const versions=await get('/api/train-timetables/versions',signal),version=versionFor(versions,t.time.label);if(!version)throw Error('没有不晚于行程日期的时刻表快照');const data=await get('/api/train-timetables?'+new URLSearchParams({trainNumber:train,version}),signal);let stops;try{stops=section(data.stops||[],t.from,t.to,t.time.departure)}catch(e){if(!e.message.includes('不包含')||typeof RailService==='undefined')throw e;await Promise.all([RailService.station(t.from,signal),RailService.station(t.to,signal)]);stops=section(data.stops||[],t.from,t.to,t.time.departure)}return{version,train:data.train_codes||train,stops,names:stops.map(s=>s.station_name),source:'RailLog 历史快照 '+version+'（参考，不保证当日实际开行）'}}
async function archive(trips,{signal,onProgress=()=>{}}={}){const trains=[...new Set(trips.filter(t=>t.mode==='rail').map(t=>String(t.raw['班次']||'').trim().toUpperCase()).filter(n=>/^[A-Z]?\d+(?:\/[A-Z]?\d+)*$/.test(n)))];if(!trains.length)throw Error('没有可缓存的中国铁路车次号');const all=await get('/api/train-timetables/versions',signal),today=new Date().toISOString().slice(0,10).replaceAll('-','.');const years=new Map();for(const v of [...all].sort())if(v>='2019.01.01'&&v<=today)years.set(v.slice(0,4),v);const versions=new Set(years.values());for(const t of trips)if(t.time?.day!=null){const v=versionFor(all,t.time.label);if(v)versions.add(v)}let done=0,ok=0,missing=0,errors=0,total=trains.length*versions.size;for(const train of trains)for(const version of versions){if(signal?.aborted)throw Error('已停止缓存');onProgress({done,total,train,version,ok,missing,errors});try{const data=await get('/api/train-timetables?'+new URLSearchParams({trainNumber:train,version}),signal);if(data.stops?.length)ok++;else missing++}catch(e){if(signal?.aborted)throw e;errors++}done++}return{done,total,ok,missing,errors}}
return{versionFor,section,lookup,archive};})();
if(typeof module!=='undefined')module.exports=Timetable;

;
// map-presentation.js
const MapPresentation=(()=>{
function airportImage(){const c=document.createElement('canvas');c.width=c.height=48;const x=c.getContext('2d');x.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?9:21,px=24+Math.cos(a)*r,py=24+Math.sin(a)*r;i?x.lineTo(px,py):x.moveTo(px,py)}x.closePath();x.fillStyle='#ffe133';x.strokeStyle='#5c4b00';x.lineWidth=3;x.fill();x.stroke();return x.getImageData(0,0,48,48)}
function airports(map){if(!map.hasImage('airport-star'))map.addImage('airport-star',airportImage(),{pixelRatio:2});map.addLayer({id:'airport-stars',type:'symbol',source:'stops',filter:['==',['get','mode'],'air'],layout:{'icon-image':'airport-star','icon-size':1.2,'icon-allow-overlap':true,'icon-ignore-placement':true}})}
function stops(rows){const result=new Map();for(const t of rows)if(t.path&&t.selected!==false)for(const [p,label] of [[t.path[0],t.from],[t.path.at(-1),t.to]]){const key=t.mode+':'+p.join(',');result.set(key,{type:'Feature',properties:{mode:t.mode,label},geometry:{type:'Point',coordinates:[p[1],p[0]]}})}return{type:'FeatureCollection',features:[...result.values()]}}
function add(map,data,stopData){
 map.addSource('journeys',{type:'geojson',data});map.addSource('stops',{type:'geojson',data:stopData});
 map.addLayer({id:'journey-outline',type:'line',source:'journeys',paint:{'line-color':'#645218','line-width':['match',['get','mode'],'air',6.5,5.5],'line-opacity':['match',['get','mode'],'air',.85,0]}});
 map.addLayer({id:'journey-lines',type:'line',source:'journeys',paint:{'line-color':['match',['get','mode'],'air','#ffe133','#dc3038'],'line-width':['match',['get','mode'],'air',4.5,3.5],'line-opacity':['match',['get','mode'],'air',1,.58]}});
 map.addLayer({id:'stop-points',type:'circle',source:'stops',filter:['!=',['get','mode'],'air'],paint:{'circle-radius':4,'circle-color':'#fff','circle-stroke-color':'#33755b','circle-stroke-width':2}});airports(map);
}
return{airports,stops,add};})();
if(typeof module!=='undefined')module.exports=MapPresentation;

;
// share.js
const ShareImage=(()=>{
async function create(data,stops,{signal,onProgress=()=>{}}={}){
 if(!data.features.length)throw Error('请先生成并显示需要分享的轨迹');
 const width=1920,height=1120,container=document.createElement('div');Object.assign(container.style,{position:'fixed',left:'-10000px',top:'0',width:width+'px',height:height+'px'});document.body.appendChild(container);
 let preview;
 try{
  preview=new maplibregl.Map({container,style:'map-style.json',interactive:false,attributionControl:false,preserveDrawingBuffer:true,pixelRatio:1});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('分享底图加载超时，请稍后重试')),45000),abort=()=>{clearTimeout(timer);reject(Error('已取消分享'))};signal?.addEventListener('abort',abort,{once:true});preview.once('load',()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve()})});
  MapPresentation.add(preview,data,stops);
  const coordinates=data.features.flatMap(f=>f.geometry.type==='MultiLineString'?f.geometry.coordinates.flat():f.geometry.coordinates),bounds=new maplibregl.LngLatBounds();
  // Unwrap around the first coordinate so Pacific crossings don't fit the whole world.
  const origin=coordinates[0][0];for(const xy of coordinates){let lon=xy[0];while(lon-origin>180)lon-=360;while(lon-origin< -180)lon+=360;bounds.extend([lon,xy[1]])}
  preview.fitBounds(bounds,{padding:90,maxZoom:13,duration:0});onProgress('正在绘制分享大图…');
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('分享地图资源未加载完成，请重试')),45000);preview.once('idle',()=>{clearTimeout(timer);resolve()})});
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height+160;const c=canvas.getContext('2d');c.fillStyle='#f6f8f6';c.fillRect(0,0,canvas.width,canvas.height);c.drawImage(preview.getCanvas(),0,70,width,height);c.fillStyle='#243e3b';c.font='bold 32px sans-serif';c.fillText('我的行程地图',44,46);c.font='20px sans-serif';c.fillText(data.features.length+' 段行程',width-220,46);c.font='17px sans-serif';c.fillText('铁路 / 航空轨迹 · github.com/iicpcw/rail-atlas',44,height+112);c.font='14px sans-serif';c.fillText('© OpenStreetMap contributors · OpenFreeMap · 地形 Mapzen / 地图数据 ODbL',44,height+141);
  return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('无法生成图片')),'image/png'));
 }finally{preview?.remove();container.remove()}
}
return{create};})();

;
// app.js
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let selectedDay='',calendarMonth='';
let trips=[],book=null,busy=false,cancel=false,controller=null,cache=new Map(),mapReady=false;
const map=new maplibregl.Map({container:'map',style:'map-style.json',center:[120.5,32],zoom:4.5,attributionControl:{customAttribution:['站点服务 <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>','铁路寻路 <a href="https://brouter.de/">BRouter</a>']}});map.addControl(new maplibregl.NavigationControl(),'top-right');
map.on('load',()=>{mapReady=true;MapPresentation.add(map,collection(),MapPresentation.stops(visible()));map.addLayer({id:'journey-hit',type:'line',source:'journeys',filter:['==',['get','clickable'],true],paint:{'line-width':16,'line-opacity':0}});map.on('click','journey-hit',showMapCards);map.on('mouseenter','journey-hit',()=>map.getCanvas().style.cursor='pointer');map.on('mouseleave','journey-hit',()=>map.getCanvas().style.cursor='');draw()});
map.on('error',()=>{if(!mapReady)$('status').textContent='地图资源加载中；若持续空白，请检查网络后刷新。'});
function visible(){const f=$('filter').value,q=$('search').value.toLowerCase();return trips.filter(t=>TripCalendar.includes(t,selectedDay)&&(f==='all'||f===t.mode||f==='error'&&t.error)&&[t.from,t.to,t.raw['班次'],t.sheet].join(' ').toLowerCase().includes(q)).sort(TripData.newest)}
function collection(){const counts=TripData.counts(trips),paths=displayPaths();return {type:'FeatureCollection',features:visible().filter(t=>t.path&&t.selected!==false).map(t=>({type:'Feature',properties:{id:t.id,clickable:TripData.clickable(t,counts),count:counts.get(TripData.key(t))||1,date:t.time?.label||'',departure:t.time?.departure||'',mode:t.mode,from:t.from,to:t.to,sheet:t.sheet,row:t.row,routeBasis:t.routeBasis||'',timetableVersion:t.timetable?.version||'',routingNote:t.routingNote||'',status:t.mode==='rail'?(t.routeBasis||'OSM 网络推算'):'机场间椭圆弧线'},geometry:Core.geoJSONPath(paths.get(t.id))}))}}
function draw(){if(!mapReady)return;map.getSource('journeys').setData(collection());map.getSource('stops').setData(MapPresentation.stops(visible()))}
function fit(path){const paths=displayPaths();let p=path||visible().filter(t=>t.selected!==false).flatMap(t=>paths.get(t.id)||[]);if(!p.length)return;const b=new maplibregl.LngLatBounds();p.forEach(x=>b.extend([x[1],x[0]]));map.fitBounds(b,{padding:{top:65,bottom:110,left:85,right:65},maxZoom:16})}

function renderCalendar(){document.body?.classList?.toggle('has-trips',!!trips.length);const days=TripCalendar.days(trips),months=[...new Set([...days.keys()].sort().map(d=>d.slice(0,7)))],unknown=trips.filter(t=>t.time?.day==null).length;$('calendarPanel').hidden=!trips.length;if(!months.includes(calendarMonth))calendarMonth=months.at(-1)||'';if(selectedDay&&selectedDay!=='unknown'&&!days.has(selectedDay))selectedDay='';$('calendarSelection').textContent=selectedDay==='unknown'?'无日期行程':selectedDay||'全部日期';$('calendarMonth').innerHTML=months.map(m=>`<option value="${m}" ${m===calendarMonth?'selected':''}>${m.slice(0,4)} 年 ${Number(m.slice(5))} 月</option>`).join('');$('calendarMonth').disabled=!months.length;const index=months.indexOf(calendarMonth);$('calendarPrev').disabled=index<=0;$('calendarNext').disabled=index<0||index===months.length-1;$('calendarUnknown').disabled=!unknown;$('calendarUnknown').textContent='无日期行程 ('+unknown+')';$('run').textContent=selectedDay?'生成当前日期全部':'生成全部';if(!calendarMonth){$('calendarDays').innerHTML='<p class="calendar-empty">暂无可识别的行程日期</p>';return}const [y,m]=calendarMonth.split('-').map(Number),first=(new Date(Date.UTC(y,m-1,1)).getUTCDay()+6)%7,last=new Date(Date.UTC(y,m,0)).getUTCDate();let html='<span></span>'.repeat(first);for(let d=1;d<=last;d++){const day=calendarMonth+'-'+String(d).padStart(2,'0'),count=days.get(day)||0;html+=`<button data-day="${day}" ${count?'':'disabled'} aria-label="${day}，${count} 条行程" aria-pressed="${selectedDay===day}" class="${selectedDay===day?'active':''}">${d}${count?'<i></i>':''}</button>`}$('calendarDays').innerHTML=html}
$('calendarDays').onclick=e=>{const day=e.target.closest('[data-day]')?.dataset.day;if(!day||!TripCalendar.days(trips).has(day))return;selectedDay=day;render();fit()};
$('calendarMonth').onchange=()=>{calendarMonth=$('calendarMonth').value;renderCalendar()};
function stepMonth(delta){const months=[...new Set([...TripCalendar.days(trips).keys()].sort().map(d=>d.slice(0,7)))],i=months.indexOf(calendarMonth);if(months[i+delta])calendarMonth=months[i+delta];renderCalendar()}
$('calendarPrev').onclick=()=>stepMonth(-1);$('calendarNext').onclick=()=>stepMonth(1);
$('calendarAll').onclick=()=>{selectedDay='';render();fit()};$('calendarUnknown').onclick=()=>{selectedDay='unknown';render();fit()};

function render(){renderCalendar();mapPopup?.remove();let list=visible();$('count').textContent=list.length===trips.length?trips.length:list.length+'/'+trips.length;$('total').innerHTML=list.length+'<small> 段</small>';$('done').innerHTML=list.filter(t=>t.path&&t.selected!==false).length+'<small> 段</small>';let ds=list.map(t=>Number(t.raw['里程'])).filter(v=>Number.isFinite(v)&&v>0);$('distance').innerHTML=(ds.length?Math.round(ds.reduce((a,b)=>a+b,0)).toLocaleString():'—')+'<small> km</small>';for(const id of ['run','runSelected','runRail','runAir'])$(id).disabled=!trips.length||busy;$('list').innerHTML=list.length?list.map(t=>`<div class="trip" data-id="${t.id}"><input type="checkbox" class="trip-check" data-select="${t.id}" aria-label="显示并选择 ${esc(t.from)} 到 ${esc(t.to)}" ${t.selected!==false?'checked':''}><strong>${t.mode==='air'?'✈':'▤'} ${esc(t.from||'缺少出发地')} <span style="color:#a8b4aa">→</span> ${esc(t.to||'缺少到达地')}</strong><small>${esc(t.time?.label||t.raw['日期'])} ${esc(t.time?.departure||'')} · ${esc(t.raw['班次']||'未填班次')} · ${esc(t.sheet)} #${t.row}</small><small class="${t.error?'bad':''}">${esc([t.error||t.status||'待生成',t.time?.note,TripCalendar.span(t).note,t.routingNote].filter(Boolean).join(' · '))}</small></div>`).join(''):'<div class="empty"><span>⌁</span><h3>'+(trips.length?'没有符合筛选条件的行程':'暂无行程')+'</h3><p>导入后显示行程与匹配结果。</p></div>';draw()}
function tell(s){$('status').textContent=s}
function modal(html){$('detail').innerHTML=html;$('dialog').showModal()}
$('close').onclick=()=>$('dialog').close();$('fit').onclick=()=>fit();$('filter').onchange=render;$('search').oninput=render;$('list').onclick=e=>{if(e.target.matches?.('[data-select]'))return;let el=e.target.closest('[data-id]');if(el)showTrip(trips.find(t=>t.id===Number(el.dataset.id)))};
$('list').onchange=e=>{const id=e.target.dataset?.select;if(id===undefined)return;const t=trips.find(t=>t.id===Number(id));if(t){t.selected=e.target.checked;render()}};
$('selectAll').onclick=()=>{trips.forEach(t=>t.selected=true);render()};
$('selectNone').onclick=()=>{trips.forEach(t=>t.selected=false);render()};
const headers=['日期','出发地','到达地','班次','承运','席位','出发时间','到达时间','价格','型号','里程','腐败率','到达日期','途经站'];
$('template').onclick=()=>{if(!window.XLSX)return tell('表格组件未加载，请检查网络后刷新');let w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([headers]),'行程');XLSX.writeFile(w,'行迹-空白行程模板.xlsx')};
$('help').onclick=()=>modal('<h2>导入格式说明</h2><p>按列名识别，不依赖列顺序。中国国铁必填：出发日期、车次、出发地、到达地；航空必填：起终机场三字码、航班号；日本铁路必填：日期和精确起终站名，无需车次。支持「出发日期／日期」「车次／航班号／班次」列名。扫描工作表前 100 行寻找表头，读取之后的全部有效记录。</p><pre>'+headers.join(' / ')+'</pre><p>车站使用精确站名；飞行起终点使用 IATA 三字码。三个英文字母的起终点会识别为飞行，也可在行程详情修正。年份从日期单元格或 Sheet 名识别；铁路必须能识别完整出发日期。航空日期可空，归入日历的「无日期行程」。腐败率表示每公里单价。支持中文、日文站名，以及可选「途经站」列（用 ; 分隔）。年度 Sheet（如 2019—2026 各一个 Sheet）中的 5.5 识别为该年 5 月 5 日；完整日期优先使用自身年份。按日期及出发时间倒序，未知日期排最后。若 5.10 在 Excel 中存为数值 5.1，无法还原 10 日，请使用文本或日期单元格。</p><p>日历无行程日期置灰；选择日期同时筛选列表、地图及生成范围，全部日期恢复。跨日优先读取可选「到达日期」，其次「到达时间」中的次日/+1/+2 标记，再参考历史停站表。仅有时刻且到达早于出发时推定次日；跨时区航班请填写到达日期。筛选不会删除轨迹或改变勾选状态。</p><p>地图点击显示详情卡片；所有航班可点选，铁路同一对精确站名的去返程合计不超过 6 次可点选（一次往返计 2 次）。次数按当前导入的全部记录统计，不随筛选变化。超过 6 次仍显示轨迹，可从左侧列表查看。多 Sheet 可选择单个或全部；不会自动去重。空白行跳过，缺少起终点的记录保留并提示。公式读取文件中的缓存值，错误单元格视为空；本应用不执行公式。</p><p>中国铁路优先按日期和车次读取 RailLog 历史停站快照，截取起终站区间并约束 OSM 分段寻路；快照并非当日实际开行记录。路路通查询结果可经人工核对后填入途经站。没有可用时刻表时明确标记为 OSM 网络推算；有歧义的同名站结合承运方与起终站自动匹配。网络断开时不绘制直线替代。跨区域长线路可添加途经站分段查询。</p><p>地图：OSM / OpenFreeMap；地形阴影：Mapzen DEM。只显示城市、主要公路、铁路、水系和地形。表格在浏览器内处理；机场坐标从本站坐标库读取；默认将站名发送至 OpenRailwayMap 站点索引、车站坐标发送至 BRouter 的铁路模式；仅选择备用 Overpass 模式时发送铁路查询范围至 Overpass；启用历史时刻表时，车次号和快照版本发送至 RailLog。刷新后数据不保留，可导出 GeoJSON。</p>');
async function openFile(file){if(!file||busy)return;if(!/\.xlsx?$/i.test(file.name))return tell('请选择 .xlsx 或 .xls 文件');try{if(!window.XLSX)throw Error('表格组件未加载，请检查网络');book=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false,cellNF:true});$('sheet').innerHTML='<option value="">请选择工作表…</option>'+(book.SheetNames.length>1?'<option value="*">全部 Sheet</option><option value="+">选择多个 Sheet…</option>':'')+book.SheetNames.map((s,i)=>`<option value="${i}">${esc(s)}</option>`).join('');$('sheetBox').hidden=false;if(book.SheetNames.length===1){$('sheet').value='0';parseSheets()}else{modal('<h2>选择要生成的工作表</h2><p>检测到 '+book.SheetNames.length+' 个 Sheet。可读取其中一个，或合并全部 Sheet 的行程。</p><select id="choose">'+$('sheet').innerHTML+'</select><p id="choiceError"></p><button class="primary" id="confirmSheet">读取所选数据</button>');$('confirmSheet').onclick=()=>{if(!$('choose').value){$('choiceError').textContent='请先选择一个 Sheet 或全部 Sheet';return}$('sheet').value=$('choose').value;$('dialog').close();if($('sheet').value==='+')chooseMultipleSheets();else parseSheets()}}}catch(e){tell('读取失败：'+e.message)}}
$('file').onchange=e=>{openFile(e.target.files[0]);e.target.value=''};$('drop').ondragover=e=>e.preventDefault();$('drop').ondrop=e=>{e.preventDefault();openFile(e.dataTransfer.files[0])};$('sheet').onchange=()=>{$('sheet').value==='+'?chooseMultipleSheets():parseSheets()};
function parseSheets(){if(busy||!book||!$('sheet').value)return;const names=$('sheet').value==='*'?book.SheetNames:$('sheet').value==='+'?book._selectedSheets:[book.SheetNames[Number($('sheet').value)]],notes=[];trips=[];selectedDay='';calendarMonth='';for(const name of names){let ws=book.Sheets[name],range=ws['!ref']?XLSX.utils.decode_range(ws['!ref']):null;if(!range){notes.push(name+'：空表');continue}let rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:'',blankrows:true}),hi=rows.slice(0,100).findIndex(r=>r.map(x=>String(x).trim()).includes('出发地')&&r.map(x=>String(x).trim()).includes('到达地'));if(hi<0){notes.push(name+'：未找到出发地/到达地表头');continue}let keys=rows[hi].map(x=>String(x).trim());for(let i=hi+1;i<rows.length;i++){let row=rows[i];if(String(row[keys.indexOf('出发地')]||'').trim()==='出发地'&&String(row[keys.indexOf('到达地')]||'').trim()==='到达地')continue;if(!row.some(x=>String(x).trim()))continue;let raw={};keys.forEach((k,j)=>{if(k)raw[k]=String(row[j]??'').trim().replace(/^#(DIV\/0!|VALUE!|N\/A|REF!|NAME\?|NUM!|NULL!)$/,'')});if(keys.every(k=>!raw[k]))continue;TripCalendar.normalize(raw);let from=raw['出发地']||'',to=raw['到达地']||'';const dateCol=keys.includes('出发日期')?keys.indexOf('出发日期'):keys.indexOf('日期');const dc=dateCol<0?null:ws[XLSX.utils.encode_cell({r:range.s.r+i,c:range.s.c+dateCol})];const time=TripData.date(raw,name,dc?{...dc,dateFormatted:XLSX.SSF.is_date(dc.z||'')}:null,!!book.Workbook?.WBProps?.date1904);trips.push({id:trips.length,selected:true,time,raw,from,to,sheet:name,row:range.s.r+i+1,mode:TripCalendar.mode(raw,from,to),via:raw['途经站']||'',error:''});const t=trips.at(-1),arrivalCol=keys.indexOf('到达日期');if(arrivalCol>=0){const ac=ws[XLSX.utils.encode_cell({r:range.s.r+i,c:range.s.c+arrivalCol})];if(ac)t.arrivalCell={...ac,dateFormatted:XLSX.SSF.is_date(ac.z||'')}}t.date1904=!!book.Workbook?.WBProps?.date1904;t.error=TripCalendar.validate(t).join('；')}}render();tell('已读取 '+names.length+' 个 Sheet，共 '+trips.length+' 条记录'+(notes.length?'；'+notes.join('；'):''));if(notes.length)modal('<h2>工作表读取结果</h2><p>已导入 '+trips.length+' 条行程。</p><pre>'+esc(notes.join('\n'))+'</pre>')}
async function overpass(q){if(cancel)throw Error('已停止');return Services.overpass(q,controller?.signal,message=>tell(message))}
function normalize(s){return s.trim().replace(/(站|駅)$/,'')}
async function locateManyOverpass(names,trip){
 if(trip.mode==='air')return Promise.all(names.map(n=>trip.overrides?.[n]||Services.airport(n,controller?.signal)));
 const required=[...new Set(names.filter(n=>!trip.overrides?.[n]))],found=new Map();
 const variants=n=>{const v=StationMatch.aliases[n]||n;return [...new Set([v,normalize(v),normalize(v)+'站',normalize(v)+'駅'])]};
 const query=(values,keys)=>'('+[...new Set(values)].flatMap(v=>keys.map(k=>'nwr["railway"~"^(station|halt)$"]["'+k+'"='+JSON.stringify(v)+'];')).join('')+');out center tags;';
 function collect(els,requested){for(const n of requested){const accepted=variants(n);let candidates=[];for(const e of els){const tags=e.tags||{},pos=e.center||e;if(!['name','name:zh','name:ja'].some(k=>accepted.includes(tags[k]))||!Number.isFinite(pos.lat)||!Number.isFinite(pos.lon))continue;const operator=tags.operator||tags.network||'';if(!candidates.some(c=>c.operator===operator&&Core.km(c.xy,[pos.lat,pos.lon])<.12))candidates.push({name:tags.name||n,operator,xy:[pos.lat,pos.lon]})}if(candidates.length)found.set(n,candidates)}}
 if(required.length){tell('批量匹配 '+required.length+' 个铁路车站');collect(await overpass(query(required.map(n=>StationMatch.aliases[n]||n),['name'])),required);const missing=required.filter(n=>!found.has(n));if(missing.length)collect(await overpass(query(missing.flatMap(variants),['name','name:zh','name:ja'])),missing)}
 const points=[];for(const n of names){if(trip.overrides?.[n]){points.push(trip.overrides[n]);trip._lastPoint=trip.overrides[n];continue}const candidates=found.get(n);if(!candidates?.length)throw Error('OSM 未找到车站 '+n+'，请核对站名');const point=StationMatch.rank(candidates,n,trip)[0].xy;trip._lastPoint=point;points.push(point)}return points;
}
async function locateMany(names,trip){if(trip.mode==='air'||$('routing').value==='overpass')return locateManyOverpass(names,trip);return RailService.locate(names,trip,controller?.signal,tell)}
async function locate(name,mode,trip){return (await locateMany([name],trip||{mode,raw:{}}))[0]}

async function railNetwork(points,trip){const lat=points.map(p=>p[0]),lon=points.map(p=>p[1]),d=Math.max(...points.map(p=>Core.km(points[0],p)));if(d>900)throw Error('单段超过 900 km，请添加途经站分段查询');const margin=Math.max(.02,Math.min(1,d/600)),box=[Math.max(-85,Math.min(...lat)-margin),Math.max(-180,Math.min(...lon)-margin),Math.min(85,Math.max(...lat)+margin),Math.min(180,Math.max(...lon)+margin)],kinds=StationMatch.context(trip||{}).operator?'rail':'rail|light_rail|subway|monorail|tram|narrow_gauge';return overpass('way["railway"~"^('+kinds+')$"]["service"!~"^(yard|siding|spur)$"]('+box.join(',')+');out geom;')}
async function railway(a,b,exactStart=false,startNodeId=null,trip=null,network=null){return Core.route(network||await railNetwork([a,b],trip),a,b,{exactStart,startNodeId})}

async function generate(t){delete t.path;const invalid=TripCalendar.validate(t);if(invalid.length)throw Error(invalid.join('；'));delete t._lastPoint;t.error='';t.candidates=null;delete t.path;if(!t.from||!t.to)throw Error('缺少出发地或到达地');if(t.from===t.to&&!t.via.trim())throw Error('起终点相同，请提供环线途经站；航空起终机场不能相同');let names=[t.from,...(t.mode==='rail'?t.via.split(/[;；]/).map(s=>s.trim()).filter(Boolean):[]),t.to];t.routingNote='';t.timetable=null;t.routeBasis='OSM 网络推算';if(t.mode==='rail'){if(t.via.trim())t.routeBasis='人工途经站约束 + OSM';else if($('routing').value==='timetable'&&TripCalendar.kind(t)==='china'){try{tell('查询历史停站：'+(t.raw['班次']||'未填车次'));t.timetable=await Timetable.lookup(t,{signal:controller?.signal});names=t.timetable.names;t.routeBasis='历史停站约束 + OSM（参考）'}catch(e){t.routingNote='未使用时刻表：'+e.message}finally{}}if(cancel)throw Error('已停止')}const routeKey='route:v6:'+($('routing').value==='overpass'?'overpass:':'brouter:')+JSON.stringify({names,operator:StationMatch.context(t).label,overrides:t.overrides||{},version:t.timetable?.version||'',train:t.timetable?.train||''});if(t.mode==='rail'){const saved=await Services.read(routeKey,30*86400000);if(saved){t.path=saved.path;t.nodeIds=saved.nodeIds;t.routeBasis=saved.routeBasis||t.routeBasis;t.status='已生成 · 复用缓存铁路轨迹';return}}const points=await locateMany(names,t);if(t.mode==='air'){if(Core.km(points[0],points.at(-1))<.001)throw Error('出发与到达机场坐标相同，无法生成航线');t.path=Core.ellipse(points[0],points.at(-1))}else if($('routing').value!=='overpass'){t.path=await RailService.route(points,controller?.signal,tell,t);delete t.nodeIds;t.routeBasis+=' · BRouter';await Services.write(routeKey,{path:t.path,routeBasis:t.routeBasis})}else{let full=[],nodeIds=[];const shared=points.length>2&&Math.max(...points.map(p=>Core.km(points[0],p)))<100?await railNetwork(points,t):null;for(let i=1;i<points.length;i++){let leg=await railway(i===1?points[0]:full.at(-1),points[i],i>1,nodeIds.at(-1),t,shared);if(i>1&&leg.nodeIds?.[0]!==nodeIds.at(-1))throw Error('途经站轨道节点不连续，无法生成完整线路');full.push(...(i===1?leg:leg.slice(1)));nodeIds.push(...(i===1?leg.nodeIds:leg.nodeIds.slice(1)))}if(full.length<2)throw Error('无法得到有效轨迹，请核对起终站或途经站');t.path=full;t.nodeIds=nodeIds;await Services.write(routeKey,{path:full,nodeIds})}t.status=t.mode==='air'?'已生成 · 机场间椭圆弧线':'已拟合 · '+t.routeBasis;}
async function run(targets){
 if(busy)return;busy=true;cancel=false;controller=new AbortController();$('stop').hidden=false;for(const id of ['file','sheet','routing'])$(id).disabled=true;
 try{render();let painted=Date.now();const update=()=>{if(Date.now()-painted>150){render();painted=Date.now()}};let i=0;for(const t of [...targets].sort((a,b)=>(a.mode==='air'?0:1)-(b.mode==='air'?0:1))){if(cancel)break;t.status='正在匹配…';tell('正在生成 '+(++i)+' / '+targets.length+' · '+t.from+' → '+t.to);update();try{await generate(t)}catch(e){t.error=cancel?'已停止':e.message;if(e.candidates)t.candidates={name:e.station,items:e.candidates}}update();if(!cancel)await new Promise(r=>setTimeout(r,0))}}
 finally{busy=false;$('stop').hidden=true;for(const id of ['file','sheet','routing'])$(id).disabled=false;render();fit();tell((cancel?'已停止；':'处理完成；')+trips.filter(t=>t.path).length+' 条已生成，'+trips.filter(t=>t.error).length+' 条待处理。点击记录可修正。')}
}
function runScope(scope){if(busy)return;const targets=trips.filter(t=>scope==='all'||scope==='selected'&&t.selected!==false||t.mode===scope);if(!targets.length)return tell('该范围内没有行程');targets.forEach(t=>t.selected=true);render();const pending=targets.filter(t=>!t.path);if(!pending.length){fit();return tell('所选行程已有轨迹，已显示；取消勾选可隐藏')}return run(pending)}
$('run').onclick=()=>runScope('all');$('runSelected').onclick=()=>runScope('selected');$('runRail').onclick=()=>runScope('rail');$('runAir').onclick=()=>runScope('air');$('stop').onclick=()=>{cancel=true;controller?.abort()};
function showTrip(t){if(!t)return;fit(displayPaths().get(t.id)||[]);modal('<h2>'+esc(t.from)+' → '+esc(t.to)+'</h2><p>'+esc(t.time?.label||'日期未知')+' '+esc(t.time?.departure||'')+'</p><p>'+esc(t.time?.note||'')+'</p><p>'+esc(t.sheet)+' · 第 '+t.row+' 行</p><pre>'+esc(Object.entries(t.raw).map(([k,v])=>(k==='腐败率'?'每公里单价':k)+'：'+v).join('\n'))+'</pre><p>'+esc(t.routeBasis||'')+'</p><p>'+esc(t.timetable?.source||t.routingNote||'')+'</p><p>'+esc(t.timetable?.names.join(' → ')||'')+'</p><p class="bad">'+esc(t.error)+'</p><label>出发日期<input id="editDate" placeholder="2026-05-07" value="'+esc(t.time?.day!=null?t.time.label:t.raw['日期']||'')+'"></label><label>到达日期（可选）<input id="editArrivalDate" placeholder="跨时区或多日行程建议填写" value="'+esc(t.raw['到达日期']||'')+'"></label><label>车次 / 航班号<input id="editNumber" value="'+esc(t.raw['班次']||'')+'"></label><label>出发地<input id="editFrom" value="'+esc(t.from)+'"></label><label>到达地<input id="editTo" value="'+esc(t.to)+'"></label><label>交通方式<select id="mode"><option value="rail">铁路</option><option value="air">飞行</option></select></label><label>人工途经站（可参考路路通核对，按顺序用 ; 分隔）<input id="via" value="'+esc(t.via)+'"></label>'+(t.candidates?'<label>选择 '+esc(t.candidates.name)+' 的位置<select id="candidate"><option value="">请选择…</option>'+t.candidates.items.map((c,i)=>'<option value="'+i+'">'+esc(c.label)+'</option>').join('')+'</select></label>':'')+'<label>出发地手动坐标（纬度,经度，可留空）<input id="fromXY" placeholder="31.1979,121.3363" value="'+esc(t.overrides?.[t.from]?.join(',')||'')+'"></label><label>到达地手动坐标（纬度,经度，可留空）<input id="toXY" value="'+esc(t.overrides?.[t.to]?.join(',')||'')+'"></label><p id="editError"></p><button class="primary" id="retry" '+(busy?'disabled':'')+'>保存并重新生成</button>');$('mode').value=t.mode;$('retry').onclick=()=>{try{const overrides={...(t.overrides||{})};for(const [id,n] of [['fromXY',t.from],['toXY',t.to]]){const v=$(id).value.trim();if(v){let p=v.split(/[,，]/).map(Number);if(p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>85||Math.abs(p[1])>180)throw Error('坐标格式应为 纬度,经度，纬度范围 ±85°');overrides[n]=p}else delete overrides[n]}if(t.candidates&&$('candidate').value!=='')overrides[t.candidates.name]=t.candidates.items[Number($('candidate').value)].xy;t.raw['日期']=$('editDate').value.trim();t.raw['出发日期']=t.raw['日期'];t.raw['到达日期']=$('editArrivalDate').value.trim();delete t.arrivalCell;t.raw['班次']=$('editNumber').value.trim();t.from=t.raw['出发地']=$('editFrom').value.trim();t.to=t.raw['到达地']=$('editTo').value.trim();t.time=TripData.date(t.raw,t.sheet);t.overrides=overrides;t.mode=$('mode').value;t.via=$('via').value;$('dialog').close();run([t])}catch(e){$('editError').textContent=e.message}}}
$('export').onclick=()=>{let data=collection();if(!data.features.length)return tell('当前筛选下没有可导出的轨迹');let url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/geo+json'})),a=document.createElement('a');a.href=url;a.download='行迹-轨迹.geojson';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
$('routing').onchange=()=>{if(busy)return;for(const t of trips)if(t.mode==='rail'){delete t.path;delete t.nodeIds;t.status='线路依据已变更，待重新生成';t.error='';t.timetable=null;t.routingNote=''}render();tell('铁路线路依据已变更，请重新生成轨迹')};
$('clear').onclick=()=>{if(busy)return tell('请先停止正在进行的生成任务');trips=[];selectedDay='';calendarMonth='';book=null;cache.clear();$('sheetBox').hidden=true;render();tell('已清空；可导入新的行程表')};

$('archive').onclick=async()=>{if(busy||!trips.length)return tell('请先导入行程，且等待当前任务完成');busy=true;cancel=false;controller=new AbortController();$('stop').hidden=false;for(const id of ['file','sheet','routing','archive'])$(id).disabled=true;render();try{const r=await Timetable.archive(trips,{signal:controller.signal,onProgress:p=>tell('历史缓存 '+p.done+'/'+p.total+' · '+p.train+' · '+p.version)});tell('历史缓存完成：'+r.ok+' 份有停站表，'+r.missing+' 份无此车次，'+r.errors+' 份查询失败。按年代表快照及行程日期缓存，并非所有日期全量数据。')}catch(e){tell(e.message)}finally{busy=false;$('stop').hidden=true;for(const id of ['file','sheet','routing','archive'])$(id).disabled=false;render()}};

$('cacheInfo').onclick=async()=>{try{const m=await TimetableCache.index(),years=new Map();for(const s of m.snapshots){const y=s.date.slice(0,4),v=years.get(y)||{versions:0,max:0};v.versions++;v.max=Math.max(v.max,s.trains);years.set(y,v)}modal('<h2>本站时刻表缓存</h2><p>已保存 '+(m.bulkCount||m.snapshots.length)+' 份批量快照，另补充 '+(m.historyRecords||0)+' 条历史时刻记录。历史补充尚在进行，未完成的版本不计为全量。生成时按需读取对应快照。</p><ul>'+[...years].map(([y,v])=>'<li>'+esc(y)+' 年：'+v.versions+' 个快照，单份缓存最多 '+v.max+' 个车次号（含换号）。</li>').join('')+'</ul><p>尚未取得批量缓存的年份：'+esc((m.missingYears||[]).join('、')||'无')+'。这些年份仍按需查询 RailLog，并缓存在本机；不代表已经保存到 GitHub。</p><p>快照是采集时的停站表，不保证历史某一天实际开行；部分源文件本身可能不完整。不会用晚于行程日期的快照替代。</p><p>来源：<a href="https://github.com/wj0575/RailRhythm12306" target="_blank" rel="noreferrer">RailRhythm12306</a>；<a href="https://github.com/wensimehrp/chinese-railway-gtfs" target="_blank" rel="noreferrer">Chinese Railway GTFS · CC BY 4.0</a>。</p>')}catch(e){tell('无法读取本站缓存清单：'+e.message)}};

;
// ui-controls.js
function chooseMultipleSheets(){
 if(!book)return;
 modal('<h2>选择工作表</h2><p>可合并不同年份的工作表。日期使用各行日期或对应 Sheet 年份。</p><div class="sheet-options">'+book.SheetNames.map((n,i)=>'<label><input type="checkbox" data-sheet-index="'+i+'" checked> '+esc(n)+'</label>').join('')+'</div><p id="choiceError"></p><button id="readSheets" class="primary">读取勾选工作表</button>');
 $('readSheets').onclick=()=>{const names=[...$('detail').querySelectorAll('[data-sheet-index]:checked')].map(e=>book.SheetNames[Number(e.dataset.sheetIndex)]);if(!names.length){$('choiceError').textContent='请至少选择一个工作表';return}book._selectedSheets=names;$('sheet').value='+';$('dialog').close();parseSheets()};
}
$('toggleSidebar').onclick=()=>{const collapsed=document.body.classList.toggle('sidebar-collapsed');$('toggleSidebar').setAttribute('aria-expanded',String(!collapsed));setTimeout(()=>map.resize(),220)};
let shareURL=null;
$('share').onclick=async()=>{
 if(busy)return tell('请等待生成完成再分享');
 $('share').disabled=true;
 try{const blob=await ShareImage.create(collection(),MapPresentation.stops(visible()),{onProgress:tell});if(shareURL)URL.revokeObjectURL(shareURL);shareURL=URL.createObjectURL(blob);modal('<h2>分享行程图片</h2><p>图片仅包含当前显示的轨迹，在本机生成。</p><img class="share-preview" src="'+shareURL+'" alt="行程地图分享大图"><p><a class="primary share-download" download="行程地图.png" href="'+shareURL+'">下载 PNG 大图</a></p><button id="nativeShare">系统分享</button>');$('nativeShare').onclick=async()=>{const file=new File([blob],'行程地图.png',{type:'image/png'});if(!navigator.canShare?.({files:[file]}))return tell('此浏览器不支持系统分享，请下载 PNG 后分享');try{await navigator.share({files:[file],title:'行程地图'})}catch(e){if(e.name!=='AbortError')tell('分享失败：'+e.message)}};tell('分享图片已生成')}
 catch(e){tell(e.message)}finally{$('share').disabled=false}
};
// Do not count localhost development or send itinerary data to analytics.
if(typeof location!=='undefined'&&location.hostname==='iicpcw.github.io'){
 const counter=document.createElement('script');counter.async=true;counter.src='https://busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js';counter.onerror=()=>{const el=document.querySelector('.site-footer small');if(el)el.textContent='访客统计暂不可用'};document.head.appendChild(counter);
}
