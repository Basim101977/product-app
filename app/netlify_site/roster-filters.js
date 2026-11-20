(()=>{'use strict';
 const $=id=>document.getElementById(id),filters=new Map(),collator=new Intl.Collator('ar',{numeric:true,sensitivity:'base'});let scope='',columns=[],rows=[],dialog,current,draft,draftDirty=false,observer,applying=false;
 let largePage=1,largeQuery='',largePager;
 const clean=s=>{s=String(s||'').trim();return s==='—'||s==='–'?'':s;};
 function pageRows(){
  const visible=rows.filter(r=>passes(r)),query=$('studentSearch').value;
  if(query!==largeQuery){largeQuery=query;largePage=1;}
  const pages=Math.max(1,Math.ceil(visible.length/100));largePage=Math.max(1,Math.min(largePage,pages));
  const paged=rows.length>150&&!rosterPrintMode&&!window.matchMedia('print').matches;
  if(!largePager){largePager=document.createElement('div');largePager.id='largeRosterPager';largePager.setAttribute('aria-label','صفحات سجل الحضور');
   const prev=document.createElement('button'),label=document.createElement('span'),next=document.createElement('button');prev.type=next.type='button';prev.className=next.className='btn ghost';label.setAttribute('role','status');
   prev.onclick=()=>{largePage--;apply();};next.onclick=()=>{largePage++;apply();};largePager.append(prev,label,next);$('rosterRows').closest('.tableWrap').before(largePager);}
  largePager.hidden=!paged;largePager.children[0].textContent=lang==='ar'?'السابق':'Previous';largePager.children[2].textContent=lang==='ar'?'التالي':'Next';largePager.children[0].disabled=largePage<=1;largePager.children[2].disabled=largePage>=pages;
  largePager.children[1].textContent=lang==='ar'?`صفحة ${largePage} / ${pages} · ${visible.length} طالب`:`Page ${largePage} / ${pages} · ${visible.length} students`;
  const shown=rows.length<=150?rows:paged?visible.slice((largePage-1)*100,largePage*100):visible;
  const body=$('rosterRows');if(rows.length&&([...body.children].length!==shown.length||shown.some((r,i)=>body.children[i]!==r)))body.replaceChildren(...shown);
 }
 function value(row,c){const cell=row.cells[c.index];if(!cell||cell.querySelector('.attendanceTimeEmpty'))return '';if(c.key==='face')return cell.querySelector('.facePortrait.saved')?'بصمة':'';const select=cell.querySelector('select');return clean(select?select.value:cell.textContent);}
 function passes(row,except){for(const [key,values] of filters){if(key===except)continue;const c=columns.find(c=>c.key===key);if(c&&!values.has(value(row,c)))return false;}return true;}
 function numeric(v,kind){const s=v.replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g,'.').replace(/[٪% ,]/g,'');if(kind==='hours'&&/^\d+:\d+$/.test(s)){const [h,m]=s.split(':').map(Number);return h*60+m;}return s!==''&&Number.isFinite(Number(s))?Number(s):null;}
 function observe(){observer?.observe($('rosterRows'),{childList:true,subtree:true,characterData:true});}
 function apply(){if(applying||!$('rosterHead')||!$('rosterRows'))return;applying=true;observer?.disconnect();try{
  const subject=attendanceView(),next=JSON.stringify([session?.uid,subject?.id,(subject?._sources||[]).map(x=>x.id)]);if(next!==scope){scope=next;largePage=1;filters.clear();dialog?.close();}
  rows=rosterRowById instanceof Map?[...rosterRowById.values()]:[...$('rosterRows').querySelectorAll('tr[data-student-id]')];const headers=[...($('rosterHead').querySelector('tr')?.cells||[])];columns=[];const hasStatus=headers.at(-1)?.hasAttribute('data-personal-status-head'),tail=headers.length-(hasStatus?6:5);
  headers.forEach((th,index)=>{if(index===0||th.classList.contains('studentIdentityColumn')||(th.classList.contains('faceIndicatorColumn')&&document.body.classList.contains('faceAttendanceOff')))return;const sample=rows[0]?.cells[index];if(sample?.querySelector('.miniActions')||index===headers.length-(hasStatus?2:1))return;let key,kind='';const lecture=th.querySelector('[data-device-lecture]');if(lecture)key='lecture:'+lecture.dataset.deviceLecture;else if(th.hasAttribute('data-personal-status-head'))key='status';else if(th.classList.contains('faceIndicatorColumn'))key='face';else if(index===0){key='number';kind='number';}else if(index===1)key='name';else if(index===tail||sample?.classList.contains('js-attended-hours')){key='attended';kind='hours';}else if(index===tail+1||sample?.classList.contains('js-absent-hours')){key='absent';kind='hours';}else if(index===tail+2||sample?.classList.contains('js-absence-percent')){key='percent';kind='number';}else key='flag';
   const title=th.textContent.trim(),c={key,index,kind,title,th};columns.push(c);th.dataset.filterKey=key;th.title='انقر مرتين للفلترة';th.classList.add('rosterFilterHeader');th.classList.toggle('rosterFilterActive',filters.has(key));th.tabIndex=0;th.onkeydown=e=>{if(e.target===th&&(e.key==='Enter'||e.key===' ')){e.preventDefault();open(c,th);}};

  });
  for(const key of filters.keys())if(!columns.some(c=>c.key===key))filters.delete(key);
  for(const row of rows){row.classList.toggle('rosterFilterExcluded',!passes(row));const name=row.querySelector('td.name');if(name){name.removeAttribute('title');if(!name.querySelector('.rosterFullName')){const button=document.createElement('button');button.type='button';button.className='rosterFullName';if(name.dataset.nameAttendance){button.dataset.nameAttendance=name.dataset.nameAttendance;button.title=lang==='ar'?'انقر مرتين لتسجيل الحضور':'Double-click to record attendance';}button.textContent=name.textContent;button.setAttribute('aria-label','عرض الاسم الكامل: '+name.textContent.trim());name.replaceChildren(button);}}}
  let bar=$('rosterFilterSummary');if(!bar){bar=document.createElement('div');bar.id='rosterFilterSummary';bar.innerHTML='<span role="status"></span><button type="button" class="btn ghost">مسح الفلاتر</button>';$('studentSearch').after(bar);bar.querySelector('button').onclick=()=>{filters.clear();apply();};}bar.hidden=!filters.size;bar.querySelector('span').textContent='عرض '+rows.filter(r=>passes(r)).length+' من '+rows.length+' طالبًا';
 const visibleColumns=headers.filter(th=>!th.classList.contains('studentIdentityColumn')&&!(th.classList.contains('faceIndicatorColumn')&&document.body.classList.contains('faceAttendanceOff'))).length;
 if(visibleColumns)$('rosterRows').querySelectorAll('tr:not([data-student-id]) > td[colspan]').forEach(cell=>{cell.colSpan=visibleColumns;});
 if(dialog?.open&&current){const updated=columns.find(c=>c.key===current.key);if(updated){current=updated;if(!draftDirty&&!filters.has(current.key))draft=new Set(rows.map(r=>value(r,current)));paint();}else dialog.close();}
  pageRows();setupNameWidth();}finally{applying=false;observe();}}
 function options(){const q=$('rosterFilterSearch').value.trim().toLocaleLowerCase('ar');const values=new Set(rows.filter(r=>passes(r,current.key)).map(r=>value(r,current)));for(const v of filters.get(current.key)||[])values.add(v);return [...values].sort((a,b)=>{if(current.kind){const x=numeric(a,current.kind),y=numeric(b,current.kind);if(x!==null&&y!==null)return x-y;}return collator.compare(a,b);}).filter(v=>(v||'فارغ Blank').toLocaleLowerCase('ar').includes(q));}
 function paint(){const box=$('rosterFilterValues');box.replaceChildren();const values=options();for(const v of values){const label=document.createElement('label'),input=document.createElement('input'),span=document.createElement('span');input.type='checkbox';input.checked=draft.has(v);input.onchange=()=>{draftDirty=true;input.checked?draft.add(v):draft.delete(v);updateAll();};span.textContent=v||'فارغ (Blank)';label.append(input,span);box.append(label);}if(!values.length)box.textContent='لا توجد قيم مطابقة';updateAll();}
 function updateAll(){const values=options(),count=values.filter(v=>draft.has(v)).length;const all=$('rosterFilterAll');all.checked=values.length>0&&count===values.length;all.indeterminate=count>0&&count<values.length;}
 function open(c,b){current=c;draftDirty=false;draft=new Set(filters.get(c.key)||rows.map(r=>value(r,c)));$('rosterFilterTitle').textContent=c.title;$('rosterFilterSearch').value='';paint();$('rosterFilterDelete').hidden=!c.key.startsWith('lecture:');if(!dialog.open)dialog.showModal();$('rosterFilterTitle').focus({preventScroll:true});const rect=b.getBoundingClientRect(),width=Math.min(320,innerWidth-24);dialog.style.width=width+'px';dialog.style.left=Math.max(12,Math.min(rect.right-width,innerWidth-width-12))+'px';dialog.style.top=Math.max(12,Math.min(rect.bottom+6,innerHeight-dialog.offsetHeight-12))+'px';$('rosterFilterDelete').hidden=!c.key.startsWith('lecture:');$('rosterFilterDelete').onclick=()=>{const button=c.th.querySelector('[data-device-lecture]');dialog.close();window.HathirLectureColumnActions?.open(button);};}
 function setup(){if(dialog||!$('rosterRows'))return;dialog=document.createElement('dialog');dialog.id='rosterFilterDialog';dialog.dir='rtl';dialog.setAttribute('aria-labelledby','rosterFilterTitle');dialog.innerHTML='<strong id="rosterFilterTitle" tabindex="-1" autofocus></strong><input id="rosterFilterSearch" type="search" placeholder="بحث في قيم العمود" aria-label="بحث في قيم العمود"><label class="rosterFilterAll"><input type="checkbox" id="rosterFilterAll">تحديد الكل</label><div id="rosterFilterValues"></div><div class="rosterFilterActions"><button type="button" id="rosterFilterApply">تطبيق</button><button type="button" id="rosterFilterCancel">إلغاء</button></div><button type="button" id="rosterFilterDelete" hidden>مسح حضور هذه المحاضرة</button>';document.body.append(dialog);$('rosterFilterSearch').oninput=paint;$('rosterFilterAll').onchange=e=>{draftDirty=true;for(const v of options())e.target.checked?draft.add(v):draft.delete(v);paint();};$('rosterFilterApply').onclick=()=>{const all=new Set(rows.map(r=>value(r,current)));if([...all].every(v=>draft.has(v)))filters.delete(current.key);else filters.set(current.key,new Set(draft));dialog.close();apply();};$('rosterFilterCancel').onclick=()=>dialog.close();window.addEventListener('resize',()=>{if(dialog.open){dialog.style.left=Math.max(12,Math.min(parseFloat(dialog.style.left)||12,innerWidth-dialog.offsetWidth-12))+'px';dialog.style.top=Math.max(12,Math.min(parseFloat(dialog.style.top)||12,innerHeight-dialog.offsetHeight-12))+'px';}});observer=new MutationObserver(apply);apply();}
 let lastTouch={key:'',at:0},touchStart=null,lastTouchEnd=0;
 function activate(target){const th=target.closest('#rosterHead th[data-filter-key]');if(!th)return;const c=columns.find(c=>c.key===th.dataset.filterKey);if(c)open(c,c.th);}
 function tap(target,x,y){const th=target.closest('#rosterHead th[data-filter-key]');if(!th||dialog?.open)return;const key=scope+th.dataset.filterKey,at=Date.now();if(key===lastTouch.key&&at-lastTouch.at<650&&Math.hypot(x-lastTouch.x,y-lastTouch.y)<32){lastTouch={key:'',at:0};activate(th);return true;}else lastTouch={key,at,x,y};}
 document.addEventListener('dblclick',e=>{if(e.target.closest('#rosterHead th[data-filter-key]')){e.preventDefault();if(!dialog?.open)activate(e.target);}});
 document.addEventListener('touchstart',e=>{const t=e.touches[0],th=e.target.closest('#rosterHead th[data-filter-key]');touchStart=e.touches.length===1&&th?{x:t.clientX,y:t.clientY,at:Date.now()}:null;},{passive:true,capture:true});
 document.addEventListener('touchmove',e=>{const t=e.touches[0];if(touchStart&&(!t||Math.hypot(t.clientX-touchStart.x,t.clientY-touchStart.y)>12))touchStart=null;},{passive:true,capture:true});
 document.addEventListener('touchcancel',()=>{touchStart=null;lastTouch={key:'',at:0};},{passive:true});
 document.addEventListener('touchend',e=>{lastTouchEnd=Date.now();const t=e.changedTouches[0];if(touchStart&&t&&Date.now()-touchStart.at<700&&tap(e.target,t.clientX,t.clientY))e.preventDefault();touchStart=null;},{passive:false,capture:true});
 document.addEventListener('pointerup',e=>{if(e.pointerType==='touch'&&!('ontouchstart' in window)&&Date.now()-lastTouchEnd>80)tap(e.target,e.clientX,e.clientY);});

 document.addEventListener('click',e=>{if(Date.now()-lastTouchEnd>750&&e.target.closest('#rosterHead th[data-filter-key]'))tap(e.target,e.clientX,e.clientY);},true);
 function setupNameWidth(){const table=$('rosterHead')?.closest('table'),wrap=table?.closest('.tableWrap');if(!wrap)return;
  const sample=table.querySelector('.rosterFullName');if(sample){const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=getComputedStyle(sample).font;let width=175;for(const button of table.querySelectorAll('.rosterFullName'))width=Math.max(width,Math.ceil(ctx.measureText(button.textContent).width)+24);table.style.setProperty('--roster-full-name-width',width+'px');}
  if(!wrap._nameCollapse){let timer;const update=()=>{const distance=Math.abs(wrap.scrollLeft);if(distance>24)table.classList.add('rosterNamesCompact');else if(distance<2)table.classList.remove('rosterNamesCompact');};wrap.addEventListener('scroll',()=>{clearTimeout(timer);if(Math.abs(wrap.scrollLeft)>24)update();else timer=setTimeout(update,160);},{passive:true});window.addEventListener('resize',update,{passive:true});wrap._nameCollapse=update;}wrap._nameCollapse();
 }

 let nameTip,nameAnchor;
 function hideNameTip(){if(!nameTip)return;nameAnchor?.removeAttribute('aria-describedby');nameAnchor=null;if(nameTip.matches(':popover-open'))nameTip.hidePopover();nameTip.hidden=true;}
 function showNameTip(button){
  if(!nameTip){nameTip=document.createElement('div');nameTip.id='rosterNameTooltip';nameTip.dir='auto';nameTip.setAttribute('role','tooltip');nameTip.setAttribute('popover','manual');document.body.append(nameTip);}
  nameAnchor?.removeAttribute('aria-describedby');nameAnchor=button;button.setAttribute('aria-describedby',nameTip.id);nameTip.textContent=button.textContent;nameTip.hidden=false;
  if(nameTip.showPopover&&!nameTip.matches(':popover-open'))nameTip.showPopover();
  const rect=button.getBoundingClientRect(),tip=nameTip.getBoundingClientRect();
  nameTip.style.left=Math.max(8,Math.min(rect.right-tip.width,innerWidth-tip.width-8))+'px';
  nameTip.style.top=Math.max(8,rect.bottom+6+tip.height<=innerHeight-8?rect.bottom+6:rect.top-tip.height-6)+'px';
 }
 document.addEventListener('pointerover',e=>{const b=e.target.closest('#rosterRows .rosterFullName, .rosterNameRail .rosterFullName');if(b&&e.pointerType==='mouse')showNameTip(b);});
 document.addEventListener('pointerout',e=>{if(e.pointerType==='mouse'&&nameAnchor?.contains(e.target)&&!nameAnchor.contains(e.relatedTarget))hideNameTip();});
 document.addEventListener('focusin',e=>{if(e.target.matches('#rosterRows .rosterFullName, .rosterNameRail .rosterFullName'))showNameTip(e.target);});
 document.addEventListener('focusout',e=>{if(e.target===nameAnchor)hideNameTip();});
 document.addEventListener('click',e=>{const b=e.target.closest('#rosterRows .rosterFullName, .rosterNameRail .rosterFullName');if(b){e.stopPropagation();showNameTip(b);}});
 document.addEventListener('pointerdown',e=>{if(nameAnchor&&!nameAnchor.contains(e.target))hideNameTip();},true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape')hideNameTip();});
 document.addEventListener('scroll',hideNameTip,{capture:true,passive:true});window.addEventListener('resize',hideNameTip,{passive:true});
 document.addEventListener('hathir-face-preference',apply);
 window.addEventListener('beforeprint',()=>{observer?.disconnect();$('rosterRows')?.replaceChildren(...rows.filter(r=>passes(r)));});window.addEventListener('afterprint',apply);
 const render=renderRoster;renderRoster=function(...args){hideNameTip();const result=render.apply(this,args);setup();apply();return result;};const prior=init;init=function(...args){const result=prior.apply(this,args);setup();return result;};
})();

