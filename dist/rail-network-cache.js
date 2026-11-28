const RailNetworkCache=(()=>{
 let index;const regions=new Map();
 async function lookup(points,signal){
  try{
   if(!index)index=await Services.json('data/rail-networks/index.json',{signal,timeout:4000});
   for(const r of index.regions||[]){const [s,w,n,e]=r.bounds||[];if(!points.every(p=>p[0]>=s&&p[0]<=n&&p[1]>=w&&p[1]<=e)||!/^[-a-z0-9]+\.json$/.test(r.file))continue;
    if(!regions.has(r.file))regions.set(r.file,await Services.json('data/rail-networks/'+r.file,{signal,timeout:5000}));
    const data=regions.get(r.file);if(Array.isArray(data.elements))return data.elements;
   }
  }catch(e){if(signal?.aborted)throw e}
  return null;
 }
 return{lookup};
})();
if(typeof module!=='undefined')module.exports=RailNetworkCache;
