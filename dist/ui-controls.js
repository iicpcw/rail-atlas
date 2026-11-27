function chooseMultipleSheets(){
 if(!book)return;
 modal('<h2>选择工作表</h2><p>可合并不同年份的工作表。日期使用各行日期或对应 Sheet 年份。</p><div class="sheet-options">'+book.SheetNames.map((n,i)=>'<label><input type="checkbox" data-sheet-index="'+i+'" checked> '+esc(n)+'</label>').join('')+'</div><p id="choiceError"></p><button id="readSheets" class="primary">读取勾选工作表</button>');
 $('readSheets').onclick=()=>{const names=[...$('detail').querySelectorAll('[data-sheet-index]:checked')].map(e=>book.SheetNames[Number(e.dataset.sheetIndex)]);if(!names.length){$('choiceError').textContent='请至少选择一个工作表';return}book._selectedSheets=names;$('sheet').value='+';$('dialog').close();parseSheets()};
}
$('toggleSidebar').onclick=()=>{const collapsed=document.body.classList.toggle('sidebar-collapsed');$('toggleSidebar').setAttribute('aria-expanded',String(!collapsed));setTimeout(()=>map.resize(),220)};
let shareURL=null;
$('share').onclick=async()=>{
 if(busy)return tell('请等待生成完成再分享');
 $('share').disabled=true;
 try{const blob=await ShareImage.create(collection(),MapPresentation.stops(visible()),{onProgress:tell});if(shareURL)URL.revokeObjectURL(shareURL);shareURL=URL.createObjectURL(blob);modal('<h2>分享行程图片</h2><p>图片仅包含当前显示的轨迹，在本机生成。</p><img class="share-preview" src="'+shareURL+'" alt="行程地图分享大图"><p><a class="primary share-download" download="行程地图.png" href="'+shareURL+'">下载 PNG 大图</a></p><button id="nativeShare">系统分享</button>');$('nativeShare').onclick=async()=>{const file=new File([blob],'行程地图.png',{type:'image/png'});if(!navigator.canShare?.({files:[file]}))return tell('此浏览器不支持系统分享，请下载 PNG 后分享');try{await navigator.share({files:[file],title:'行程地图'})}catch(e){if(e.name!=='AbortError')tell('分享失败：'+e.message)}};tell('分享图片已生成')}
 catch(e){tell(e.message)}finally{$('share').disabled=false}
};
// Do not count localhost development or send itinerary data to analytics.
if(typeof location!=='undefined'&&location.hostname==='iicpcw.github.io'){
 const counter=document.createElement('script');counter.async=true;counter.src='https://busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js';counter.onerror=()=>{const el=document.querySelector('.site-footer small');if(el)el.textContent='访客统计暂不可用'};document.head.appendChild(counter);
}
