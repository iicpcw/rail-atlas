const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');const c={TripData:require('../dist/trips.js'),module:{exports:{}}};vm.createContext(c);for(const f of ['calendar','manual-entry'])vm.runInContext(fs.readFileSync(__dirname+'/../dist/'+f+'.js','utf8'),c);const make=c.module.exports.make;
assert.throws(()=>make({kind:'china',date:'2025-10-12',from:'南通',to:'盐城'},1),/车次/);assert.throws(()=>make({kind:'china',number:'G2682',from:'南通',to:'盐城'},1),/日期/);
assert.equal(make({kind:'china',date:'2025-10-12',number:'G2682',from:'南通',to:'盐城'},7).id,7);
assert.equal(make({kind:'japan',date:'2025-05-07',from:'新橋',to:'上野'},2).mode,'rail');assert.throws(()=>make({kind:'japan',from:'新橋',to:'上野'},2),/日期/);
const flight=make({kind:'air',from:'sha',to:'hnd',number:'fm815'},3);assert.equal(flight.from,'SHA');assert.equal(flight.time.day,null);assert.throws(()=>make({kind:'air',from:'上海',to:'HND',number:'FM815'},3),/三字码/);assert.throws(()=>make({kind:'air',from:'SHA',to:'HND'},3),/航班号/);
console.log('PASS: manual entries enforce national/Japan/flight required fields and allow undated flights');
