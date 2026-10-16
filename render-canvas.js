/* Portable scene renderer: no network, dependency or executable SVG required. */
(function () {
  'use strict';
  const imageCache = new Map();
  const effectCache = new WeakMap();
  async function renderImageLayer(layer,asset){
    const img=await getImage(asset.dataUrl),w=Math.max(1,Math.round(layer.width)),h=Math.max(1,Math.round(layer.height));
    let entries=effectCache.get(img);if(!entries){entries=new Map();effectCache.set(img,entries);}
    const key=JSON.stringify([w,h,layer.fit,layer.crop,layer.radius,layer.imageFilter,layer.grain]);
    if(entries.has(key))return entries.get(key);
    const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d',{willReadFrequently:!!layer.grain});
    if(layer.radius){rectPath(x,0,0,w,h,layer.radius);x.clip();}
    if(layer.imageFilter)x.filter=layer.imageFilter;
    drawFitted(x,img,w,h,layer.fit||'contain',layer.crop);x.filter='none';
    if(layer.grain){const pixels=x.getImageData(0,0,w,h),v=pixels.data;let seed=18739;
      for(let i=0;i<v.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const n=((seed>>>24)/255-.5)*Number(layer.grain);if(v[i+3])for(let k=0;k<3;k++)v[i+k]=Math.max(0,Math.min(255,v[i+k]+n));}
      x.putImageData(pixels,0,0);
    }
    entries.set(key,c);if(entries.size>8)entries.delete(entries.keys().next().value);return c;
  }
  const videoCache = new Map();
  const allowedUrl = value => typeof value === 'string' && (/^https?:\/\//i.test(value) || /^data:(image\/(png|jpeg|webp|gif|svg\+xml)|video\/(mp4|webm));/i.test(value) || /^blob:/i.test(value));
  const cleanSvg = value => {
    if (typeof value !== 'string' || value.length > 1500000) return '';
    const doc = new DOMParser().parseFromString(value, 'image/svg+xml');
    if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') return '';
    const forbidden = new Set(['script','foreignObject','iframe','object','embed','audio','video','animate','animateMotion','animateTransform','set']);
    for (const node of Array.from(doc.querySelectorAll('*'))) {
      if (forbidden.has(node.localName)) { node.remove(); continue; }
      if (node.localName === 'style' && /(?:@import|javascript:|url\s*\(\s*["']?(?:https?:|data:|\/\/))/i.test(node.textContent || '')) { node.remove(); continue; }
      for (const attr of Array.from(node.attributes)) {
        const key = attr.name.toLowerCase(), val = attr.value.trim();
        if (key.startsWith('on') || (key.includes('href') && !/^#[\w:.-]+$/.test(val)) || /(?:javascript:|@import|url\s*\(\s*["']?(?:https?:|data:|\/\/))/i.test(val)) node.removeAttribute(attr.name);
      }
    }
    return new XMLSerializer().serializeToString(doc.documentElement);
  };
  function vectorSVG(layer){
    let svg=layer.svg;
    if(!svg&&layer.pathData){const vb=layer.viewBox||`0 0 ${layer.width} ${layer.height}`;svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${String(vb).replace(/["<>]/g,'')}"><path d="${String(layer.pathData).replace(/["<>]/g,'')}" fill="${String(layer.color||'#E5007D').replace(/["<>]/g,'')}"/></svg>`;}
    svg=cleanSvg(svg);if(svg&&layer.color&&CSS.supports('color',layer.color)){const doc=new DOMParser().parseFromString(svg,'image/svg+xml');for(const node of Array.from(doc.querySelectorAll('*'))){for(const attr of ['fill','stroke']){const paint=node.getAttribute(attr);if(paint&&paint!=='none'&&paint!=='transparent'&&!paint.startsWith('url('))node.setAttribute(attr,layer.color);}if(node.style){for(const property of ['fill','stroke']){const paint=node.style.getPropertyValue(property);if(paint&&paint!=='none'&&paint!=='transparent'&&!paint.startsWith('url('))node.style.setProperty(property,layer.color);}}}svg=new XMLSerializer().serializeToString(doc.documentElement);}return svg;
  }
  const rectPath = (ctx, x, y, w, h, radius) => {
    let r = Math.max(0, Math.min(Number(radius) || 0, w / 2, h / 2));
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else { ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y); }
    ctx.closePath();
  };
  function deviceGeometry(device, width, height) {
    const w = Number(width) || 390, h = Number(height) || 844;
    if (device === 'ipad') return { kind:'ipad', screen:{x:w*.042,y:h*.055,width:w*.916,height:h*.89,radius:w*.022}, outer:{x:0,y:0,width:w,height:h,radius:w*.046}, camera:{x:w*.021,y:h*.5,radius:w*.0038}, ratio:1024/760 };
    if (device === 'macbook') return { kind:'macbook', screen:{x:w*.095,y:h*.035,width:w*.81,height:h*.779,radius:w*.009}, outer:{x:w*.076,y:0,width:w*.848,height:h*.857,radius:w*.025}, camera:{x:w*.5,y:h*.0175,radius:w*.0028}, base:{top:h*.857,bottom:h*.973}, ratio:1000/650 };
    return {kind:'iphone',screen:{x:w*.045,y:h*.024,width:w*.91,height:h*.952,radius:w*.094},outer:{x:0,y:0,width:w,height:h,radius:w*.128},island:{x:w*.347,y:h*.035,width:w*.306,height:h*.033,radius:h*.02},home:{x:w*.34,y:h*.957,width:w*.32,height:h*.004,radius:3},ratio:390/844};
  }
  function deviceFrameSVG(device,width,height){
    const w=Number(width)||(device==='iphone'?390:device==='ipad'?1024:1000),h=Number(height)||(device==='iphone'?844:device==='ipad'?760:650),g=deviceGeometry(device,w,h),o=g.outer,s=g.screen;
    const rect=(p,fill)=>`<rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" rx="${p.radius||0}" fill="${fill}"/>`;
    let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><defs><mask id="screen-cutout"><rect width="${w}" height="${h}" fill="white"/>${rect(s,'black')}</mask><linearGradient id="base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cacacd"/><stop offset=".72" stop-color="#dedee0"/><stop offset="1" stop-color="#a5a5a8"/></linearGradient></defs><g mask="url(#screen-cutout)">${rect(o,'#242426')}<rect x="${o.x+1}" y="${o.y+1}" width="${o.width-2}" height="${o.height-2}" rx="${o.radius}" fill="none" stroke="#69696b" stroke-width="1.4"/></g>`;
    if(g.island)svg+=rect(g.island,'#131314');if(g.home)svg+=rect(g.home,'#202022');if(g.camera)svg+=`<circle cx="${g.camera.x}" cy="${g.camera.y}" r="${g.camera.radius}" fill="#080809"/>`;
    if(g.base){const t=g.base.top,b=g.base.bottom;svg+=`<path d="M ${w*.076} ${t} L ${w*.924} ${t} L ${w} ${b} L 0 ${b} Z" fill="url(#base)"/>`+rect({x:w*.43,y:t,width:w*.14,height:h*.018,radius:h*.01},'#929295')+rect({x:w*.014,y:b-h*.005,width:w*.972,height:h*.025,radius:h*.012},'#b7b7ba');}
    return svg+'</svg>';
  }
  async function getImage(url) {
    if (!url || !allowedUrl(url)) throw new Error('Unsupported image URL');
    if (imageCache.has(url)) return imageCache.get(url);
    const promise = new Promise((resolve,reject) => { const img=new Image(); if (/^https?:/i.test(url)) img.crossOrigin='anonymous'; img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Image could not be loaded'));img.src=url; });
    imageCache.set(url,promise);
    return promise;
  }
  async function videoFrame(url) {
    if (!url || !allowedUrl(url)) throw new Error('Unsupported video URL');
    if (videoCache.has(url)) return videoCache.get(url);
    const promise = new Promise((resolve,reject)=>{
      const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';if (/^https?:/i.test(url))video.crossOrigin='anonymous';
      const timer=setTimeout(()=>{video.removeAttribute('src');video.load();reject(new Error('Video thumbnail unavailable'));},9000);
      video.onerror=()=>{clearTimeout(timer);reject(new Error('Video could not be loaded'));};
      video.onloadeddata=()=>{clearTimeout(timer);resolve(video);};video.src=url;video.load();
    });videoCache.set(url,promise);return promise;
  }
  function drawFitted(ctx, image, width, height, fit, crop) {
    let iw=image.naturalWidth||image.videoWidth||image.width, ih=image.naturalHeight||image.videoHeight||image.height;
    if (!iw || !ih || width <=0 || height <=0) return;
    let sx=0,sy=0,sw=iw,sh=ih;
    if(Array.isArray(crop)&&crop.length===4){sx=Math.max(0,Number(crop[0])||0);sy=Math.max(0,Number(crop[1])||0);sw=Math.max(1,Math.min(Number(crop[2])||iw,iw-sx));sh=Math.max(1,Math.min(Number(crop[3])||ih,ih-sy));}
    if(fit==='fill'){ctx.drawImage(image,sx,sy,sw,sh,0,0,width,height);return;}
    const scale=fit==='scroll'?width/sw:fit==='cover'?Math.max(width/sw,height/sh):Math.min(width/sw,height/sh);
    const dw=sw*scale,dh=sh*scale;ctx.save();ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();ctx.drawImage(image,sx,sy,sw,sh,(width-dw)/2,fit==='scroll'?0:(height-dh)/2,dw,dh);ctx.restore();
  }
  function textLines(ctx,text,width) {
    const lines=[];
    for(const paragraph of String(text??'').split('\n')){
      if(!paragraph){lines.push('');continue;}
      let line='';const tokens=paragraph.match(/\S+\s*|\s+/g)||[''];
      for(const token of tokens){const test=line+token;if(line&&ctx.measureText(test.trimEnd()).width>width){lines.push(line.trimEnd());line=token.trimStart();}else line=test;}
      lines.push(line.trimEnd());
    }return lines;
  }
  async function drawMedia(ctx, layer, assets, geometry, warnings) {
    const s=geometry.screen, media=layer.media||{};
    ctx.save();rectPath(ctx,s.x,s.y,s.width,s.height,s.radius);ctx.clip();ctx.fillStyle=layer.fill||'#FFFFFF';ctx.fillRect(s.x,s.y,s.width,s.height);
    let image;
    const asset=assets[media.assetId], poster=assets[media.posterAssetId];
    try {
      if(poster)image=await getImage(poster.dataUrl);
      else if(asset){if((asset.mime||'').startsWith('video/'))image=await videoFrame(asset.dataUrl);else image=await getImage(asset.dataUrl);}
      else if(media.url&&allowedUrl(media.url)){if((media.mime||'').startsWith('video/')||/\.(mp4|webm)(\?|$)/i.test(media.url))image=await videoFrame(media.url);else image=await getImage(media.url);}
      if(image){ctx.translate(s.x,s.y);drawFitted(ctx,image,s.width,s.height,layer.fit||'contain');}
      else {ctx.fillStyle='#E5007D';ctx.beginPath();ctx.arc(s.x+s.width/2,s.y+s.height/2,Math.min(s.width*.1,24),0,Math.PI*2);ctx.fillStyle='#ffffffa8';ctx.fill();ctx.fillStyle='#E5007D';const cx=s.x+s.width/2,cy=s.y+s.height/2;ctx.beginPath();ctx.moveTo(cx-4,cy-8);ctx.lineTo(cx+9,cy);ctx.lineTo(cx-4,cy+8);ctx.closePath();ctx.fill();}
    }catch(error){warnings.push(`${layer.name||layer.id}: 媒体未能渲染，已保留占位。请上传本地文件或设置缩略图。`);}
    ctx.restore();
  }
  async function drawLayer(ctx, layer, assets, warnings) {
    if(layer.visible===false)return;
    const w=Number(layer.width)||0,h=Number(layer.height)||0;
    ctx.save();ctx.globalAlpha*=layer.opacity==null?1:Math.max(0,Math.min(1,Number(layer.opacity)));ctx.translate(Number(layer.x)||0,Number(layer.y)||0);
    if(layer.rotation){ctx.translate(w/2,h/2);ctx.rotate(Number(layer.rotation)*Math.PI/180);ctx.translate(-w/2,-h/2);}
    if(layer.type==='group'){
      const sx=Number(layer.scaleX)||1,sy=Number(layer.scaleY)||1;ctx.scale(sx,sy);
      for(const child of layer.children||[])await drawLayer(ctx,child,assets,warnings);
    }else if(layer.type==='rect'){
      if(layer.shadow){ctx.shadowColor=layer.shadow.color||'rgba(0,0,0,.1)';ctx.shadowBlur=Number(layer.shadow.blur)||0;ctx.shadowOffsetX=Number(layer.shadow.x)||0;ctx.shadowOffsetY=Number(layer.shadow.y)||0;}
      rectPath(ctx,0,0,w,h,layer.radius);if(layer.fill&&layer.fill!=='none'){ctx.fillStyle=layer.fill;ctx.fill();}if(layer.stroke){ctx.strokeStyle=layer.stroke;ctx.lineWidth=Number(layer.strokeWidth)||1;ctx.stroke();}
    }else if(layer.type==='image'){
      try{const asset=assets[layer.assetId];if(asset){if(layer.imageFilter||layer.grain||layer.radius)ctx.drawImage(await renderImageLayer(layer,asset),0,0,w,h);else{const img=await getImage(asset.dataUrl);drawFitted(ctx,img,w,h,layer.fit||'contain',layer.crop);}}}catch(error){warnings.push(`${layer.name||layer.id}: 图片无法加载。`);}
    }else if(layer.type==='text'){
      const fs=Number(layer.fontSize)||24,lh=Number(layer.lineHeight)>3?Number(layer.lineHeight):fs*(Number(layer.lineHeight)||1.3);
      ctx.font=`${layer.fontStyle||'normal'} ${layer.fontWeight||400} ${fs}px "${String(layer.fontFamily||'Arial').replaceAll('"','')}"`;
      ctx.fillStyle=layer.color||'#E5007D';ctx.textBaseline='alphabetic';ctx.textAlign=layer.align||'left';
      const metrics=ctx.measureText('Hg'),ascent=metrics.fontBoundingBoxAscent||fs*.82,descent=metrics.fontBoundingBoxDescent||fs*.18;
      let y=(lh-ascent-descent)/2+ascent;
      for(const line of textLines(ctx,layer.text,w)){const x=layer.align==='center'?w/2:layer.align==='right'?w:0;ctx.fillText(line,x,y);y+=lh;}
    }else if(layer.type==='vector'){
      const svg=vectorSVG(layer);if(svg){try{const img=await getImage('data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(svg))));drawFitted(ctx,img,w,h,'contain');}catch(error){warnings.push(`${layer.name||layer.id}: 矢量图无法加载。`);}}
    }else if(layer.type==='device'){
      const g=deviceGeometry(layer.device,w,h),o=g.outer;
      ctx.save();ctx.shadowColor='#1b142a24';ctx.shadowBlur=w*.025;ctx.shadowOffsetY=w*.018;rectPath(ctx,o.x,o.y,o.width,o.height,o.radius);ctx.fillStyle=layer.device==='macbook'?'#292a2c':'#242426';ctx.fill();ctx.restore();
      rectPath(ctx,o.x+1,o.y+1,o.width-2,o.height-2,o.radius);ctx.strokeStyle='#69696b';ctx.lineWidth=1.4;ctx.stroke();
      await drawMedia(ctx,layer,assets,g,warnings);
      if(g.island){const p=g.island;rectPath(ctx,p.x,p.y,p.width,p.height,p.radius);ctx.fillStyle='#131314';ctx.fill();}
      if(g.home){const p=g.home;rectPath(ctx,p.x,p.y,p.width,p.height,p.radius);ctx.fillStyle='#202022';ctx.fill();}
      if(g.camera){ctx.beginPath();ctx.arc(g.camera.x,g.camera.y,g.camera.radius,0,Math.PI*2);ctx.fillStyle='#080809';ctx.fill();}
      if(g.base){const t=g.base.top,b=g.base.bottom;ctx.beginPath();ctx.moveTo(w*.076,t);ctx.lineTo(w*.924,t);ctx.lineTo(w,b);ctx.lineTo(0,b);ctx.closePath();const grad=ctx.createLinearGradient(0,t,0,b);grad.addColorStop(0,'#cacacd');grad.addColorStop(.72,'#dedee0');grad.addColorStop(1,'#a5a5a8');ctx.fillStyle=grad;ctx.fill();rectPath(ctx,w*.43,t,w*.14,h*.018,h*.01);ctx.fillStyle='#929295';ctx.fill();rectPath(ctx,w*.014,b-h*.005,w*.972,h*.025,h*.012);ctx.fillStyle='#b7b7ba';ctx.fill();}
    }
    ctx.restore();
  }
  async function renderPage(page, assets, options={}) {
    await document.fonts.ready;
    let scale=Math.max(.25,Math.min(3,Number(options.scale)||1));
    const maxPixels=options.maxPixels||65000000;
    if(page.width*page.height*scale*scale>maxPixels)scale=Math.sqrt(maxPixels/(page.width*page.height));
    if(page.height*scale>32000)scale=32000/page.height;
    const canvas=document.createElement('canvas');canvas.width=Math.round(page.width*scale);canvas.height=Math.round(page.height*scale);
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('当前浏览器不支持画布');ctx.scale(scale,scale);ctx.fillStyle=page.background||'#EEEDEB';ctx.fillRect(0,0,page.width,page.height);
    const warnings=[];for(const layer of page.layers||[])await drawLayer(ctx,layer,assets,warnings);
    return {canvas,warnings,scale};
  }
  window.LunaRenderer={renderPage,drawLayer,renderImageLayer,deviceGeometry,deviceFrameSVG,vectorSVG,sanitizeSVG:cleanSvg,allowedMediaUrl:allowedUrl,textLines,clearCache:()=>{imageCache.clear();videoCache.clear();}};
})();
