const assert=require('assert/strict'),C=require('../dist/core.js'),TT=require('../dist/timetable.js');
for(const [a,b]of [[[70,170],[75,-160]],[[-70,-170],[70,175]],[[80,-80],[80,100]],[[31,121],[35,139]]]){
 for(const bend of [-.55,.12,.55]){
  const p=C.ellipse(a,b,bend);assert.deepEqual(p[0],a);assert(Math.abs(p.at(-1)[0]-b[0])<1e-9);
  assert(p.every(v=>v.every(Number.isFinite)&&Math.abs(v[0])<=85.000001));
  const g=C.geoJSONPath(p),parts=g.type==='LineString'?[g.coordinates]:g.coordinates;
  for(const part of parts){assert(part.length>=2);assert(part.every(v=>Math.abs(v[0])<=180&&Math.abs(v[1])<=85.000001));for(let i=1;i<part.length;i++)assert(Math.abs(part[i][0]-part[i-1][0])<=180)}
 }
}
assert.equal(C.geoJSONPath([[30,179],[31,181]]).type,'MultiLineString');
const disconnected=[{type:'way',nodes:[1,2],geometry:[{lat:0,lon:0},{lat:0,lon:.001}]},{type:'way',nodes:[3,4],geometry:[{lat:0,lon:.001},{lat:0,lon:.02}]}];
assert.throws(()=>C.route(disconnected,[0,.001],[0,.02],{startNodeId:2}),'Cannot transfer between disconnected OSM node IDs at identical coordinates');
const connected=C.route(disconnected,[0,.001],[0,.02],{startNodeId:3});assert.deepEqual(connected.nodeIds,[3,4]);
// Cancelling a timetable request aborts its in-flight fetch instead of waiting for timeout.
global.fetch=(_url,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})});
(async()=>{const c=new AbortController(),pending=TT.lookup({time:{day:Date.UTC(2026,10,25),label:'2026-11-25'},raw:{班次:'G1'},from:'北京南',to:'上海虹桥'},{signal:c.signal});c.abort();await assert.rejects(pending,/Aborted/);console.log('PASS: polar flight bounds, antimeridian GeoJSON splitting, exact OSM node identity, immediate timetable cancellation.');})().catch(e=>{console.error(e);process.exitCode=1});
