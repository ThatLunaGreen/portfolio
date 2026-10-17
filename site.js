/* Visitor runtime. Scene drawing is shared with the local editor; this file contains no editing or persistence UI. */
(function () {
  'use strict';
  const $=id=>document.getElementById(id), num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const state={project:null,assets:{},pageId:null},pageCache=new Map(),fontCache=new Map();
  let interactions=null,navigation=0,canvasFrame=null,canvasHost=null,mediaObserver=null;
  const status=$('siteStatus'),scroll=$('siteScroll'),frame=$('siteFrame'),stage=$('siteStage');
  function safeLink(value){if(!value)return '';const s=String(value).trim();return /^(https?:\/\/|mailto:|tel:|#page:[\w.-]+$|#layer:[\w.-]+$|#anchor:[\w.-]+$|#asset:[\w.-]+$|#experience:[\w.-]+$)/i.test(s)?s:'';}
  function el(tag,props={},children=[]){const node=document.createElement(tag);if(tag==='img'){const priority=priorityImageURLs.has(props.src);node.loading=priority?'eager':'lazy';node.decoding='async';if(priority)node.fetchPriority='high';}for(const[key,value]of Object.entries(props)){if(key==='class')node.className=value;else if(key==='text')node.textContent=value;else if(key==='style')Object.assign(node.style,value);else if(key.startsWith('on'))node.addEventListener(key.slice(2).toLowerCase(),value);else if(key in node&&key!=='list')node[key]=value;else node.setAttribute(key,value);}for(const child of [].concat(children))if(child!=null)node.append(typeof child==='string'?document.createTextNode(child):child);return node;}
  const page=()=>pageCache.get(state.pageId);
  function locate(layerId,p=page()){let found;function search(layers,parent,ancestors){for(let i=0;i<layers.length;i++){const layer=layers[i];if(layer.id===layerId){found={layer,parent,ancestors,container:layers,index:i};return true;}if(layer.type==='group'&&search(layer.children||[],layer,[...ancestors,layer]))return true;}return false;}if(p)search(p.layers,null,[]);return found;}
  const deferredMedia=new Map(),preloadedImages=new Map();
  let priorityImageURLs=new Set();
  function multiplyMatrix(a,b){return[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
  function layerMatrix(layer){const angle=num(layer.rotation)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),cx=num(layer.width)/2,cy=num(layer.height)/2;return[c,s,-s,c,num(layer.x)+cx-c*cx+s*cy,num(layer.y)+cy-s*cx-c*cy];}
  function firstViewportImages(p){
    const urls=new Set();if(isCanvas(p))return urls;
    const padding=parseFloat(getComputedStyle(scroll).paddingLeft)||0,width=Math.min(state.project.previewSettings?.maxWidth||1100,Math.max(1,scroll.clientWidth-padding*2));
    const bottom=((scroll.clientHeight||innerHeight||800)+160)/(width/p.width);
    const add=id=>{const asset=state.assets[id];if(asset?.mime?.startsWith('image/')&&asset.dataUrl)urls.add(asset.dataUrl);};
    function walk(layers,parent){for(const layer of layers||[]){if(layer.visible===false)continue;const m=multiplyMatrix(parent,layerMatrix(layer));if(layer.type==='group'){walk(layer.children,multiplyMatrix(m,[num(layer.scaleX,1)||1,0,0,num(layer.scaleY,1)||1,0,0]));continue;}const points=[[0,0],[num(layer.width),0],[0,num(layer.height)],[num(layer.width),num(layer.height)]].map(([x,y])=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]),xs=points.map(v=>v[0]),ys=points.map(v=>v[1]);if(Math.max(...ys)<0||Math.min(...ys)>bottom||Math.max(...xs)<0||Math.min(...xs)>p.width)continue;if(layer.type==='image')add(layer.assetId);else if(layer.type==='device'){const asset=state.assets[layer.media?.assetId],video=(asset?.mime||layer.media?.mime||'').startsWith('video/');add(video?layer.media?.posterAssetId:layer.media?.assetId);}}}
    walk(p.layers,[1,0,0,1,0,0]);return urls;
  }
  function primeImages(urls){for(const url of urls){if(preloadedImages.has(url))continue;const image=new Image();image.decoding='async';image.loading='eager';image.fetchPriority='high';image.src=url;const decoded=typeof image.decode==='function'?image.decode().catch(()=>null):Promise.resolve();preloadedImages.set(url,{image,decoded});if(preloadedImages.size>32)preloadedImages.delete(preloadedImages.keys().next().value);}}
  function deferMedia(node,activate){deferredMedia.set(node,activate);}
  function activateDeferredMedia(){
    if(!deferredMedia.size)return;
    if(typeof IntersectionObserver==='undefined'){for(const activate of deferredMedia.values())activate();deferredMedia.clear();return;}
    mediaObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;const activate=deferredMedia.get(entry.target);if(!activate)continue;deferredMedia.delete(entry.target);mediaObserver.unobserve(entry.target);activate();}},{root:scroll,rootMargin:'600px 0px'});
    for(const node of deferredMedia.keys())mediaObserver.observe(node);
  }
  function clearDeferredMedia(){mediaObserver?.disconnect();mediaObserver=null;deferredMedia.clear();for(const video of stage.querySelectorAll('video')){video.pause();video.removeAttribute('src');video.load();}}
  function effectImage(node,layer,asset){const render=()=>LunaRenderer.renderImageLayer(layer,asset).then(canvas=>{if(!node.isConnected)return;const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;copy.getContext('2d').drawImage(canvas,0,0);Object.assign(copy.style,{width:'100%',height:'100%',pointerEvents:'none'});node.append(copy);}).catch(()=>{if(node.isConnected)node.append(cropImageDOM(layer,asset));});if(priorityImageURLs.has(asset.dataUrl))render();else deferMedia(node,render);}
  function deferVideo(video,source,poster){let active=false;const activate=()=>{if(active)return;active=true;if(poster)video.poster=poster.dataUrl;video.src=source;};deferMedia(video,activate);for(const event of ['pointerdown','focus','keydown'])video.addEventListener(event,activate,{once:true});}
  const P={paper:'#EEEDEB',white:'#FFFFFF',ink:'#171717',pink:'#E5007D',rose:'#F19CC5',blush:'#F8DDE9',muted:'#626262',link:'#B00060'};
  function tabSVG(w,h,selected){return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="M0 ${h} V14 Q0 0 14 0 H${w-35} Q${w-24} 0 ${w-20} 10 L${w} ${h} Z" fill="${selected?P.blush:P.rose}"/><path d="M0 ${h} V14 Q0 0 14 0 H${w-35} Q${w-24} 0 ${w-20} 10 L${w} ${h}" fill="none" stroke="#B16089" stroke-opacity=".16" stroke-width=".8"/>${selected?'':`<path d="M0 ${h} V14 Q0 0 14 0 H${w-35} Q${w-24} 0 ${w-20} 10 L${w} ${h} Z" fill="#FFFFFF" fill-opacity=".3"/>`}</svg>`;}
  function activateExperience(group,company){
    const panel=group.children.find(l=>l.experiencePanel===company);if(!panel)return false;
    const tabs=group.children.filter(l=>l.experienceTab),rest=group.children.filter(l=>!l.experienceTab);
    for(const l of rest)if(l.experiencePanel)l.visible=l.experiencePanel===company;
    for(const tab of tabs){const selected=tab.experienceTab===company;tab.y=selected?111:127;tab.height=selected?88:86;
      const shape=tab.children.find(l=>l.experiencePart==='tab-shape'),text=tab.children.find(l=>l.type==='text');
      if(shape){shape.height=tab.height;shape.svg=tabSVG(tab.width,tab.height,selected);}
      if(text){text.y=selected?27:24;text.color=selected?P.pink:P.ink;}
    }
    const body=rest.find(l=>l.experiencePart==='body'),grain=rest.find(l=>l.experiencePart==='grain'),sheet=rest.find(l=>l.experiencePart==='sheet');
    const folderHeight=panel.folderHeight||593;
    if(body)body.height=folderHeight;if(grain)grain.height=folderHeight;if(sheet)sheet.height=folderHeight-82;
    for(const l of rest)if(l.experiencePart==='back-pink')l.height=folderHeight-8;else if(l.experiencePart==='back-white')l.height=folderHeight-6;
    rest.splice(rest.indexOf(body),0,...tabs.filter(l=>l.experienceTab!==company));
    rest.splice(rest.indexOf(sheet),0,tabs.find(l=>l.experienceTab===company));
    group.children=rest;group.activeExperience=company;return true;
  }
  function layerStyle(layer){return{left:num(layer.x)+'px',top:num(layer.y)+'px',width:Math.max(1,num(layer.width,1))+'px',height:Math.max(1,num(layer.height,1))+'px',transform:`rotate(${num(layer.rotation)}deg)`,opacity:layer.opacity==null?1:Math.max(0,Math.min(1,num(layer.opacity))),display:layer.visible===false?'none':'',zIndex:'auto'};}
  function cropImageDOM(layer,asset){const wrap=el('div',{style:{position:'absolute',inset:'0',overflow:'hidden'}});const img=el('img',{src:asset.dataUrl,draggable:false,alt:layer.name||'',style:{objectFit:layer.fit||'contain'}});if(layer.crop&&asset.width&&asset.height){const [sx,sy,sw,sh]=layer.crop.map(Number),scale=(layer.fit==='cover'?Math.max:Math.min)(layer.width/sw,layer.height/sh);Object.assign(img.style,{position:'absolute',width:asset.width*scale+'px',height:asset.height*scale+'px',maxWidth:'none',left:(layer.width-sw*scale)/2-sx*scale+'px',top:(layer.height-sh*scale)/2-sy*scale+'px',objectFit:'fill'});}wrap.append(img);return wrap;}
  function deviceDOM(layer,preview){
    const box=el('div',{class:'device-outer'}),g=LunaRenderer.deviceGeometry(layer.device,layer.width,layer.height),o=g.outer,w=layer.width,h=layer.height;
    const bezel=el('div',{style:{position:'absolute',left:o.x+'px',top:o.y+'px',width:o.width+'px',height:o.height+'px',borderRadius:o.radius+'px',background:layer.device==='macbook'?'#292a2c':'#242426',border:'1.4px solid #69696b',boxShadow:`0 ${w*.018}px ${w*.025}px #1b142a24`}});box.append(bezel);
    const s=g.screen,screen=el('div',{class:'device-screen',style:{left:s.x+'px',top:s.y+'px',width:s.width+'px',height:s.height+'px',borderRadius:s.radius+'px',background:layer.fill||'#FFFFFF'}}),media=layer.media||{},asset=state.assets[media.assetId],poster=state.assets[media.posterAssetId];
    const source=asset?.dataUrl||(LunaRenderer.allowedMediaUrl(media.url)?media.url:null),mime=asset?.mime||media.mime||'';
    if(source){if(mime.startsWith('video/')||/\.(mp4|webm)(\?|$)/i.test(source)){const video=el('video',{controls:!!preview,muted:!preview,playsInline:true,preload:'none',style:{objectFit:layer.fit==='scroll'?'contain':layer.fit||'contain'}});deferVideo(video,source,poster);screen.append(video);if(!preview&&!poster)video.addEventListener('loadeddata',()=>{try{video.currentTime=.02;}catch(e){}},{once:true});}
      else {const image=el('img',{src:source,draggable:false,alt:layer.name||'',style:{objectFit:layer.fit==='scroll'?'contain':layer.fit||'contain'}});if(layer.fit==='scroll'){Object.assign(screen.style,{overflow:preview?'auto':'hidden',pointerEvents:preview?'auto':'none'});Object.assign(image.style,{height:'auto',objectFit:'contain'});}screen.append(image);}
    }else if(poster)screen.append(el('img',{src:poster.dataUrl,draggable:false,alt:'缩略图',style:{objectFit:layer.fit==='scroll'?'contain':layer.fit||'contain'}}));
    else screen.append(el('div',{class:'media-placeholder'},[el('span',{class:'play',text:'▶'})]));box.append(screen);
    const gallery=(layer.mediaGalleryAssetIds||[]).filter(id=>state.assets[id]?.mime?.startsWith('image/'));
    if(preview&&gallery.length>1&&screen.querySelector('img')){
      let index=Math.max(0,gallery.indexOf(media.assetId));const image=screen.querySelector('img'),counter=el('span',{text:(index+1)+' / '+gallery.length,'aria-live':'polite'});
      const show=step=>{index=(index+step+gallery.length)%gallery.length;image.src=state.assets[gallery[index]].dataUrl;image.dataset.galleryIndex=String(index);counter.textContent=(index+1)+' / '+gallery.length;};
      const controls=el('div',{class:'device-gallery-controls',role:'group','aria-label':'招募视频截图切换',style:{left:s.x+s.width/2+'px',top:s.y+s.height-45+'px'}},[
        el('button',{text:'‹',type:'button','aria-label':'上一张截图',onClick:event=>{event.preventDefault();event.stopPropagation();show(-1);}}),counter,
        el('button',{text:'›',type:'button','aria-label':'下一张截图',onClick:event=>{event.preventDefault();event.stopPropagation();show(1);}})
      ]);image.dataset.galleryIndex=String(index);box.append(controls);
    }
    if(g.island)box.append(el('div',{class:'device-island',style:{left:g.island.x+'px',top:g.island.y+'px',width:g.island.width+'px',height:g.island.height+'px',borderRadius:g.island.radius+'px'}}));
    if(g.home)box.append(el('div',{class:'device-home-line',style:{left:g.home.x+'px',top:g.home.y+'px',width:g.home.width+'px',height:g.home.height+'px'}}));
    if(g.camera)box.append(el('div',{class:'device-camera',style:{left:(g.camera.x-g.camera.radius)+'px',top:(g.camera.y-g.camera.radius)+'px',width:g.camera.radius*2+'px',height:g.camera.radius*2+'px'}}));
    if(g.base){const t=g.base.top,b=g.base.bottom;box.append(el('div',{class:'device-base',style:{left:0,top:t+'px',width:w+'px',height:(b-t)+'px',clipPath:'polygon(7.6% 0,92.4% 0,100% 100%,0 100%)',background:'linear-gradient(#cacacd,#dedee0 72%,#a5a5a8)'}}));box.append(el('div',{class:'device-base',style:{left:w*.43+'px',top:t+'px',width:w*.14+'px',height:h*.018+'px',background:'#929295',borderRadius:'0 0 '+h*.01+'px '+h*.01+'px'}}));box.append(el('div',{class:'device-base',style:{left:w*.014+'px',top:b-h*.005+'px',width:w*.972+'px',height:h*.025+'px',borderRadius:h*.012+'px',background:'#b7b7ba'}}));}return box;
  }
  function sceneLayer(layer,preview=false){
    const node=el('div',{class:`scene-layer scene-${layer.type}${layer.type==='group'?' layer-group':''}${layer.locked?' locked':''}`,style:layerStyle(layer),'data-layer-id':layer.id});
    if(layer.type==='group'){
      const content=el('div',{style:{position:'absolute',inset:'0',transform:`scale(${num(layer.scaleX,1)||1},${num(layer.scaleY,1)||1})`,transformOrigin:'0 0',pointerEvents:'none'}});for(const child of layer.children||[])content.append(sceneLayer(child,preview));node.append(content);
    }else if(layer.type==='text'){
      node.classList.add('scene-text');const fs=num(layer.fontSize,24),lh=num(layer.lineHeight,fs*1.3);Object.assign(node.style,{fontFamily:layer.fontFamily||'Arial',fontSize:fs+'px',fontWeight:layer.fontWeight||400,fontStyle:layer.fontStyle||'normal',lineHeight:(lh>3?lh:lh*fs)+'px',color:layer.color||'#E5007D',textAlign:layer.align||'left'});node.textContent=layer.text||'';
    }else if(layer.type==='image'){const asset=state.assets[layer.assetId];if(asset){if(layer.imageFilter||layer.grain||layer.radius){effectImage(node,layer,asset);}else node.append(cropImageDOM(layer,asset));}}
    else if(layer.type==='rect'){Object.assign(node.style,{background:layer.fill||'transparent',borderRadius:num(layer.radius)+'px',border:layer.stroke?`${num(layer.strokeWidth,1)}px solid ${layer.stroke}`:'none'});if(layer.shadow)node.style.boxShadow=`${num(layer.shadow.x)}px ${num(layer.shadow.y)}px ${num(layer.shadow.blur)}px ${layer.shadow.color||'rgba(0,0,0,.1)'}`;}
    else if(layer.type==='vector'){
      const svg=LunaRenderer.vectorSVG(layer);if(svg){const parsed=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;node.append(document.importNode(parsed,true));}
    }else if(layer.type==='device')node.append(deviceDOM(layer,preview));
    if(preview&&safeLink(layer.link)){const anchor=el('a',{href:safeLink(layer.link),class:'preview-link',title:layer.name||'',onClick:event=>handleLink(event,layer.link)});if(layer.type==='device'&&(state.assets[layer.media?.assetId]?.mime||layer.media?.mime||'').startsWith('video/')){anchor.classList.add('device-video-link');anchor.textContent='↗';anchor.setAttribute('aria-label',(layer.name||'视频')+' · 打开相关页面');}if(layer.experienceTab){anchor.setAttribute('aria-label',layer.name.replace(/^Folder tab · /,''));anchor.setAttribute('aria-current',locate(layer.id)?.ancestors.some(g=>g.activeExperience===layer.experienceTab)?'true':'false');}if(/^https?:/i.test(layer.link)){anchor.target=layer.linkTarget==='_self'?'_self':'_blank';if(anchor.target==='_blank')anchor.rel='noopener noreferrer';}node.append(anchor);}
    return node;
  }

  const isCanvas=p=>p?.kind==='infinite-canvas';
  async function readJSON(path){
    for(let attempt=0;attempt<2;attempt++){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
      let response;
      try{
        response=await fetch(path,{cache:'no-cache',signal:controller.signal});
        if(!response.ok)throw Error('Could not load '+path+' ('+response.status+').');
        return await response.json();
      }catch(error){
        const networkError=controller.signal.aborted||error?.name==='AbortError'||error instanceof TypeError;
        if((response&&!response.ok)||!networkError)throw error;
        if(attempt===1)throw Error('This page is taking longer than expected. Please refresh to try again.');
      }finally{clearTimeout(timer);}
    }
  }
  function registerAssets(records){for(const[id,a]of Object.entries(records))state.assets[id]={...a,dataUrl:new URL(a.dataUrl,document.baseURI).href};}
  async function getPage(id){if(pageCache.has(id))return pageCache.get(id);const meta=state.project.pages.find(p=>p.id===id);if(!meta)throw Error('This page is unavailable.');const[scene,assets]=await Promise.all([readJSON(meta.scene),readJSON(meta.assets)]);registerAssets(assets);pageCache.set(id,scene);return scene;}
  function visit(layers,fn){for(const l of layers||[]){fn(l);if(l.children)visit(l.children,fn);}}
  async function loadFonts(p){const families=new Set();visit(p.layers,l=>{if(l.fontFamily)families.add(l.fontFamily);});const faces=(state.project.fonts||[]).filter(f=>families.has(f.family));const loaded=await Promise.all(faces.map(async f=>{const key=[f.family,f.assetId,f.style,f.weight].join('|');if(!fontCache.has(key)){const asset=state.assets[f.assetId];if(!asset)throw Error('Missing font '+f.family);fontCache.set(key,new FontFace(f.family,`url("${asset.dataUrl}")`,{style:f.style||'normal',weight:String(f.weight||400)}).load());}return fontCache.get(key);}));for(const face of loaded)document.fonts.add(face);await document.fonts.ready;}
  function layout(){const p=page();if(!p)return;const cover=isCanvas(p);scroll.classList.toggle('canvas-view',cover);frame.classList.toggle('canvas-view',cover);stage.classList.toggle('canvas-view',cover);if(cover){Object.assign(frame.style,{width:'100%',height:scroll.clientHeight+'px'});Object.assign(stage.style,{width:'100%',height:'100%',transform:'none'});return;}const padding=parseFloat(getComputedStyle(scroll).paddingLeft)||0;const width=Math.min(state.project.previewSettings?.maxWidth||1100,Math.max(1,scroll.clientWidth-padding*2));const scale=width/p.width;Object.assign(frame.style,{width:width+'px',height:p.height*scale+'px'});Object.assign(stage.style,{width:p.width+'px',height:p.height+'px',transform:`scale(${scale})`});scroll.style.backgroundColor=state.project.previewSettings?.outerBackground||'#4b0215';interactions?.refresh();}
  function canvasPayload(p){return{...p.canvasSettings,navLabels:state.project.navLabels,active:true,motionEnabled:state.project.siteInteractions?.enabled!==false,artworks:(p.canvasSettings?.artworkAssetIds||[]).map(id=>state.assets[id]).filter(Boolean).map(a=>({src:a.dataUrl,width:a.width,height:a.height}))};}
  function syncCanvas(){const p=pageCache.get('canvas');if(canvasFrame&&p)canvasFrame.contentWindow?.postMessage({type:'luna:canvas-settings',payload:{...canvasPayload(p),active:isCanvas(page())}},location.origin);}
  function mount(p){
    clearDeferredMedia();interactions?.cleanup();interactions=null;stage.className='preview-stage';stage.style.background=p.background||'#FFFFFF';
    if(isCanvas(p)){
      if(!canvasFrame){canvasHost=el('div',{class:'luna-canvas-host',style:{position:'absolute',inset:'0',width:'100%',height:'100%',zIndex:'1'}});canvasFrame=el('iframe',{class:'luna-canvas-frame',title:'Luna Ye · interactive cover',src:'./canvas/index.html?embedded=1',allow:'fullscreen',allowFullscreen:true});canvasFrame.addEventListener('load',syncCanvas);canvasHost.append(canvasFrame);frame.append(canvasHost);}
      canvasHost.hidden=false;stage.replaceChildren();
    }else{
      syncCanvas();if(canvasHost)canvasHost.hidden=true;stage.replaceChildren(...p.layers.map(l=>sceneLayer(l,true)));interactions=window.LunaSiteInteractions.mount({root:stage,project:state.project,page:p,assets:state.assets,outer:scroll,scrollHost:scroll,backgroundUrl:state.assets[state.project.siteInteractions?.background?.assetId]?.dataUrl,navigate:(link,event)=>handleLink(event||{preventDefault(){}},link)});
    }
    layout();activateDeferredMedia();syncCanvas();
  }
  async function showPage(id,anchor){const ticket=++navigation;status.className='site-status';status.textContent='Loading…';try{const p=await getPage(id);if(ticket!==navigation)return;const priorities=firstViewportImages(p);primeImages(priorities);if(!isCanvas(p))await loadFonts(p);if(ticket!==navigation)return;state.pageId=id;priorityImageURLs=priorities;mount(p);document.title=(p.id==='canvas'?'Luna Ye':p.name+' · Luna Ye')+' · Portfolio';status.textContent='';scroll.scrollTop=0;scroll.scrollLeft=0;if(anchor)requestAnimationFrame(()=>scrollToLayer(anchor));}catch(error){if(ticket===navigation){status.className='site-status error';status.replaceChildren(document.createTextNode(error.message+' '),el('a',{href:'mailto:lunagreen105@gmail.com',text:'Contact Luna'}));}console.error(error);}}
  function scrollToLayer(id){const n=stage.querySelector(`[data-layer-id="${CSS.escape(id)}"]`);if(!n)return;const group=locate(id)?.ancestors.find(l=>l.experiencePanel);if(group&&page().layers.find(l=>l.experienceFolder)?.activeExperience!==group.experiencePanel){setExperience(group.experiencePanel);return requestAnimationFrame(()=>scrollToLayer(id));}const b=n.getBoundingClientRect(),r=scroll.getBoundingClientRect();scroll.scrollBy({top:b.top-r.top-24,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}
  function setExperience(company){const p=page(),group=p?.layers.find(l=>l.experienceFolder);if(!group||group.activeExperience===company)return false;const selected=group.children.find(l=>l.experiencePanel===company);if(!selected)return false;const old=group.children.find(l=>l.experiencePanel===group.activeExperience),delta=(selected.folderHeight||593)-(old?.folderHeight||593),top=scroll.scrollTop,left=scroll.scrollLeft;activateExperience(group,company);group.height+=delta;for(const l of p.layers){if(l===group||l.y<=group.y)continue;l.y+=delta;}p.height+=delta;const background=p.layers.find(l=>/^Continuous (beige|paper) background$/.test(l.name));if(background)background.height=p.height;mount(p);scroll.scrollTop=top;scroll.scrollLeft=left;return true;}
  function downloadAsset(id){const a=state.assets[id];if(!a)return;const anchor=el('a',{href:a.dataUrl,download:a.downloadName||'download'});document.body.append(anchor);anchor.click();anchor.remove();}
  function handleLink(event,link){const safe=safeLink(link);if(!safe){event?.preventDefault();return;}if(/^#(?:page|layer|anchor):/.test(safe)){event?.preventDefault();if(location.hash===safe)route();else location.hash=safe;}else if(safe.startsWith('#experience:')){event?.preventDefault();setExperience(safe.slice(12));}else if(safe.startsWith('#asset:')){event?.preventDefault();downloadAsset(safe.slice(7));}else if(/^https?:/i.test(safe)){if(event?.currentTarget?.target==='_self')location.href=safe;else{event?.preventDefault();window.open(safe,'_blank','noopener,noreferrer');}}else if(/^(mailto:|tel:)/i.test(safe)){event?.preventDefault();location.href=safe;}}
  function route(){const hash=decodeURIComponent(location.hash);let id='canvas',anchor=null;if(hash.startsWith('#page:'))id=hash.slice(6);else if(/^#(?:layer|anchor):/.test(hash)){anchor=hash.replace(/^#(?:layer|anchor):/,'');id=state.project.layerPages[anchor]||state.pageId||'home';}else{const requested=new URLSearchParams(location.search).get('page');if(requested)id=requested;}if(!state.project.pages.some(p=>p.id===id))id='canvas';if(id===state.pageId&&anchor){scrollToLayer(anchor);return;}return showPage(id,anchor);}
  window.addEventListener('hashchange',route);
  window.addEventListener('resize',layout,{passive:true});
  window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==canvasFrame?.contentWindow)return;if(event.data?.type==='luna:canvas-ready')syncCanvas();if(event.data?.type==='luna:navigate'&&isCanvas(page())&&state.project.pages.some(p=>p.id===event.data.pageId))location.hash='#page:'+event.data.pageId;});
  window.LunaSite={navigate:id=>{location.hash='#page:'+id;},getState:()=>({pageId:state.pageId,page:page(),loadedPages:[...pageCache.keys()],assetCount:Object.keys(state.assets).length,interactions:interactions?.getStats()}),setExperience};
  window.LunaSite.ready=(async()=>{state.project=await readJSON('./data/site.json');await route();})().catch(error=>{status.className='site-status error';status.textContent='The portfolio could not load. Please refresh or email lunagreen105@gmail.com.';console.error(error);});
})();
