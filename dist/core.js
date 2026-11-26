/* Pure routing helpers: original OSM node IDs preserve topology. */
const Core=(()=>{
function km(a,b){let r=Math.PI/180,p=(b[0]-a[0])*r,q=(b[1]-a[1])*r,s=Math.sin(p/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(q/2)**2;return 12742*Math.asin(Math.sqrt(Math.min(1,s)))}
function ellipse(a,b,bend=.20){
 const rad=Math.PI/180,project=lat=>Math.log(Math.tan(Math.PI/4+Math.max(-85,Math.min(85,lat))*rad/2));
 let end=b[1];while(end-a[1]>180)end-=360;while(end-a[1]<-180)end+=360;
 const ax=a[1]*rad,ay=project(a[0]),bx=end*rad,by=project(b[0]),dx=bx-ax,dy=by-ay;
 // Use a common polar bound for every curve in the group; distinct bends remain distinct.
 const room=Math.max(0,project(85)-Math.max(Math.abs(ay),Math.abs(by))),scale=Math.abs(dx)>.000001?Math.min(1,room/(.55*Math.abs(dx))):1;
 const out=[];for(let i=0;i<=100;i++){const t=Math.PI*i/100,u=(1-Math.cos(t))/2,v=bend*scale*Math.sin(t);out.push([(2*Math.atan(Math.exp(ay+dy*u+dx*v))-Math.PI/2)/rad,(ax+dx*u-dy*v)/rad])}
 out[0]=[...a];out[100]=[b[0],end];return out;
}
function geoJSONPath(path){
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

