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
