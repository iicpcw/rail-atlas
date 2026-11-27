const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const els=new Map(),get=id=>{if(!els.has(id))els.set(id,{value:id==='filter'?'all':'',textContent:'',innerHTML:''});return els.get(id)};
const ctx={console,Core:require('../dist/core.js'),TripData:require('../dist/trips.js'),document:{getElementById:get},maplibregl:{Map:class{on(){}addControl(){}},NavigationControl:class{}},setTimeout,clearTimeout};vm.createContext(ctx);for(const file of ['calendar.js','cards.js','app.js'])vm.runInContext(fs.readFileSync(__dirname+'/../dist/'+file,'utf8'),ctx);
vm.runInContext("trips=[{id:1,mode:'air',from:'SHA',to:'HND',raw:{},path:[[31,121],[35,139]]},{id:2,mode:'rail',from:'A',to:'B',raw:{},path:[[30,120],[31,121]]},{id:3,mode:'rail',from:'B',to:'C',raw:{},selected:false}];render();",ctx);
assert.equal(vm.runInContext('collection().features.length',ctx),2);
get('list').onchange({target:{dataset:{select:'1'},checked:false}});assert.equal(vm.runInContext('collection().features.length',ctx),1);assert(vm.runInContext('!!trips[0].path',ctx));
get('selectNone').onclick();assert.equal(vm.runInContext('collection().features.length',ctx),0);get('selectAll').onclick();assert.equal(vm.runInContext('collection().features.length',ctx),2);
vm.runInContext('let requested=[];run=async ts=>{requested=ts.map(t=>t.id)};fit=()=>{};',ctx);get('runRail').onclick();assert.equal(vm.runInContext('requested.join()',ctx),'3');vm.runInContext('trips.forEach(t=>{delete t.path;t.selected=false});trips[0].selected=true;',ctx);get('runSelected').onclick();assert.equal(vm.runInContext('requested.join()',ctx),'1');get('runAir').onclick();assert.equal(vm.runInContext('requested.join()',ctx),'1');get('run').onclick();assert.equal(vm.runInContext('requested.join()',ctx),'1,2,3');
console.log('PASS: selection hides without deleting, restores, and scopes generation by mode/all/selected');
vm.runInContext("trips=[{id:1,mode:'air',from:'SHA',to:'HND',raw:{'日期':'2026-12-31','出发时间':'2300','到达时间':'0600','班次':'FM815'},path:[[31,121],[35,139]],selected:true},{id:2,mode:'rail',from:'新桥',to:'上野',raw:{'日期':'2027-01-02'},path:[[35,139],[35.1,139.1]],selected:true},{id:3,mode:'air',from:'HND',to:'SHA',raw:{'班次':'FM816'},path:[[35,139],[31,121]],selected:false}];trips.forEach(t=>t.time=TripData.date(t.raw,'公开测试'));render();",ctx);
assert.match(get('calendarDays').innerHTML,/data-day="2027-01-03" disabled/);
get('calendarDays').onclick({target:{closest:()=>({dataset:{day:'2027-01-01'}})}});assert.equal(vm.runInContext('visible().length',ctx),1);assert.equal(vm.runInContext('collection().features.length',ctx),1);assert.equal(vm.runInContext('trips.filter(t=>t.path).length',ctx),3);
get('calendarDays').onclick({target:{closest:()=>({dataset:{day:'2027-01-03'}})}});assert.equal(vm.runInContext('selectedDay',ctx),'2027-01-01');
get('calendarAll').onclick();assert.equal(vm.runInContext('visible().length',ctx),3);assert.equal(vm.runInContext('collection().features.length',ctx),2);assert.equal(vm.runInContext('trips[2].selected',ctx),false);
get('calendarUnknown').onclick();assert.equal(vm.runInContext('visible()[0].id',ctx),3);get('runAir').onclick();assert.equal(vm.runInContext('collection().features.length',ctx),1);
console.log('PASS: disabled dates, cross-day list/map filtering, undated flights and selection/path retention');

vm.runInContext("selectedDay='';failedFirst=true;trips[0].error='failed';delete trips[0].path;",ctx);assert.equal(vm.runInContext('visible()[0].id',ctx),1);
console.log('PASS: failed older journeys precede newer successful journeys');
