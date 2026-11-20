importScripts('vendor/jsQR-1.4.0.min.js');
self.onmessage=({data})=>{
  try{
    const code=jsQR(data.pixels,data.width,data.height,{inversionAttempts:'dontInvert'});
    self.postMessage({id:data.id,code:code?{data:code.data}:null});
  }catch(_){self.postMessage({id:data.id,error:true});}
};
