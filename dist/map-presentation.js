const MapPresentation=(()=>{
function stops(rows){const result=new Map();for(const t of rows)if(t.path&&t.selected!==false)for(const [p,label] of [[t.path[0],t.from],[t.path.at(-1),t.to]]){const key=t.mode+':'+p.join(',');result.set(key,{type:'Feature',properties:{mode:t.mode,label},geometry:{type:'Point',coordinates:[p[1],p[0]]}})}return{type:'FeatureCollection',features:[...result.values()]}}
function add(map,data,stopData){
 map.addSource('journeys',{type:'geojson',data});map.addSource('stops',{type:'geojson',data:stopData});
 map.addLayer({id:'flight-lines',type:'line',source:'journeys',filter:['==',['get','mode'],'air'],paint:{'line-color':'#e6bf00','line-width':1.5,'line-opacity':.55}});
 map.addLayer({id:'journey-lines',type:'line',source:'journeys',filter:['!=',['get','mode'],'air'],paint:{'line-color':'#dc3038','line-width':3.5,'line-opacity':.58}});
 map.addLayer({id:'stop-points',type:'circle',source:'stops',paint:{'circle-radius':4,'circle-color':['match',['get','mode'],'air','#e6bf00','#33755b']}});

}
return{stops,add};})();
if(typeof module!=='undefined')module.exports=MapPresentation;
