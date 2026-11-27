const MapPresentation=(()=>{
function airportImage(){const c=document.createElement('canvas');c.width=c.height=48;const x=c.getContext('2d');x.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?9:21,px=24+Math.cos(a)*r,py=24+Math.sin(a)*r;i?x.lineTo(px,py):x.moveTo(px,py)}x.closePath();x.fillStyle='#ffe133';x.strokeStyle='#5c4b00';x.lineWidth=3;x.fill();x.stroke();return x.getImageData(0,0,48,48)}
function airports(map){if(!map.hasImage('airport-star'))map.addImage('airport-star',airportImage(),{pixelRatio:2});map.addLayer({id:'airport-stars',type:'symbol',source:'stops',filter:['==',['get','mode'],'air'],layout:{'icon-image':'airport-star','icon-size':1.2,'icon-allow-overlap':true,'icon-ignore-placement':true}})}
function stops(rows){const result=new Map();for(const t of rows)if(t.path&&t.selected!==false)for(const [p,label] of [[t.path[0],t.from],[t.path.at(-1),t.to]]){const key=t.mode+':'+p.join(',');result.set(key,{type:'Feature',properties:{mode:t.mode,label},geometry:{type:'Point',coordinates:[p[1],p[0]]}})}return{type:'FeatureCollection',features:[...result.values()]}}
function add(map,data,stopData){
 map.addSource('journeys',{type:'geojson',data});map.addSource('stops',{type:'geojson',data:stopData});
 map.addLayer({id:'journey-outline',type:'line',source:'journeys',paint:{'line-color':'#645218','line-width':['match',['get','mode'],'air',6.5,5.5],'line-opacity':['match',['get','mode'],'air',.85,0]}});
 map.addLayer({id:'journey-lines',type:'line',source:'journeys',paint:{'line-color':['match',['get','mode'],'air','#ffe133','#dc3038'],'line-width':['match',['get','mode'],'air',4.5,3.5],'line-opacity':['match',['get','mode'],'air',1,.58]}});
 map.addLayer({id:'stop-points',type:'circle',source:'stops',filter:['!=',['get','mode'],'air'],paint:{'circle-radius':4,'circle-color':'#fff','circle-stroke-color':'#33755b','circle-stroke-width':2}});airports(map);
}
return{airports,stops,add};})();
if(typeof module!=='undefined')module.exports=MapPresentation;
