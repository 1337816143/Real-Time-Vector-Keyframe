import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { createFaceTask, measureFaceWarmup } from './faceTask';
import { FACE_INPUT_WIDTH, FACE_WARMUP_BUDGET_MS } from './facePolicy';

const WASM='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL='https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const context=self as unknown as {postMessage:(value:unknown)=>void;onmessage:((event:MessageEvent)=>void)|null};
let task:FaceLandmarker|undefined;
let initializing:Promise<void>|undefined;
let delegate:'GPU'|'CPU'='GPU';
async function initialize(){
  const vision=await FilesetResolver.forVisionTasks(WASM,true);
  // Module workers cannot execute the classic UMD loader through importScripts.
  // Keep the ES-module factory because MediaPipe clears the global after use.
  const loader=await import(/* @vite-ignore */ vision.wasmLoaderPath);
  const bridge=self as unknown as {ModuleFactory:unknown;Module:unknown};
  const restoreFactory=()=>{bridge.ModuleFactory=loader.default;bridge.Module=undefined;};
  const options={runningMode:'VIDEO' as const,numFaces:1,minFaceDetectionConfidence:.6,minFacePresenceConfidence:.6,minTrackingConfidence:.6,outputFaceBlendshapes:false,outputFacialTransformationMatrixes:false};
  const warmup=new OffscreenCanvas(FACE_INPUT_WIDTH,240);
  const fill=warmup.getContext('2d');fill?.fillRect(0,0,warmup.width,warmup.height);
  let warmupMs=0;let warmupSamples:number[]=[];
  const created=await createFaceTask(async next=>{
    const candidate=await FaceLandmarker.createFromOptions(vision,{...options,canvas:new OffscreenCanvas(1,1),baseOptions:{modelAssetPath:MODEL,delegate:next}});
    try {
      // Compile kernels on a blank local frame before the main thread starts its frame deadline.
      const measured=measureFaceWarmup(timestamp=>{candidate.detectForVideo(warmup,timestamp);},()=>performance.now(),FACE_WARMUP_BUDGET_MS);
      warmupMs=measured.steadyMs;warmupSamples=measured.samples;
      return candidate;
    } catch(error){candidate.close();throw error;}
  },restoreFactory);
  task=created.task;delegate=created.delegate;
  context.postMessage({type:'ready',delegate,gpuFailure:created.gpuFailure,warmupMs,warmupSamples});
}
context.onmessage=(event)=>{
  const message=event.data;
  if(message.type==='init'){
    initializing??=initialize().catch(error=>context.postMessage({type:'error',message:String(error).includes('freshness budget')?'此设备人脸推理过慢，已停止面罩；四指尖窗口仍可使用':'人脸模型加载失败，请检查网络后重试',diagnostic:error instanceof Error?error.message:String(error)}));
  } else if(message.type==='frame'){
    const bitmap=message.bitmap as ImageBitmap;
    try {
      if(!task)throw new Error('Face task not ready');
      const start=performance.now();
      const result=task.detectForVideo(bitmap,message.timestamp);
      // Local Worker messaging only. Image pixels are never included in network requests.
      context.postMessage({type:'result',id:message.id,timestamp:message.timestamp,landmarks:result.faceLandmarks[0]??[],inferenceMs:performance.now()-start});
    } catch {context.postMessage({type:'error',message:'人脸追踪中断，请重试'});}
    finally {bitmap.close();}
  } else if(message.type==='close'){task?.close();task=undefined;}
};
