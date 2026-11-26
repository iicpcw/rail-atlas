const StationMatch=(()=>{
const aliases={'新桥':'新橋','东京':'東京','成田机场':'成田空港','京成上野':'京成上野'};
function context(t={}){const pair=[t.from,t.to].join('|'),carrier=t.raw?.['承运']||'';
if(/广东城际|廣東城際/.test(carrier)||/琶洲|白云机场东/.test(pair))return{label:'广东城际',operator:/广东城际|廣東城際|Guangdong Intercity|广州地铁集团|Guangzhou Metro Group/i,center:[23.2,113.4]};
if(/京成|Keisei/i.test(pair+' '+carrier))return{label:'京成电铁',operator:/京成|Keisei/i,center:[35.75,140]};
if(/JRE|JR East|東日本旅客|东日本旅客/i.test(carrier)||/^(新桥|新橋|上野)\|(新桥|新橋|上野)$/.test(pair))return{label:'JR 东日本',operator:/JR.?East|東日本旅客|东日本旅客|JRE/i,center:[35.7,139.77]};
if(/国铁|國鐵|铁路局|铁路集团|局集团|China Railway/i.test(carrier)||/嘉兴南|上海南/.test(pair)||/^[GDKTZYCSP]\d/i.test(t.raw?.['班次']||''))return{label:'国铁',operator:/中国铁路|中國鐵路|国铁|國鐵|China Railway|铁路局|局集团|铁路集团/i,center:/嘉兴南|上海南/.test(pair)?[31,121]:null};return{label:carrier,operator:null,center:null}}
function rank(candidates,name,t){const ctx=context(t),anchor=t?._lastPoint||ctx.center;function score(c){return(ctx.operator?.test(c.operator)?1000:0)+(c.name===(aliases[name]||name)?100:0)-(anchor?Core.km(c.xy,anchor):0)}return [...candidates].sort((a,b)=>score(b)-score(a))}
return{aliases,context,rank};})();
if(typeof module!=='undefined')module.exports=StationMatch;
