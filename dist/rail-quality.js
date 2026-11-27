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
