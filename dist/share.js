const ShareImage=(()=>{
async function create(data,stops,{signal,onProgress=()=>{}}={}){
 if(!data.features.length)throw Error('请先生成并显示需要分享的轨迹');
 const width=1920,height=1120,container=document.createElement('div');Object.assign(container.style,{position:'fixed',left:'-10000px',top:'0',width:width+'px',height:height+'px'});document.body.appendChild(container);
 let preview;
 try{
  preview=new maplibregl.Map({container,style:'map-style.json',interactive:false,attributionControl:false,preserveDrawingBuffer:true,pixelRatio:1});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('分享底图加载超时，请稍后重试')),45000),abort=()=>{clearTimeout(timer);reject(Error('已取消分享'))};signal?.addEventListener('abort',abort,{once:true});preview.once('load',()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve()})});
  MapPresentation.add(preview,data,stops);
  const coordinates=data.features.flatMap(f=>f.geometry.type==='MultiLineString'?f.geometry.coordinates.flat():f.geometry.coordinates),bounds=new maplibregl.LngLatBounds();
  // Unwrap around the first coordinate so Pacific crossings don't fit the whole world.
  const origin=coordinates[0][0];for(const xy of coordinates){let lon=xy[0];while(lon-origin>180)lon-=360;while(lon-origin< -180)lon+=360;bounds.extend([lon,xy[1]])}
  preview.fitBounds(bounds,{padding:90,maxZoom:13,duration:0});onProgress('正在绘制分享大图…');
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('分享地图资源未加载完成，请重试')),45000);preview.once('idle',()=>{clearTimeout(timer);resolve()})});
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height+160;const c=canvas.getContext('2d');c.fillStyle='#f6f8f6';c.fillRect(0,0,canvas.width,canvas.height);c.drawImage(preview.getCanvas(),0,70,width,height);c.fillStyle='#243e3b';c.font='bold 32px sans-serif';c.fillText('我的行程地图',44,46);c.font='20px sans-serif';c.fillText(data.features.length+' 段行程',width-220,46);c.font='17px sans-serif';c.fillText('铁路 / 航空轨迹 · github.com/iicpcw/rail-atlas',44,height+112);c.font='14px sans-serif';c.fillText('© OpenStreetMap contributors · OpenFreeMap · 地形 Mapzen / 地图数据 ODbL',44,height+141);
  return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('无法生成图片')),'image/png'));
 }finally{preview?.remove();container.remove()}
}
return{create};})();
