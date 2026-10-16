/* Runtime-only site interactions. Scene JSON, text, fonts and editor coordinates remain unchanged. */
(function(global){
 'use strict';
 const mounted=new WeakMap(),instances=new Set();
 const q=(root,id)=>root.querySelector('[data-layer-id="'+CSS.escape(id)+'"]');
 const walk=(layers,fn,parents=[])=>{for(const l of layers||[]){fn(l,parents);if(l.children)walk(l.children,fn,[...parents,l]);}};
 const numeric=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
 const ns='http://www.w3.org/2000/svg';
 function svgElement(tag,attrs={}){const n=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,String(v)));return n;}
 function mount(options={}){
  const root=options.root;if(!root?.querySelector)return {cleanup(){},refresh(){},getStats(){return{mounted:false};}};
  mounted.get(root)?.cleanup();
  const project=options.project||{},page=typeof options.page==='string'?project.pages?.find(p=>p.id===options.page):options.page,settings=project.siteInteractions||{},motionEnabled=settings.enabled!==false;
  if(!page)return {cleanup(){},refresh(){},getStats(){return{mounted:false};}};
  const abort=new AbortController(),listeners={signal:abort.signal},saved=new Map(),contents=new Map(),added=[],timers=new Set(),animations=new Set(),loops=[],layerMap=new Map(),targets=new Set(),forms=[],biography=[];
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),fine=matchMedia('(pointer:fine)'),outer=options.outer||root.closest('#previewScroll'),scrollHost=options.scrollHost||outer||window;
  let destroyed=false,frame=0,backgroundFrame=0,px=0,py=0,epoch=performance.now(),formSending=false,biographyObserver=null;const pulseTimers=new WeakMap();
  walk(page.layers,l=>layerMap.set(l.id,l));
  function remember(n){if(n&&!saved.has(n))saved.set(n,{style:n.getAttribute('style'),class:n.getAttribute('class'),tabindex:n.getAttribute('tabindex'),role:n.getAttribute('role'),'aria-label':n.getAttribute('aria-label'),'aria-hidden':n.getAttribute('aria-hidden')});return n;}
  function modify(n,className){if(!n)return;remember(n);if(className)n.classList.add(...className.split(' '));return n;}
  function add(parent,node){parent.append(node);added.push(node);return node;}
  function listen(n,name,fn,settings={}){n?.addEventListener(name,fn,{...listeners,...settings});}
  function timeout(fn,delay){const id=setTimeout(()=>{timers.delete(id);if(!destroyed)fn();},delay);timers.add(id);return id;}
  function replaceContent(n){if(!contents.has(n)){contents.set(n,[...n.childNodes]);n.replaceChildren();}}
  function visible(n){const b=n.getBoundingClientRect(),r=scrollHost===window?{top:0,left:0,right:innerWidth,bottom:innerHeight}:scrollHost.getBoundingClientRect();return !!(b.width&&b.height&&b.bottom>r.top&&b.top<r.bottom&&b.right>r.left&&b.left<r.right);}
  function navigate(link,event){if(typeof options.navigate==='function')return options.navigate(link,event);if(link?.startsWith('#layer:')){const target=q(root,link.slice(7));if(target){const b=target.getBoundingClientRect(),r=scrollHost===window?{top:0}:scrollHost.getBoundingClientRect();scrollHost.scrollBy({top:b.top-r.top-24,behavior:reduced.matches?'auto':'smooth'});}return;}if(/^https?:|^mailto:|^tel:/.test(link||''))window.open(link,'_blank','noopener');}
  function clickPulse(n){if(!motionEnabled||reduced.matches)return;const prior=pulseTimers.get(n);if(prior){clearTimeout(prior);timers.delete(prior);}const base=getComputedStyle(n).transform,peak=new DOMMatrix(base==='none'?undefined:base).scale(1.025);n.style.setProperty('--luna-click-transform',peak.toString());n.classList.add('luna-click-pulse');pulseTimers.set(n,timeout(()=>n.classList.remove('luna-click-pulse'),160));}
  function target(n,{link,kind='link',route=false,label}={}){
   if(!n)return;modify(n,'luna-motion-target luna-motion-'+kind);n.style.setProperty('--luna-base-transform',n.style.transform||'rotate(0deg)');targets.add(n);
   if(label)n.setAttribute('aria-label',label);
   if(route&&link){n.tabIndex=0;n.setAttribute('role','link');for(const a of n.querySelectorAll('a')){remember(a);a.tabIndex=-1;}listen(n,'click',event=>{event.preventDefault();event.stopImmediatePropagation();clickPulse(n);navigate(link,event);},{capture:true});listen(n,'keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();clickPulse(n);navigate(link,event);}});}
   else if(kind==='brand'){n.tabIndex=0;n.setAttribute('role','button');listen(n,'click',()=>clickPulse(n));listen(n,'keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();clickPulse(n);}});}
   else listen(n,'click',()=>clickPulse(n),{capture:true});
  }
  function localAnchor(n,link,label){const a=document.createElement('a');a.className='preview-link luna-runtime-link';a.href=/^https?:|^mailto:|^tel:/.test(link||'')?link:'#';a.setAttribute('aria-label',label||'Open');listen(a,'click',e=>{e.preventDefault();e.stopPropagation();navigate(link,e);});return add(n,a);}
  function firstLink(l){let found=l.link;walk(l.children||[],c=>{if(!found&&c.link&&!/^visual-share-number-/.test(c.id))found=c.link;});return found;}
  modify(root,'luna-site-interactions');
  if(outer){modify(outer,'luna-site-outer');const backgroundUrl=options.backgroundUrl||options.assets?.[settings.background?.assetId]?.dataUrl;if(backgroundUrl)outer.style.setProperty('--luna-side-background',`url(${JSON.stringify(backgroundUrl)})`);outer.style.setProperty('--luna-tile-width',(numeric(settings.background?.tileWidth,540)||540)+'px');outer.style.setProperty('--luna-tile-height',(numeric(settings.background?.tileHeight,960)||960)+'px');}
  if(settings.retroCursor===false){root.style.setProperty('--luna-retro-cursor','auto');outer?.style.setProperty('--luna-retro-cursor','auto');}
  // Logical groups are registered before their child anchors, so only one item reacts.
  walk(page.layers,l=>{
   const n=q(root,l.id);if(!n||l.visible===false)return;
   if(/^content-scale-home-.*folder-/.test(l.id))target(n,{kind:'folder',link:firstLink(l),route:true,label:l.name});
   if(/^content-scale-home-mac-group-/.test(l.id)){const link=firstLink(l);if(link){target(n,{kind:'folder',link,route:true,label:l.name});modify(n,'luna-home-app-link');}else modify(n,'luna-static-icon');}
   if(/^visual-work-card-[0-4]$/.test(l.id)){
    const i=Number(l.id.slice(-1)),known=['content-scale-work-01-halali-156','content-scale-work-02-musekey-173','content-scale-work-03-ai-ski-coach-191','content-scale-work-04-everythink-travel-pillow-206','previous-work-experience-five-companies-258'][i];
    target(n,{kind:'work-folder',link:l.link||'#layer:'+known,route:true,label:l.name});
   }
   if(/^(rednote-xiaohongshu-platform-metrics-294|douyin-platform-metrics-303)$/.test(l.id))target(n,{kind:'platform',link:firstLink(l),route:true,label:l.name});
   if(l.name?.startsWith('Partner ·'))target(n,{kind:'brand',link:firstLink(l),route:true,label:l.name});
   if(l.id==='creator-luna-and-physical-props-283'){
    modify(n,'luna-portrait-paper');n.style.setProperty('--luna-base-transform',n.style.transform||'rotate(0deg)');
   }
   if(l.name?.startsWith('What I share ·')){
    modify(n,'luna-info-tile');n.style.setProperty('--luna-base-transform',n.style.transform||'rotate(0deg)');
    // These five cards are information, not destinations. Preserve historical links in
    // project JSON but hide their preview anchors instead of advertising a fake action.
    for(const a of n.querySelectorAll('a')){remember(a);a.style.display='none';a.setAttribute('aria-hidden','true');a.tabIndex=-1;}
   }
  });
  // How I work surfaces sit below the curve, around the existing copy only.
  for(const id of ['start-with-the-question-73','make-the-story-clear-77','build-a-useful-workflow-81','learn-from-the-response-85']){
   const n=q(root,id),l=layerMap.get(id);if(!n||!l)continue;modify(n,'luna-roadmap-info');const surface=document.createElement('span');surface.className='luna-roadmap-surface';surface.style.top='204px';surface.style.bottom='-12px';surface.setAttribute('aria-hidden','true');n.prepend(surface);added.push(surface);
  }
  // The center portrait is also the sixth non-link card in What I share.
  const sixth=q(root,'image-mv0tkqh0-ox0fe');if(sixth){modify(sixth,'luna-info-tile luna-portrait-tile');sixth.style.setProperty('--luna-base-transform',sixth.style.transform||'rotate(0deg)');}
  // Navigation outline and text are distinct editable layers. Both drive one outline.
  const header=page.layers.find(l=>l.name==='Shared header'),headerNode=header&&q(root,header.id),pillByLink=new Map();
  if(header)walk(header.children,l=>{if(l.id.includes('nav-')&&l.id.endsWith('-pill')){const n=q(root,l.id);if(n){target(n,{kind:'menu'});pillByLink.set(l.link,n);}}});
  if(header)walk(header.children,l=>{if(l.type==='text'&&l.link?.startsWith('#page:')){const n=q(root,l.id),pill=pillByLink.get(l.link);if(n&&pill){modify(n,'luna-menu-word');for(const name of ['pointerenter','focusin'])listen(n,name,()=>pill.classList.add('luna-menu-active'));for(const name of ['pointerleave','focusout'])listen(n,name,()=>pill.classList.remove('luna-menu-active'));}}});
  // All remaining real links receive the same compact feedback. App icons stay static.
  for(const anchor of root.querySelectorAll('a.preview-link, a.luna-runtime-link')){
   if(anchor.getAttribute('aria-hidden')==='true'||anchor.closest('.luna-static-icon'))continue;
   const owner=anchor.closest('[data-layer-id]');if(!owner||owner.closest('.luna-motion-target'))continue;
   if(headerNode?.contains(owner)&&owner.classList.contains('luna-menu-word'))continue;
   target(owner,{kind:headerNode?.contains(owner)?'menu':'link'});
  }
  const footer=page.layers.find(l=>l.name==='Shared footer');if(footer)walk(footer.children,l=>{if(/proposal-footer-heading/.test(l.id)){const n=q(root,l.id);if(n){if(!n.querySelector('a'))localAnchor(n,'mailto:lunagreen105@gmail.com',l.text);target(n,{kind:'footer'});}}});
  // Native fixed-size typewriters preserve original screen and speech-frame geometry.
  function typewriter(id,period=6500){const n=q(root,id),l=layerMap.get(id);if(!n||!l?.text)return;remember(n);replaceContent(n);modify(n,'luna-typewriter');n.setAttribute('aria-label',l.text);const text=document.createElement('span'),caret=document.createElement('i');caret.className='luna-typewriter-caret';caret.setAttribute('aria-hidden','true');n.append(text,caret);let last='';const item={node:n,active:true,update(t,staticMode){const phase=(t-epoch)%period,start=550,interval=Math.min(105,(period-2300)/l.text.length),count=staticMode?l.text.length:phase<start?0:phase<period-1000?Math.min(l.text.length,Math.floor((phase-start)/interval)):0,value=l.text.slice(0,count);if(value!==last){text.textContent=value;last=value;}}};loops.push(item);item.update(0,true);}
  if(page.id==='contact'){typewriter('contact-editable-speech-401',6500);typewriter('contact-phone-editable-screen-wording-399',7200);}
  // The biography enters once, paragraph by paragraph. Its original newlines remain
  // real text nodes, while blank-line boxes reserve exactly the existing line height.
  function finishBiography(record){record.animation?.cancel();record.animation=null;record.seen=true;record.node.classList.remove('luna-bio-pending');record.node.classList.add('luna-bio-revealed');}
  function revealBiography(record){
   if(record.seen||destroyed)return;record.seen=true;biographyObserver?.unobserve(record.node);
   if(!motionEnabled||reduced.matches||!record.node.animate){finishBiography(record);return;}
   const animation=record.node.animate([{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'translateY(0px)'}],{duration:600,delay:record.index*90,easing:'cubic-bezier(.2,.7,.2,1)',fill:'both'});record.animation=animation;animations.add(animation);
   animation.finished.then(()=>{if(!destroyed)finishBiography(record);}).catch(()=>{}).finally(()=>animations.delete(animation));
  }
  if(page.id==='about'){
   const l=layerMap.get('i-m-luna-an-ai-native-marketing-strategis-65'),n=l&&q(root,l.id);
   if(n&&l.type==='text'&&l.text?.trim()){
    remember(n);replaceContent(n);modify(n,'luna-biography');
    const lineHeight=numeric(l.lineHeight,numeric(l.fontSize,20)*1.3),canAnimate=motionEnabled&&!reduced.matches&&typeof IntersectionObserver==='function'&&typeof n.animate==='function';
    for(const piece of l.text.split(/(\n{2,})/)){
     if(/^\n{2,}$/.test(piece)){const gap=document.createElement('span');gap.className='luna-bio-gap';gap.textContent=piece;gap.style.height=(piece.length-1)*lineHeight+'px';n.append(gap);}
     else if(piece){const paragraph=document.createElement('span');paragraph.className='luna-bio-paragraph';paragraph.textContent=piece;n.append(paragraph);const record={node:paragraph,index:biography.length,seen:!canAnimate,animation:null};biography.push(record);paragraph.classList.add(canAnimate?'luna-bio-pending':'luna-bio-revealed');}
    }
    if(canAnimate){biographyObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){const record=biography.find(item=>item.node===entry.target);if(record)revealBiography(record);}},{root:scrollHost instanceof Element?scrollHost:null,rootMargin:'0px 0px -16px 0px',threshold:.04});biography.forEach(record=>biographyObserver.observe(record.node));}
   }
  }
  // Keep the current font shapes, revealed by broad row-by-row pen masks.
  if(page.id==='about')for(const [index,id]of ['ai-native-marketer-55','ai-automation-builder-58','creator-storyteller-57'].entries()){
   const n=q(root,id),l=layerMap.get(id);if(!n||!l)continue;remember(n);replaceContent(n);modify(n,'luna-handwritten');n.setAttribute('aria-label',l.text);const svg=svgElement('svg',{viewBox:`0 0 ${l.width} ${l.height}`,width:l.width,height:l.height}),defs=svgElement('defs'),maskID='luna-write-'+id+'-'+Math.random().toString(36).slice(2,6),mask=svgElement('mask',{id:maskID,maskUnits:'userSpaceOnUse',x:-25,y:-25,width:l.width+50,height:l.height+50}),foreign=svgElement('foreignObject',{x:0,y:0,width:l.width,height:l.height,mask:`url(#${maskID})`}),text=document.createElement('div');text.setAttribute('xmlns','http://www.w3.org/1999/xhtml');text.textContent=l.text;Object.assign(text.style,{fontFamily:l.fontFamily,fontSize:l.fontSize+'px',lineHeight:l.lineHeight+'px',fontWeight:l.fontWeight||400,fontStyle:l.fontStyle||'normal',color:l.color,textAlign:l.align||'left',whiteSpace:'pre-wrap'});foreign.append(text);
   l.text.split('\n').forEach((row,i)=>{const y=i*l.lineHeight+l.fontSize*.56,p=svgElement('path',{d:`M-20 ${y} C${l.width*.25} ${y-3} ${l.width*.62} ${y+3} ${l.width+20} ${y}`,fill:'none',stroke:'white','stroke-width':Math.max(l.fontSize*1.75,l.lineHeight*.95),'stroke-linecap':'round',pathLength:1,class:'luna-handwriting-brush'});p.style.setProperty('--luna-row-delay',(i*.9-index*.75)+'s');mask.append(p);});defs.append(mask);svg.append(defs,foreign);n.append(svg);loops.push({node:n,active:true,css:true});
  }
  if(page.id==='about'){
   const n=q(root,'roadmap-flow-line'),svg=n?.querySelector('svg'),path=svg?.querySelector('path');if(path){const arrow=svgElement('path',{d:'M-9 -6 L2 0 L-9 6',fill:'none',stroke:'#E5007D','stroke-width':4,'stroke-linecap':'round','stroke-linejoin':'round',class:'luna-roadmap-arrow','aria-hidden':'true'});add(svg,arrow);const length=path.getTotalLength();loops.push({node:n,active:true,update(t,staticMode){const cycle=((t-epoch)%14000)/14000,forward=cycle<.5,fraction=staticMode?.48:(1-Math.cos(cycle*Math.PI*2))/2,d=fraction*length,p=path.getPointAtLength(d),next=path.getPointAtLength(Math.max(0,Math.min(length,d+(forward?2:-2))));arrow.setAttribute('transform',`translate(${p.x} ${p.y}) rotate(${Math.atan2(next.y-p.y,next.x-p.x)*180/Math.PI})`);}});}
  }
  // Form controls use existing label / underline registration; no scene data mutations.
  if(page.id==='contact'){
   const group=q(root,'content-scale-contact-contact-form'),container=group?.firstElementChild;
   if(container){const form=document.createElement('form');form.className='luna-contact-form';form.setAttribute('aria-label','Contact Luna Ye');form.style.cssText='position:absolute;inset:0;pointer-events:auto';add(container,form);forms.push(form);
    for(const [id,name,type,autocomplete,lineID]of [['name-403','name','text','name','name-input-line-404'],['email-405','email','email','email','email-input-line-406'],['phone-407','phone','tel','tel','phone-input-line-408'],['leave-a-message-409','message','textarea','off','leave-a-message-input-line-410']]){
     const l=layerMap.get(id),line=layerMap.get(lineID),label=q(root,id);if(!l)continue;const input=document.createElement(type==='textarea'?'textarea':'input'),inputID='luna-contact-'+name;input.id=inputID;input.name=name;input.required=true;input.autocomplete=autocomplete;if(type!=='textarea')input.type=type;input.className='luna-contact-field';input.setAttribute('aria-label',l.text||name);Object.assign(input.style,{left:l.x+'px',top:l.y+l.height+4+'px',width:l.width+'px',height:Math.max(28,(line?.y||l.y+65)-(l.y+l.height)-4)+'px',fontFamily:l.fontFamily,fontSize:l.fontSize+'px',lineHeight:'1.45'});form.append(input);const lineNode=q(root,lineID);if(lineNode){remember(lineNode);lineNode.style.visibility='hidden';}if(label){modify(label,'luna-contact-label');listen(label,'click',()=>input.focus());}
    }
    const pill=layerMap.get('send-message-pill-411'),word=layerMap.get('send-message-412'),button=document.createElement('button');button.type='submit';button.className='luna-contact-submit';button.textContent=word?.text||'Send message';Object.assign(button.style,{left:(pill?.x||0)+'px',top:(pill?.y||896)+'px',width:(pill?.width||173)+'px',height:(pill?.height||46)+'px',fontFamily:word?.fontFamily||'Karla',fontSize:(word?.fontSize||16)+'px'});form.append(button);for(const id of ['send-message-pill-411','send-message-412']){const n=q(root,id);if(n){remember(n);n.style.visibility='hidden';}}
    const status=document.createElement('p');status.className='luna-contact-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');Object.assign(status.style,{left:(pill?.x||0)+(pill?.width||173)+22+'px',top:(pill?.y||896)+'px',width:'450px',fontFamily:word?.fontFamily||'Karla'});form.append(status);
    const endpoint=options.formEndpoint||settings.formEndpoint||project.contactForm?.endpoint||'';
    listen(form,'submit',async event=>{event.preventDefault();if(formSending||!form.reportValidity())return;
     if(!/^https:\/\//i.test(endpoint)){status.textContent='Your message has not been sent. Please email lunagreen105@gmail.com.';status.classList.add('luna-contact-error');return;}
     formSending=true;button.disabled=true;const original=button.textContent;button.textContent='Sending…';status.textContent='';status.classList.remove('luna-contact-error');
     try{const payload=Object.fromEntries(new FormData(form));payload._subject='Luna Ye website enquiry';const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload),signal:abort.signal});if(!response.ok)throw Error('Delivery service returned '+response.status);status.textContent='Thanks — your message has been sent.';form.reset();}catch(error){if(error.name!=='AbortError'){status.textContent='The message could not be sent. Please email lunagreen105@gmail.com.';status.classList.add('luna-contact-error');}}finally{formSending=false;if(!destroyed){button.disabled=false;button.textContent=original;}}
    });
   }
  }
  // A single pointer glow is shared by every page mount and stops outside the page.
  const glow=document.createElement('div');glow.className='luna-pointer-glow';glow.setAttribute('aria-hidden','true');add(document.body,glow);
  function pointerPaint(){backgroundFrame=0;if(destroyed)return;const b=root.getBoundingClientRect(),inside=px>=b.left&&px<=b.right&&py>=Math.max(0,b.top)&&py<=Math.min(innerHeight,b.bottom);glow.style.opacity=motionEnabled&&settings.pointerGlow!==false&&!reduced.matches&&fine.matches&&inside?'1':'0';glow.style.transform=`translate3d(${px-140}px,${py-140}px,0)`;if(outer&&motionEnabled&&fine.matches&&!reduced.matches){outer.style.setProperty('--luna-bg-x',(px/innerWidth-.5)*28+'px');outer.style.setProperty('--luna-bg-y',((py/innerHeight-.5)*12+Math.sin((outer.scrollTop||scrollY)/900)*7)+'px');}}
  function requestPointer(){if(!backgroundFrame)backgroundFrame=requestAnimationFrame(pointerPaint);}
  listen(document,'pointermove',e=>{px=e.clientX;py=e.clientY;requestPointer();},{passive:true});listen(scrollHost,'scroll',requestPointer,{passive:true});listen(document,'mouseleave',()=>glow.style.opacity='0');
  function staticMode(){return !motionEnabled||reduced.matches||document.visibilityState!=='visible';}
  function tick(time){frame=0;if(destroyed)return;const still=staticMode();for(const item of loops){if(item.css)continue;if(item.active||still)item.update?.(time,still);}if(!still&&loops.some(item=>item.active&&!item.css))frame=requestAnimationFrame(tick);}
  function schedule(){if(!frame&&!destroyed)frame=requestAnimationFrame(tick);}
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{for(const entry of entries)for(const item of loops)if(item.node===entry.target){item.active=entry.isIntersecting;item.node.classList.toggle('luna-loop-paused',!item.active);}schedule();},{root:scrollHost instanceof Element?scrollHost:null,rootMargin:'30px'}):null;
  for(const item of loops){remember(item.node);item.active=visible(item.node);item.node.classList.toggle('luna-loop-paused',!item.active);observer?.observe(item.node);}
  function preference(){const still=!motionEnabled||reduced.matches;root.classList.toggle('luna-reduced-motion',still);if(outer)outer.classList.toggle('luna-reduced-motion',still);glow.style.display=still||settings.pointerGlow===false||!fine.matches?'none':'';for(const item of loops){item.node.classList.toggle('luna-loop-paused',still||!item.active||document.visibilityState!=='visible');if(still)item.update?.(performance.now(),true);}if(still){biographyObserver?.disconnect();biography.forEach(finishBiography);}schedule();requestPointer();}
  listen(reduced,'change',preference);listen(fine,'change',preference);listen(document,'visibilitychange',preference);preference();
  const api={refresh(){for(const item of loops)item.active=visible(item.node);preference();return api;},getStats(){return{mounted:!destroyed,page:page.id,targets:targets.size,loops:loops.length,forms:forms.length,biographyParagraphs:biography.length,biographyRevealed:biography.filter(item=>item.seen).length,biographyVisible:biography.filter(item=>!item.node.classList.contains('luna-bio-pending')).length,pendingFrame:!!frame,reducedMotion:reduced.matches};},cleanup(){if(destroyed)return;destroyed=true;abort.abort();cancelAnimationFrame(frame);cancelAnimationFrame(backgroundFrame);observer?.disconnect();biographyObserver?.disconnect();timers.forEach(clearTimeout);animations.forEach(a=>a.cancel());for(const n of added)n.remove();for(const[n,children]of contents)n.replaceChildren(...children);for(const[n,attrs]of saved)for(const[key,value]of Object.entries(attrs)){if(value===null)n.removeAttribute(key);else n.setAttribute(key,value);}mounted.delete(root);instances.delete(api);}};
  mounted.set(root,api);instances.add(api);return api;
 }
 global.LunaSiteInteractions={mount,cleanup(root){if(root)mounted.get(root)?.cleanup();else [...instances].forEach(i=>i.cleanup());},version:'2026-10-15-approved-v1'};
})(window);
