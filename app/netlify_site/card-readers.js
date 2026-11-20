/* Optional card input adapters. No reader is started until explicitly enabled. */
(function () {
  'use strict';
  let adapter, mounted=false, enabled=false, testing=false, buffer=[], timer=0, scope='';
  let nfc=null, abort=null, nfcPending=false, nfcEpoch=0, nfcError='', queue=Promise.resolve();
  const recent=new Map(), pending=new Set();
  const state=()=>({rfid:enabled,testing,nfc:!!nfc,pending:nfcPending,nfcError,
    nfcSupported:window.isSecureContext && typeof window.NDEFReader==='function'});
  function changed(){adapter?.changed(state());}
  function clear(){clearTimeout(timer);buffer=[];scope='';}
  function code(value){
    const result=String(value ?? '').trim().replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).toUpperCase();
    return /^[A-Z0-9._:-]{1,128}$/.test(result)?result:'';
  }
  function editable(target){return !!target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');}
  function available(method){return adapter && !document.hidden && adapter.canScan() && (method==='rfid'?enabled:!!nfc);}
  function dispatch(raw,method,captured){
    const id=code(raw);if(!id){adapter?.invalid();return;}
    if(!available(method)||captured!==adapter.context())return;
    const key=captured+'|'+id,now=Date.now();
    if(pending.has(key)||now-(recent.get(key)||0)<1000)return;
    recent.set(key,now);if(recent.size>200)recent.delete(recent.keys().next().value);
    pending.add(key);
    queue=queue.then(async()=>{
      if(available(method)&&captured===adapter.context())await adapter.read(id,method);
    }).catch(error=>adapter?.error(error)).finally(()=>pending.delete(key));
  }
  function finish(terminated){
    const items=buffer,captured=scope;clear();if(!items.length)return;
    const raw=items.map(i=>i.key).join('');
    if(testing && adapter.testVisible()){adapter.testResult(raw);return;}
    const duration=items.at(-1).time-items[0].time;
    // Require a rapid burst outside editable controls; a scanner terminator is preferred.
    const burst=items.length>=2 && duration/Math.max(1,items.length-1)<=65;
    if(!burst || (!terminated && (items.length<3 || duration/(items.length-1)>45)))return;
    dispatch(raw,'rfid',captured);
  }
  function keydown(event){
    const test=testing && adapter?.testVisible();
    if(!adapter || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.repeat ||
       (!test && (!enabled || !adapter.owner() || document.hidden || editable(event.target)))){clear();return;}
    const current=adapter.context(),now=performance.now();
    if(scope && scope!==current)clear();
    if(event.key==='Enter'||event.key==='Tab'){
      if(buffer.length){event.preventDefault();event.stopImmediatePropagation();finish(true);}
      return;
    }
    if(event.key.length!==1){if(event.key!=='Shift')clear();return;}
    if(buffer.length && now-buffer.at(-1).time>(test?1000:100))clear();
    if(test){event.preventDefault();event.stopImmediatePropagation();}
    scope=current;buffer.push({key:event.key,time:now});
    if(buffer.length>128){clear();return;}
    clearTimeout(timer);timer=setTimeout(()=>finish(false),test?350:220);
  }
  function mount(){
    if(mounted)return;mounted=true;
    document.addEventListener('keydown',keydown,true);
    document.addEventListener('visibilitychange',()=>{clear();if(document.hidden){testing=false;stopNfc();changed();}});
    window.addEventListener('pagehide',()=>{clear();testing=false;stopNfc();});
  }
  function stopNfc(){
    nfcEpoch++;abort?.abort();abort=null;nfc=null;nfcPending=false;changed();
  }
  async function startNfc(){
    if(!state().nfcSupported || nfcPending)return;
    mount();stopNfc();const epoch=nfcEpoch,owner=adapter.owner();
    nfcError='';nfcPending=true;changed();
    const controller=new AbortController();abort=controller;
    try{
      const reader=new NDEFReader();
      reader.onreading=event=>{
        if(epoch!==nfcEpoch || owner!==adapter.owner() || !available('nfc'))return;
        const records=Array.from(event.message?.records||[]);
        // Read explicit student-code text only. Never infer a student from a card serial,
        // open a URL, execute tag instructions or attempt protected card access.
        if(records.length!==1 || records[0].recordType!=='text'){adapter.invalid();return;}
        const record=records[0];
        if(!record.data || record.data.byteLength>256){adapter.invalid();return;}
        try{
          const raw=new TextDecoder(record.encoding||'utf-8',{fatal:true}).decode(record.data);
          dispatch(raw,'nfc',adapter.context());
        }catch{adapter.invalid();}
      };
      reader.onreadingerror=()=>{if(epoch===nfcEpoch && available('nfc'))adapter.invalid();};
      await reader.scan({signal:controller.signal});
      if(epoch!==nfcEpoch||owner!==adapter.owner()){controller.abort();return;}
      nfc=reader;nfcPending=false;changed();
    }catch(error){
      if(epoch!==nfcEpoch)return;
      nfc=null;nfcPending=false;nfcError=error.name||'Error';changed();
    }
  }
  window.HathirCardReaders={
    configure(value){adapter=value;},
    state,
    enableRfid(value){enabled=!!value;clear();recent.clear();if(enabled)mount();changed();},
    test(value){testing=!!value;clear();if(testing)mount();changed();},
    startNfc,stopNfc,
    reset(){enabled=false;testing=false;clear();recent.clear();stopNfc();},
    normalizeCode:code
  };
})();
