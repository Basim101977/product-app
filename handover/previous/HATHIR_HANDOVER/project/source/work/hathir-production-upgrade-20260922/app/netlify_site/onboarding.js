/* Presentation-only tour. Opening a view never submits application data. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id),q=s=>s?document.querySelector(s):null;
 const opened=new Set();
 let ready=false,identity='',steps=[],index=0,mode='',transition,moving=false,internal=false,returnFocus,dismissTarget,interactionTarget,welcomed=false,armed=false,baseline='',pointerHeld=false;
 const visible=e=>!!e&&!e.hidden&&!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const owner=()=>session&&!$('appPage').hidden?JSON.stringify([session.uid,session.workspaceId,!!session.local]):'';
 const seenKey=()=> 'hathir-text-tour-v1:'+identity;
 function seen(){try{return localStorage.getItem(seenKey())==='1';}catch{return welcomed;}}
 function markSeen(){welcomed=true;try{localStorage.setItem(seenKey(),'1');}catch{}}
 let frame=0;
 function schedule(){if(mode&&!frame)frame=requestAnimationFrame(()=>{frame=0;render();});}
 function clickUI(id){const before=internal;internal=true;try{$(id)?.click();}finally{internal=before;}}
 function closeOpened(except=''){
  for(const id of [...opened])if(id!==except){
   if(visible($(id)))clickUI(id==='teachingSetupModal'?'closeTeachingSetup':'closeStudentProfileBtn');
   opened.delete(id);
  }
 }
 function stop(done=true){
  mode='';document.body.classList.remove('hathirTextTour');pointerHeld=false;cancelAnimationFrame(frame);frame=0;clearTimeout(transition);moving=false;
  if(ready){$('tourLayer').hidden=true;$('tourPanel').hidden=true;document.body.append($('tourPanel'),$('tourLayer'));}
  closeOpened();steps=[];
  if(visible(returnFocus))returnFocus.focus({preventScroll:true});render();
 }
 function start(){
  if(!owner()||cloudDataLoading)return;
  markSeen();if(mode)stop(false);
  window.HathirSettings?.close(false);if(q('.modalBackdrop:not([hidden])'))return;
  document.body.classList.add('hathirTextTour');returnFocus=document.activeElement;mode='welcome';steps=[];index=0;setView('attendanceView');
  const panel=$('tourPanel');panel.dataset.step='welcome';panel.setAttribute('aria-labelledby','tourEyebrow');panel.setAttribute('aria-describedby','tourWelcomeCopy');panel.dir=lang==='ar'?'rtl':'ltr';
  $('tourEyebrow').textContent=lang==='ar'?'مرحبًا بك في حاضر':'Welcome to Hathir';
  $('tourTitle').hidden=true;$('tourWelcomeCopy').hidden=false;$('tourProgress').hidden=true;
  $('tourWelcomeCopy').innerHTML=lang==='ar'?'موادّك وطلبتك، في مساحة واحدة.<br>حضورٌ أسهل، بالرمز أو بصمة الوجه.':'Manage subjects and students.<br>Track attendance by QR or face.';
  $('tourWelcomeBrand').hidden=false;labels();layout();animate();$('tourNext').focus({preventScroll:true});
 }
 function labels(){
  $('tourClose').setAttribute('aria-label',lang==='ar'?'إغلاق الجولة الإرشادية':'Close guided tour');
  $('tourNext').textContent=mode==='full'&&index===steps.length-1?(lang==='ar'?'إنهاء':'Finish'):(lang==='ar'?'متابعة':'Continue');
 }
 function begin(){mode='full';steps=window.HathirGuideLessons.filter(s=>['subject','course','setup-close','import','camera','sync'].includes(s.id));index=0;show();}
 function animate(){for(const el of [$('tourPanel'),$('tourLayer')]){el.classList.remove('tourLeaving','tourArrive');void el.offsetWidth;el.classList.add('tourArrive');}}
 function completed(action){if(mode==='full'&&(armed||action==='scan')&&!moving&&steps[index]?.done===action)advance();}
 function actionFinished(){
  if(!armed||moving||mode!=='full')return false;
  switch(steps[index].id){
   case 'subject':return visible($('teachingSetupModal'));
   case 'setup-close':return !visible($('teachingSetupModal'));
   case 'add':return visible($('studentProfileModal'));
   case 'profile-close':return !visible($('studentProfileModal'));
   case 'face-open':return !!profileFaceStream;
   case 'camera':return !!cameraStream;
   case 'course':return !!getSubject()&&getSubject().id!==baseline.subject&&!sectionLoadPending;
   case 'close':return baseline.canClose&&!visible($('completeLectureBtn'));
   default:return false;
  }
 }
 function prepare(s){
  closeOpened(s.modal);
  if(s.modal&&!visible($(s.modal))){
   if(s.modal==='teachingSetupModal')clickUI('teachingSetupBtn');
   else {
    const profile=q('#rosterRows [data-profile]');
    internal=true;try{if(profile)profile.click();else clickUI('addStudentQuickBtn');}finally{internal=false;}
   }
   if(visible($(s.modal)))opened.add(s.modal);
  }
 }
 function target(){
  const s=steps[index];if(!s)return null;
  if(s.modal&&!visible($(s.modal)))return visible($('beginnerChooseSubject'))?$('beginnerChooseSubject'):$('teachingSetupBtn');
  return [q(s.target),q(s.fallback),s.id==='subject'?$('beginnerChooseSubject'):null].find(visible);
 }
 function show(){
  const s=steps[index];if(!s)return;armed=false;prepare(s);baseline={subject:getSubject()?.id||'',canClose:visible($('completeLectureBtn'))};
  const panel=$('tourPanel');panel.dataset.step=s.id;panel.setAttribute('aria-labelledby','tourTitle');panel.removeAttribute('aria-describedby');panel.dir=lang==='ar'?'rtl':'ltr';
  $('tourEyebrow').textContent=lang==='ar'?'خطوة بخطوة':'Step by step';
  $('tourWelcomeBrand').hidden=true;$('tourTitle').hidden=false;$('tourWelcomeCopy').hidden=true;$('tourProgress').hidden=false;
  $('tourTitle').textContent=lang==='ar'?(s.note||s.title):s.en;
  $('tourProgress').textContent=(index+1)+' / '+steps.length;labels();
  target()?.scrollIntoView({block:innerWidth<600?'start':'center',behavior:'instant'});
  layout();animate();moving=false;$('tourNext').focus({preventScroll:true});
 }
 function advance(){
  if(!mode||moving)return;moving=true;
  $('tourLayer').classList.add('tourLeaving');$('tourPanel').classList.add('tourLeaving');
  transition=setTimeout(()=>{
   if(mode==='welcome')begin();else if(index===steps.length-1)stop();else{index++;show();}
  },matchMedia('(prefers-reduced-motion: reduce)').matches?0:160);
 }
 // One continuous outline joins the rounded rectangle to its tapered pointer.
 function balloon(x,y,w,h,side,tx,ty){
  const r=20,b=12,cx=Math.max(x+r+b,Math.min(x+w-r-b,tx)),cy=Math.max(y+r+b,Math.min(y+h-r-b,ty));
  return `M ${x+r} ${y} `+(side==='top'?`L ${cx-b} ${y} L ${tx} ${ty} L ${cx+b} ${y} `:'')+
   `L ${x+w-r} ${y} Q ${x+w} ${y} ${x+w} ${y+r} `+(side==='right'?`L ${x+w} ${cy-b} L ${tx} ${ty} L ${x+w} ${cy+b} `:'')+
   `L ${x+w} ${y+h-r} Q ${x+w} ${y+h} ${x+w-r} ${y+h} `+(side==='bottom'?`L ${cx+b} ${y+h} L ${tx} ${ty} L ${cx-b} ${y+h} `:'')+
   `L ${x+r} ${y+h} Q ${x} ${y+h} ${x} ${y+h-r} `+(side==='left'?`L ${x} ${cy+b} L ${tx} ${ty} L ${x} ${cy-b} `:'')+
   `L ${x} ${y+r} Q ${x} ${y} ${x+r} ${y} Z`;
 }
 function layout(){
  if(!mode||pointerHeld)return;
  const panel=$('tourPanel'),layer=$('tourLayer'),m=q('.modalBackdrop:not([hidden])');
  const host=m||document.fullscreenElement||document.body;
  if(layer.parentElement!==host)host.append(layer,panel);
  panel.hidden=false;layer.hidden=false;
  const vv=window.visualViewport,width=vv?.width||innerWidth,height=vv?.height||innerHeight,ox=vv?.offsetLeft||0,oy=vv?.offsetTop||0;
  panel.style.width=Math.min(mode==='welcome'?400:320,width-32)+'px';
  const pw=panel.offsetWidth,ph=panel.offsetHeight,gap=32,r=mode==='welcome'?null:target()?.getBoundingClientRect();
  const on=r&&r.bottom>oy&&r.top<oy+height&&r.right>ox&&r.left<ox+width;
  let x=ox+(width-pw)/2,y=mode==='welcome'?oy+(height-ph)/2:oy+height-ph-24,side='',tx=x,ty=y;
  layer.dataset.welcome=String(mode==='welcome');
  $('tourSpot').hidden=!on;
  let hole=null;
  if(on){
   const al=Math.max(ox,r.left),at=Math.max(oy,r.top),ar=Math.min(ox+width,r.right),ab=Math.min(oy+height,r.bottom);
   const l=Math.max(ox,al-5),t=Math.max(oy,at-5),rr=Math.min(ox+width,ar+5),bb=Math.min(oy+height,ab+5);
   const mx=(al+ar)/2,my=(at+ab)/2;
   hole={l,t,rr,bb};
   Object.assign($('tourSpot').style,{left:l+'px',top:t+'px',width:rr-l+'px',height:bb-t+'px'});
   const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
   if(l-ox>pw+gap+16){x=l-pw-gap;y=clamp(my-ph/2,oy+16,oy+height-ph-16);side='right';tx=al;ty=my;}
   else if(ox+width-rr>pw+gap+16){x=rr+gap;y=clamp(my-ph/2,oy+16,oy+height-ph-16);side='left';tx=ar;ty=my;}
   else if(bb+gap+ph<oy+height-16){x=clamp(mx-pw/2,ox+16,ox+width-pw-16);y=bb+gap;side='top';tx=mx;ty=ab;}
   else if(t-gap-ph>oy+16){x=clamp(mx-pw/2,ox+16,ox+width-pw-16);y=t-gap-ph;side='bottom';tx=mx;ty=at;}
   else {
    const below=oy+height-bb,above=t-oy;
    if(below>=above){y=oy+height-ph-16;side='top';tx=mx;ty=ab;}
    else {y=oy+16;side='bottom';tx=mx;ty=at;}
    x=clamp(mx-pw/2,ox+16,ox+width-pw-16);
    // If a large target fills the viewport, avoid a false pointer into unrelated UI.
    if((side==='top'&&ty>=y)||(side==='bottom'&&ty<=y+ph))side='';
   }
  }
  const rects=hole?[[ox,oy,width,hole.t-oy],[ox,hole.t,hole.l-ox,hole.bb-hole.t],[hole.rr,hole.t,ox+width-hole.rr,hole.bb-hole.t],[ox,hole.bb,width,oy+height-hole.bb]]:[[ox,oy,width,height],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  [...layer.querySelectorAll('.tourFog')].forEach((el,i)=>{const [l,t,w,h]=rects[i];Object.assign(el.style,{left:l+'px',top:t+'px',width:Math.max(0,w)+'px',height:Math.max(0,h)+'px'});});
  layer.dataset.tipX=String(tx);layer.dataset.tipY=String(ty);
  Object.assign(panel.style,{left:x+'px',top:y+'px'});
  $('tourBalloon').setAttribute('d',balloon(x,y,pw,ph,side,tx,ty));layer.dataset.side=side;
 }
 const related={name:['saveStudentProfileBtn'],hours:['saveTeachingAnnualHours','attendanceDurationSelect'],qr:['profileQrSave','profileQrRetry'],import:['studentImportFile']};
 function isTourInteraction(node){
  if($('tourPanel').contains(node))return true;
  if(mode!=='full')return false;
  if(steps[index]?.id==='subject'&&($('beginnerChooseSubject')?.contains(node)||$('teachingSetupBtn')?.contains(node)))return true;
  return !!target()?.contains(node)||(related[steps[index]?.id]||[]).some(id=>$(id)?.contains(node));
 }
 function render(){
  if(!ready)return;const next=owner();
  if(next!==identity){identity=next;welcomed=false;if(mode)stop(false);}
  $('tourReplay').disabled=!identity||cloudDataLoading;
  if(mode){
   if(!$('attendanceView').classList.contains('active'))stop();
   else if(actionFinished())advance();else layout();
  }else if(identity&&!welcomed&&!seen()&&!subjects.length&&!cloudDataLoading&&$('attendanceView').classList.contains('active')&&!q('.modalBackdrop:not([hidden])'))start();
 }
 function init(){
  if(ready)return;ready=true;
  const layer=document.createElement('div');layer.id='tourLayer';layer.hidden=true;layer.setAttribute('aria-hidden','true');
  layer.innerHTML='<div class="tourFog"></div><div class="tourFog"></div><div class="tourFog"></div><div class="tourFog"></div><div id="tourSpot"></div><svg id="tourShape" width="100%" height="100%"><path id="tourBalloon"/></svg>';document.body.append(layer);
  const panel=document.createElement('section');panel.id='tourPanel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','tourEyebrow tourTitle');
  panel.innerHTML='<div id="tourWelcomeBrand" hidden><img src="assets/hathir-white-brand-768-20260914.webp" width="768" height="768" alt=""></div><div class="tourTop"><span id="tourEyebrow"></span><button id="tourClose" type="button"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div><h3 id="tourTitle"></h3><p id="tourWelcomeCopy" hidden></p><div class="tourFooter"><span id="tourProgress" dir="ltr"></span><button id="tourNext" type="button">متابعة</button></div>';document.body.append(panel);
  const replay=document.createElement('button');replay.id='tourReplay';replay.type='button';replay.className='btn ghost';replay.textContent='?';replay.setAttribute('aria-label','المساعدة والفيديوهات');replay.title='المساعدة والفيديوهات';$('settingsBtn').before(replay);
  replay.onclick=()=>{if(mode)stop();window.open('help.html','_blank','noopener');};$('tourNext').onclick=advance;$('tourClose').onclick=()=>stop();
  document.addEventListener('pointerdown',e=>{
   pointerHeld=true;
   dismissTarget=null;interactionTarget=mode&&isTourInteraction(e.target)?e.target:null;
   if(mode==='full'&&steps[index]?.id==='subject'&&$('beginnerChooseSubject')?.contains(e.target)){
    armed=true;e.preventDefault();e.stopImmediatePropagation();clickUI('teachingSetupBtn');opened.add('teachingSetupModal');queueMicrotask(render);return;
   }
   if(mode&&!internal&&!isTourInteraction(e.target)){
    dismissTarget=e.target;e.preventDefault();e.stopImmediatePropagation();stop();
   }
  },true);
  for(const type of ['pointerup','pointercancel'])document.addEventListener(type,()=>requestAnimationFrame(()=>{pointerHeld=false;if(mode)render();}),true);
  document.addEventListener('click',e=>{
   if(interactionTarget&&e.target!==interactionTarget&&e.target.contains(interactionTarget)){interactionTarget=null;e.preventDefault();e.stopImmediatePropagation();return;}
   const allowed=interactionTarget===e.target;interactionTarget=null;
   if(mode==='full'&&!internal&&!$('tourPanel').contains(e.target)&&isTourInteraction(e.target))armed=true;
   if(mode&&!internal&&($('teachingSetupBtn').contains(e.target)||$('beginnerChooseSubject')?.contains(e.target))&&isTourInteraction(e.target)&&!visible($('teachingSetupModal')))opened.add('teachingSetupModal');
   if(mode==='full'&&!internal&&steps[index]?.id==='add'&&$('addStudentQuickBtn').contains(e.target)&&!visible($('studentProfileModal')))opened.add('studentProfileModal');
   if(dismissTarget&&e.target===dismissTarget){dismissTarget=null;e.preventDefault();e.stopImmediatePropagation();return;}
   if(mode&&!internal&&!allowed&&!isTourInteraction(e.target)){e.preventDefault();e.stopImmediatePropagation();stop();}
  },true);
  document.addEventListener('change',e=>{
   if(mode!=='full'||internal||moving||!isTourInteraction(e.target))return;armed=true;
   const s=steps[index];if(s.event===e.target.id&&e.target.value)advance();else queueMicrotask(render);
  });
  document.addEventListener('keydown',e=>{if(mode&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();stop();}},true);
window.addEventListener('pagehide',()=>stop(false));
  new MutationObserver(render).observe($('appPage'),{attributes:true,attributeFilter:['hidden']});
  window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);
  window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
  document.addEventListener('click',()=>queueMicrotask(schedule));
  new MutationObserver(schedule).observe($('teachingSetupModal'),{attributes:true,attributeFilter:['hidden']});
  render();
 }
 window.HathirOnboarding={init,render,start,stop,completed};
})();

