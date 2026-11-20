/* Local preview controls only. Loaded by preview.cjs, never by the production HTML. */
window.addEventListener('load',()=>{
 const panel=document.createElement('details');panel.open=true;panel.dir='rtl';panel.style.cssText='margin:12px;padding:12px;background:#edf6ff;border:1px solid #9cc8ed;border-radius:12px;font:14px Tajawal,Arial';
 const summary=document.createElement('summary');summary.textContent='تجربة القسم والمرحلة — بيانات وهمية فقط';panel.append(summary);
 const note=document.createElement('p');note.textContent='اختر المادة التجريبية، ثم جرّب قراءة بطاقة بالزر أو حمّل صورتها لتجربة الكاميرا. لا توجد شعب ولا اتصال بالسحابة.';panel.append(note);
 const out=document.createElement('p');out.setAttribute('role','status');
 const samples=[['بطاقة جديدة مطابقة','matching'],['قسم مختلف — يُرفض','department'],['مرحلة مختلفة — تُرفض','stage'],['بطاقة قديمة — تطلب موافقة','legacy']];
 const payload=kind=>{const s=getSubject();if(!s)throw Error('اختر مادة أولًا');return kind==='legacy'?HathirNameQR.encodePortable('طالب بطاقة قديمة تجريبي'):HathirNameQR.encodeScoped('طالب بطاقة جديدة تجريبي',kind==='department'?'other_department':s.departmentId,kind==='stage'?'other_stage':s.stageId);};
 for(const [label,kind] of samples){
  const row=document.createElement('div');row.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin:8px 0';
  const scan=document.createElement('button');scan.textContent=label;scan.type='button';scan.dataset.previewScan=kind;
  scan.onclick=async()=>{try{const ok=await processNameQr(payload(kind),'scan');out.textContent=ok?'تم التسجيل في البيانات التجريبية.':'لم يُسجّل حضور جديد؛ راجع رسالة حاضر.';}catch(e){out.textContent=e.message;}};
  const download=document.createElement('button');download.textContent='تحميل البطاقة';download.type='button';
  download.onclick=async()=>{try{const canvas=await makeQrCanvas(payload(kind),720),a=document.createElement('a');a.href=canvas.toDataURL('image/png');a.download='hathir-preview-'+kind+'.png';a.click();}catch(e){out.textContent=e.message;}};
  row.append(scan,download);panel.append(row);
 }
 panel.append(out);document.getElementById('beginnerHub').before(panel);
});
