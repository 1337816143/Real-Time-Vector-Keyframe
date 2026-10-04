import { faceFromLandmarks, type SpiderFaceFrame } from './faceGeometry';
import type { Vec2 } from './types';
import { FACE_INIT_TIMEOUT_MS, FACE_INPUT_WIDTH, FACE_MAX_AGE_MS, FACE_COLD_FRAME_TIMEOUT_MS, FACE_FRAME_TIMEOUT_MS } from './facePolicy';

type WorkerLike=Pick<Worker,'postMessage'|'terminate'|'onmessage'|'onerror'>;
type Dependencies={makeWorker?:()=>WorkerLike;makeBitmap?:(video:HTMLVideoElement)=>Promise<ImageBitmap>;supported?:()=>boolean;clock?:()=>number};
export type FaceStatus='off'|'loading'|'ready'|'tracking'|'no-face'|'error'|'unsupported';
export class FaceTracker {
  private worker?:WorkerLike;
  private enabled=false;
  private epoch=0;
  private nextId=0;
  private pending?:{id:number;epoch:number;timestamp:number;width:number;height:number};
  private busy=false;
  private faceWarmed=false;
  private slowFaceStreak=0;
  private cpuFallbackUsed=false;
  private lastSubmitAt=-Infinity;
  private lastVideoTime=-1;
  private timeout?:ReturnType<typeof setTimeout>;
  private raw?:{landmarks:Vec2[];timestamp:number;width:number;height:number};
  status:FaceStatus='off';message='';inferenceMs?:number;delegate?:string;
  constructor(private dependencies:Dependencies={}){}
  private now(){return this.dependencies.clock?.()??performance.now();}
  private clearTimer(){if(this.timeout)clearTimeout(this.timeout);this.timeout=undefined;}
  private fail(message:string){this.epoch++;this.clearTimer();this.worker?.terminate();this.worker=undefined;this.busy=false;this.pending=undefined;this.raw=undefined;this.status='error';this.message=message;}
  setEnabled(enabled:boolean, preferCpu=false){
    if(enabled===this.enabled)return;
    this.epoch++;this.clearTimer();this.worker?.terminate();this.worker=undefined;this.enabled=enabled;this.cpuFallbackUsed=preferCpu;this.delegate=undefined;this.faceWarmed=false;this.slowFaceStreak=0;this.pending=undefined;this.busy=false;this.raw=undefined;this.lastSubmitAt=-Infinity;this.lastVideoTime=-1;this.inferenceMs=undefined;
    if(!enabled){this.status='off';this.message='';return;}
    const supported=this.dependencies.supported?.()??(typeof Worker!=='undefined'&&typeof createImageBitmap!=='undefined'&&typeof OffscreenCanvas!=='undefined');
    if(!supported){this.status='unsupported';this.message='此浏览器不支持后台人脸推理，四指尖窗口仍可使用';return;}
    this.status='loading';this.message='正在下载并初始化本地人脸模型…';const epoch=this.epoch;
    try {
      const worker=this.dependencies.makeWorker?.()??new Worker(new URL('./face.worker.ts',import.meta.url),{type:'module'});
      this.worker=worker;
      worker.onmessage=(event)=>{
        if(epoch!==this.epoch||!this.enabled)return;const result=event.data;
        if(result.type==='ready'){this.clearTimer();this.status='ready';this.message='请让单人脸进入四指尖窗口';this.delegate=result.delegate;}
        else if(result.type==='error')this.fail(result.message??'人脸追踪失败，请重试');
        else if(result.type==='result'&&this.pending&&this.pending.id===result.id){
          this.clearTimer();const pending=this.pending;this.pending=undefined;this.busy=false;
          if(result.timestamp!==pending.timestamp)return;
          const landmarks=Array.isArray(result.landmarks)?result.landmarks:[];
          const wasFaceWarmed=this.faceWarmed;
          if(landmarks.length>=468)this.faceWarmed=true;
          this.inferenceMs=result.inferenceMs;
          if(this.now()-pending.timestamp>FACE_MAX_AGE_MS){
            if(wasFaceWarmed&&landmarks.length>=468&&++this.slowFaceStreak>=3){
              if(this.delegate==='GPU'&&!this.cpuFallbackUsed){this.setEnabled(false);this.setEnabled(true,true);if(this.status==='loading')this.message='GPU 人脸推理持续过慢，正在切换 CPU…';}
              else this.fail('此设备人脸推理持续过慢，已停止面罩；四指尖窗口仍可使用');
              return;
            }
            this.status='ready';this.message='人脸推理延迟，过期画面已丢弃';return;
          }
          this.slowFaceStreak=0;
          if(landmarks.length)this.raw={landmarks,timestamp:pending.timestamp,width:pending.width,height:pending.height};
          this.status=landmarks.length?'tracking':'no-face';this.message=landmarks.length?'后台单人脸追踪':'未检测到人脸，请面向摄像头';
        }
      };
      worker.onerror=()=>{if(epoch===this.epoch)this.fail('后台人脸追踪不可用，请重试');};
      this.timeout=setTimeout(()=>{if(epoch===this.epoch)this.fail('人脸模型加载超时，请重试');},FACE_INIT_TIMEOUT_MS);
      worker.postMessage(preferCpu?{type:'init',delegate:'CPU'}:{type:'init'});
    } catch {this.fail('无法启动后台人脸追踪');}
  }
  submit(video:HTMLVideoElement){
    const now=this.now();
    if(!this.enabled||!this.worker||this.busy||!['ready','tracking','no-face'].includes(this.status)||video.readyState<2||now-this.lastSubmitAt<1000/12||video.currentTime===this.lastVideoTime)return;
    this.lastSubmitAt=now;this.lastVideoTime=video.currentTime;this.busy=true;const epoch=this.epoch,id=++this.nextId;
    const width=video.videoWidth,height=video.videoHeight;this.pending={id,epoch,timestamp:now,width,height};
    this.timeout=setTimeout(()=>{if(epoch===this.epoch&&this.pending?.id===id)this.fail('人脸推理超时，请重试');},this.faceWarmed?FACE_FRAME_TIMEOUT_MS:FACE_COLD_FRAME_TIMEOUT_MS);
    let bitmap:Promise<ImageBitmap>;
    try {bitmap=this.dependencies.makeBitmap?.(video)??createImageBitmap(video,{resizeWidth:Math.min(FACE_INPUT_WIDTH,width),resizeHeight:Math.max(1,Math.round(height*Math.min(FACE_INPUT_WIDTH,width)/Math.max(1,width)))});}
    catch {this.fail('无法读取本地人脸帧，请重试');return;}
    bitmap.then(image=>{
      if(epoch!==this.epoch||!this.enabled||!this.worker||this.pending?.id!==id){image.close();return;}
      try{this.worker.postMessage({type:'frame',id,timestamp:now,bitmap:image},[image]);}
      catch{image.close();this.fail('无法传递本地人脸帧，请重试');}
    }).catch(()=>{if(epoch===this.epoch)this.fail('无法读取本地人脸帧，请重试');});
  }
  sample(now:number,viewWidth:number,viewHeight:number,mirror=true):SpiderFaceFrame|undefined{
    const raw=this.raw;if(!this.enabled||!raw)return undefined;const age=Math.max(0,now-raw.timestamp);if(age>=FACE_MAX_AGE_MS){this.status='no-face';this.message='人脸追踪已过期，请面向摄像头';return undefined;}
    const frame=faceFromLandmarks(raw.landmarks,raw.timestamp,{videoWidth:raw.width,videoHeight:raw.height,viewWidth,viewHeight,mirror});
    if(frame)frame.opacity=age<=100?1:Math.max(0,1-(age-100)/150);return frame;
  }
  reset(){const active=this.enabled;this.setEnabled(false);if(active)this.setEnabled(true);}
  dispose(){this.setEnabled(false);}
}
