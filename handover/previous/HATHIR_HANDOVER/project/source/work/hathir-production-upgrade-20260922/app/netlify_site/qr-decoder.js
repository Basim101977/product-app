/* QR pixels only: keep decoding off the UI thread; never send student records. */
(() => {
  let worker, disabled=false, sequence=0;
  const pending=new Map();
  const fallback=image=>window.jsQR(image.data,image.width,image.height,{inversionAttempts:'dontInvert'});
  function stop(){
    disabled=true;worker?.terminate();worker=null;
    for(const job of pending.values()){clearTimeout(job.timer);job.resolve(fallback(job.image));}
    pending.clear();
  }
  window.HathirQrDecoder={decode(image){
    if(disabled||typeof Worker==='undefined')return Promise.resolve(fallback(image));
    if(!worker){
      try{
        worker=new Worker('qr-decoder-worker.js');
        worker.onmessage=({data})=>{
          const job=pending.get(data.id);if(!job)return;
          clearTimeout(job.timer);pending.delete(data.id);
          job.resolve(data.error?fallback(job.image):data.code);
        };
        worker.onerror=event=>{event.preventDefault();stop();};
      }catch(_){stop();return Promise.resolve(fallback(image));}
    }
    return new Promise(resolve=>{
      const id=++sequence,timer=setTimeout(stop,2000);
      pending.set(id,{resolve,timer,image});
      // Retain the original pixels for a safe decoder fallback after a crash.
      try{worker.postMessage({id,pixels:image.data,width:image.width,height:image.height});}
      catch(_){stop();}
    });
  }};
})();
