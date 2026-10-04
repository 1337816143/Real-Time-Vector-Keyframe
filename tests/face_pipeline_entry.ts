import { FaceTracker } from '../src/engine/faceTracking';
import { FACE_INIT_TIMEOUT_MS, FACE_MAX_AGE_MS } from '../src/engine/facePolicy';
(window as unknown as {runFacePipeline:(options:{workerPath:string;sourceDataUrl?:string})=>Promise<unknown>}).runFacePipeline=async ({workerPath:path,sourceDataUrl}:{workerPath:string;sourceDataUrl?:string})=>{
  const source=document.createElement('canvas');source.width=320;source.height=240;
  const ctx=source.getContext('2d')!;let portrait:HTMLImageElement|undefined;
  if(sourceDataUrl){portrait=new Image();portrait.src=sourceDataUrl;await portrait.decode();source.height=Math.round(320*portrait.height/portrait.width);}
  const draw=()=>{if(portrait)ctx.drawImage(portrait,0,0,source.width,source.height);else{ctx.fillStyle='#111';ctx.fillRect(0,0,source.width,source.height);}};draw();
  const stream=source.captureStream(30),video=document.createElement('video');video.muted=true;video.srcObject=stream;
  const results:Array<{inferenceMs:number;ageMs:number;landmarkCount:number}>=[];
  const backendTransitions:unknown[]=[];
  let ready:unknown;let freshAccepted=0;let consecutiveFresh=0;let seenResults=0;
  const tracker=new FaceTracker({makeWorker:()=>{
    const worker=new Worker(path,{type:'module'});
    worker.addEventListener('message',e=>{if(e.data.type==='ready'){ready=e.data;backendTransitions.push(e.data);}if(e.data.type==='result')results.push({inferenceMs:e.data.inferenceMs,ageMs:performance.now()-e.data.timestamp,landmarkCount:e.data.landmarks.length});});
    return worker;
  }});
  const started=performance.now();
  try {
    await video.play();tracker.setEnabled(true);
    await new Promise<void>((resolve,reject)=>{
      const tick=()=>{
        if(tracker.status==='error'||tracker.status==='unsupported'){reject(new Error(`Product FaceTracker: ${tracker.message}; ${JSON.stringify({ready,results})}`));return;}
        if(performance.now()-started>FACE_INIT_TIMEOUT_MS+20000){reject(new Error(`Product FaceTracker deadline; ${JSON.stringify({ready,results})}`));return;}
        draw();tracker.submit(video);
        if(results.length>seenResults){
          const last=results.at(-1)!;seenResults=results.length;
          const face=tracker.sample(performance.now(),source.width,source.height,false);
          const accepted=last.ageMs<FACE_MAX_AGE_MS&&(sourceDataUrl?last.landmarkCount>=468&&Boolean(face):last.landmarkCount===0&&!face);
          if(accepted){freshAccepted++;consecutiveFresh++;}else consecutiveFresh=0;
          if(last.ageMs>=FACE_MAX_AGE_MS&&face){reject(new Error('Stale pipeline result painted a face'));return;}
        }
        if(consecutiveFresh>=3){resolve();return;}requestAnimationFrame(tick);
      };requestAnimationFrame(tick);
    });
    return {method:sourceDataUrl?'Actual product FaceTracker + production Worker + pinned official public portrait replay; no user media':'Actual product FaceTracker + production Worker + synthetic blank MediaStream',freshAccepted,consecutiveFresh,backendTransitions,staleDiscarded:results.filter(r=>r.ageMs>=FACE_MAX_AGE_MS).length,ready,results,status:tracker.status,totalMs:performance.now()-started};
  } finally {tracker.dispose();stream.getTracks().forEach(t=>t.stop());video.srcObject=null;}
};
