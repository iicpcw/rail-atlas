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
