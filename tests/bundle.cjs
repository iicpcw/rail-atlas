const assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const dist=path.join(__dirname,'../dist'),html=fs.readFileSync(path.join(dist,'index.html'),'utf8'),match=html.match(/src="(app\.[a-f0-9]+\.bundle\.js)"/);assert(match,'HTML must reference a versioned bundle');assert(!html.includes('src="app.js"'));
const ctx={setTimeout,clearTimeout,AbortController,URL,URLSearchParams,document:{getElementById:()=>({})},maplibregl:{Map:class{on(){}addControl(){}},NavigationControl:class{}}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(dist,match[1]),'utf8'),ctx);
for(const name of ['StationMatch','Services','Core','TripData','Timetable'])assert.equal(vm.runInContext('typeof '+name,ctx),'object',name+' must be defined');
assert.equal(vm.runInContext("StationMatch.context({from:'新桥',to:'上野'}).label",ctx),'JR 东日本');console.log('PASS: production HTML loads all dependencies together; StationMatch is defined');
