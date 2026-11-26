const TripData=(()=>{
const pad=n=>String(n).padStart(2,'0');
function clock(value){let s=String(value??'').trim(),h,m;if(!s)return null;
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
