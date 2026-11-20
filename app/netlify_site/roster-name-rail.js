/* Home phone roster: names are ordinary page content outside the horizontal
   scrolling layer. The original cells remain the source of truth. */
(()=>{'use strict';
 let host,wrap,table,rail,frame,rowsObserver,sizeObserver,lastTap=0;
 const mobile=matchMedia('(max-width:600px), (pointer:coarse) and (max-width:1024px)');
 function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;paint();});}
 function paint(){
  const next=document.querySelector('#attendanceRecordCard .rosterTable');
  if(!next)return;
  if(next!==table){
   rowsObserver?.disconnect();sizeObserver?.disconnect();rail?.remove();host?.classList.remove('rosterScrollHost','rosterRailActive');
   table=next;wrap=table.closest('.tableWrap');
   host=table.closest('#attendanceRecordCard');
   rail=document.createElement('div');rail.className='rosterNameRail';
   wrap.addEventListener('scroll',schedule,{passive:true});
   rowsObserver=new MutationObserver(schedule);rowsObserver.observe(table,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','style']});
   sizeObserver=new ResizeObserver(schedule);sizeObserver.observe(table);sizeObserver.observe(wrap);
  }
  const active=mobile.matches&&!!wrap.closest('#attendanceView')&&!document.body.classList.contains('beginnerRecordVisible');
  if(active&&!rail.isConnected)host.append(rail);
  host.classList.toggle('rosterScrollHost',active);
  host.classList.toggle('rosterRailActive',active);rail.hidden=!active;
  if(!active){rail.remove();return;}
  const base=host.getBoundingClientRect();
  const cells=[...table.querySelectorAll('#rosterHead th:nth-child(2),#rosterRows td.name')].filter(c=>c.getClientRects().length&&getComputedStyle(c.closest('tr')).display!=='none');
  const items=[];
  for(const cell of cells){
   const rect=cell.getBoundingClientRect(),style=getComputedStyle(cell),header=cell.tagName==='TH';
   const item=document.createElement('div');item.className='rosterRailCell'+(header?' rosterRailHeading':'');
   if(!header)item.dataset.studentId=cell.closest('tr').dataset.studentId;
   Object.assign(item.style,{top:(rect.top-base.top-host.clientTop)+'px',left:(rect.left-base.left-host.clientLeft)+'px',width:rect.width+'px',height:rect.height+'px',background:style.backgroundColor,color:style.color,fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,padding:style.padding,borderBottom:style.borderBottom});
   if(header){
    const button=document.createElement('button');button.type='button';button.className='rosterRailFilter';button.textContent=cell.textContent;button.title=cell.title;
    const open=()=>cell.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    button.ondblclick=open;button.onclick=e=>{if(e.detail===0){open();return;}const now=Date.now();if(now-lastTap<650){lastTap=0;open();}else lastTap=now;};
    item.append(button);
   }else{
    const original=cell.querySelector('.rosterFullName');if(original){const button=original.cloneNode(true);button.removeAttribute('aria-describedby');item.append(button);}
   }
   items.push(item);
  }
  // Keep focused/hovered buttons alive when geometry and contents are unchanged.
  const signature=items.map(i=>i.outerHTML).join('');
  if(rail._signature!==signature){rail.replaceChildren(...items);rail._signature=signature;}
 }
 addEventListener('resize',schedule,{passive:true});mobile.addEventListener('change',schedule);
 new MutationObserver(schedule).observe(document.body,{attributes:true,attributeFilter:['class']});
 new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&(n.id==='attendanceRecordCard'||n.querySelector?.('#attendanceRecordCard')))))schedule();}).observe(document.body,{childList:true,subtree:true});
 addEventListener('load',schedule);schedule();
})();
