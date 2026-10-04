// Diagnostic-only raw SDK benchmark. Not imported by the product and never built into dist.
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { faceFromLandmarks } from '../src/engine/faceGeometry';
const scope=self as unknown as {onmessage:((e:MessageEvent)=>void)|null;postMessage:(data:unknown)=>void;ModuleFactory:unknown;Module:unknown};
let task:FaceLandmarker|undefined;
scope.onmessage=async ({data:m})=>{
  try {
    if(m.type==='init'){
      const files=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',true);
      const loader=await import(/* @vite-ignore */ files.wasmLoaderPath);scope.ModuleFactory=loader.default;scope.Module=undefined;
      task=await FaceLandmarker.createFromOptions(files,{canvas:new OffscreenCanvas(1,1),runningMode:'VIDEO',numFaces:1,minFaceDetectionConfidence:.6,minFacePresenceConfidence:.6,minTrackingConfidence:.6,outputFaceBlendshapes:false,outputFacialTransformationMatrixes:false,baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',delegate:m.delegate}});
      scope.postMessage({type:'ready'});
    } else if(m.type==='frame'){
      try{const start=performance.now();const result=task!.detectForVideo(m.bitmap,m.timestamp);const inferenceMs=performance.now()-start;const geometryValid=Boolean(faceFromLandmarks(result.faceLandmarks[0]??[],m.timestamp,{videoWidth:m.bitmap.width,videoHeight:m.bitmap.height,viewWidth:m.bitmap.width,viewHeight:m.bitmap.height,mirror:false}));scope.postMessage({type:'result',id:m.id,inferenceMs,landmarkCount:result.faceLandmarks[0]?.length??0,geometryValid});}
      finally{m.bitmap.close();}
    } else if(m.type==='close'){task?.close();task=undefined;}
  } catch(error){scope.postMessage({type:'error',message:error instanceof Error?error.message:String(error)});}
};
