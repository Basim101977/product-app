/* A fresh outside press dismisses only its own overlay using existing cancel paths. */
(()=>{'use strict';
 let press=null;
 const closeIds={settingsModal:'closeSettingsBtn',teachingSetupModal:'closeTeachingSetup',ownerRegistrationModal:'closeOwnerRegistrationBtn',studentProfileModal:'closeStudentProfileBtn',attendanceTimeModal:'closeAttendanceTimeModalBtn',memberProfileModal:'closeMemberProfileBtn'};
 function outside(e){const n=e.target;if(!(n instanceof Element))return null;if(n.matches('dialog[open]')){const r=n.getBoundingClientRect();return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom?n:null;}return n.matches('.modalBackdrop:not([hidden])')?n:null;}
 document.addEventListener('pointerdown',e=>{const node=outside(e);press=e.isPrimary!==false&&e.button===0&&node?{node,x:e.clientX,y:e.clientY,at:Date.now()}:null;},true);
 document.addEventListener('pointermove',e=>{if(press&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>12)press=null;},true);
 document.addEventListener('pointercancel',()=>{press=null;},true);
 document.addEventListener('pointerup',e=>{const p=press;press=null;const node=outside(e);if(!p||node!==p.node||Date.now()-p.at>1000||Math.hypot(e.clientX-p.x,e.clientY-p.y)>12)return;
 if(node.tagName==='DIALOG'){const cancel=new Event('cancel',{cancelable:true});if(node.dispatchEvent(cancel)&&node.open)node.close();}
 else{const button=document.getElementById(closeIds[node.id]);if(!button||button.disabled)return;button.click();}
 e.preventDefault();e.stopImmediatePropagation();
 },true);
})();
