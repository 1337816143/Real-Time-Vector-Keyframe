// Diagnostic-only raw SDK benchmark. Not imported by the product and never built into dist.
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { faceFromLandmarks } from '../src/engine/faceGeometry';
const scope=self as unknown as {onmessage:((e:MessageEvent)=>void)|null;postMessage:(data:unknown)=>void;ModuleFactory:unknown;Module:unknown};
// CPU wall time spent inside existing GL calls; no finish/synchronization is inserted.
// This is not a GPU timer and the remainder is not a pure model-compute measurement.
const glStats:Record<string,{calls:number;ms:number}>={};
const wrappedGlMethods=new WeakSet<Function>();
for(const name of ['texImage2D','texSubImage2D','readPixels','finish','flush','drawArrays','drawElements']){
  for(const kind of ['WebGLRenderingContext','WebGL2RenderingContext']){
    const Constructor=(globalThis as unknown as Record<string,{prototype:Record<string,unknown>}>)[kind];
    if(!Constructor)continue;const original=Constructor.prototype[name];if(typeof original!=='function'||wrappedGlMethods.has(original))continue;
    const wrapped=function(this:unknown,...args:unknown[]){const start=performance.now();try{return original.apply(this,args);}finally{const stat=glStats[name]??={calls:0,ms:0};stat.calls++;stat.ms+=performance.now()-start;}};
    wrappedGlMethods.add(wrapped);Constructor.prototype[name]=wrapped;
  }
}
const snapshotGl=()=>Object.fromEntries(Object.entries(glStats).map(([key,value])=>[key,{...value}]));
let task:FaceLandmarker|undefined;
scope.onmessage=async ({data:m})=>{
  try {
    if(m.type==='init'){
      const files=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',true);
      const loader=await import(/* @vite-ignore */ files.wasmLoaderPath);scope.ModuleFactory=loader.default;scope.Module=undefined;
      task=await FaceLandmarker.createFromOptions(files,{canvas:new OffscreenCanvas(1,1),runningMode:'VIDEO',numFaces:1,minFaceDetectionConfidence:.6,minFacePresenceConfidence:.6,minTrackingConfidence:.6,outputFaceBlendshapes:false,outputFacialTransformationMatrixes:false,baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',delegate:m.delegate}});
      scope.postMessage({type:'ready'});
    } else if(m.type==='frame'){
      try{const input=m.bitmap??m.imageData;const beforeGl=snapshotGl();const start=performance.now();const result=task!.detectForVideo(input,m.timestamp);const inferenceMs=performance.now()-start;const webgl=Object.fromEntries(Object.entries(glStats).map(([key,value])=>[key,{calls:value.calls-(beforeGl[key]?.calls??0),ms:value.ms-(beforeGl[key]?.ms??0)}]));const webglCpuMs=Object.values(webgl).reduce((sum,value)=>sum+value.ms,0);const geometryValid=Boolean(faceFromLandmarks(result.faceLandmarks[0]??[],m.timestamp,{videoWidth:input.width,videoHeight:input.height,viewWidth:input.width,viewHeight:input.height,mirror:false}));scope.postMessage({type:'result',id:m.id,inferenceMs,landmarkCount:result.faceLandmarks[0]?.length??0,geometryValid,webgl,webglCpuMs,nonGlCallElapsedMs:Math.max(0,inferenceMs-webglCpuMs)});}
      finally{m.bitmap?.close();}
    } else if(m.type==='close'){task?.close();task=undefined;}
  } catch(error){scope.postMessage({type:'error',message:error instanceof Error?error.message:String(error)});}
};
