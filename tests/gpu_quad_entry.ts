import { RecordingSession } from '../src/engine/recordingSession';
import { VfxRenderer } from '../src/engine/renderer';
import { installEdgeFxRuntime } from '../src/engine/edgeFxRuntime';
import { PRESETS, type RenderState } from '../src/engine/types';
import { validQuad, type QuadPoints } from '../src/engine/crossHandQuad';

installEdgeFxRuntime();
const exposed = window as unknown as { runQuadGpuTests: () => Promise<unknown> };
exposed.runQuadGpuTests = async () => {
  const source = document.createElement('canvas'); source.width=640;source.height=360;
  const ctx=source.getContext('2d')!;ctx.fillStyle='#cc0000';ctx.fillRect(0,0,640,360);
  const video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=source.captureStream(30);document.body.append(video);await video.play();
  const alt=document.createElement('canvas');alt.width=640;alt.height=360;alt.getContext('2d')!.fillStyle='#00dd00';alt.getContext('2d')!.fillRect(0,0,640,360);
  const canvas=document.createElement('canvas');canvas.style.width='640px';canvas.style.height='360px';document.body.append(canvas);
  const renderer=new VfxRenderer(canvas);renderer.setMirror(true);renderer.setRenderScale(1);
  const gl=canvas.getContext('webgl2')!;
  const effects={...PRESETS.multiverse.effects,useAlternateMedia:true,temporalMode:'none' as const,glow:0,edgeFxMode:'none' as const,invertMask:false,effectStack:PRESETS.multiverse.effects.effectStack.map(n=>({...n,enabled:false}))};
  const quads:QuadPoints[]=[
    [{x:.2,y:.2},{x:.8,y:.2},{x:.8,y:.8},{x:.2,y:.8}],
    [{x:.2,y:.2},{x:.9,y:.35},{x:.7,y:.8},{x:.3,y:.7}],
    [{x:.2,y:.2},{x:.8,y:.2},{x:.45,y:.42},{x:.2,y:.8}],
    [{x:.2,y:.2},{x:.8,y:.8},{x:.8,y:.2},{x:.2,y:.8}],
  ];
  const inside=(x:number,y:number,p:QuadPoints)=>{let hit=false;for(let i=0,j=3;i<4;j=i++){const a=p[i],b=p[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
  const distance=(x:number,y:number,p:QuadPoints)=>Math.min(...p.map((a,i)=>{const b=p[(i+1)%4];const ax=a.x*canvas.width,ay=a.y*canvas.height,bx=b.x*canvas.width,by=b.y*canvas.height;const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)));return Math.hypot(x-ax-t*dx,y-ay-t*dy);}));
  const reports=[];
  for (const [index,points] of quads.entries()) {
    const valid=validQuad(points,640/360);
    const state:RenderState={maskType:'crossHandQuad',transform:{x:.5,y:.5,scale:.22,rotation:0},effects,gestureState:'IDLE',handSpeed:0,trail:[],time:performance.now(),quad:{points,opacity:valid?1:0,status:valid?'tracking':'invalid',timestamp:performance.now()}};
    renderer.render(video,alt,state);
    const pixels=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let checked=0,mismatches=0;
    for(let y=8;y<canvas.height;y+=11)for(let x=8;x<canvas.width;x+=13){if(distance(x,y,points)<4)continue;const offset=((canvas.height-1-y)*canvas.width+x)*4;const expectedEffect=valid&&inside(x/canvas.width,y/canvas.height,points);const effect=pixels[offset+1]>150&&pixels[offset]<25;const raw=pixels[offset]>150&&pixels[offset+1]<25;if(expectedEffect?!effect:!raw)mismatches++;checked++;}
    reports.push({index,valid,checked,mismatches});if(mismatches)throw new Error(`quad ${index}: ${mismatches}/${checked} pixel mismatches`);
  }
  const quadState:RenderState={maskType:'crossHandQuad',transform:{x:.5,y:.5,scale:.22,rotation:0},effects:{...effects,glow:1,edgeFxMode:'neon'},gestureState:'IDLE',handSpeed:0,trail:[],time:performance.now(),quad:{points:quads[0],opacity:1,status:'tracking',timestamp:performance.now()}};
  const sample=(x:number,y:number)=>{const pixel=new Uint8Array(4);gl.readPixels(Math.floor(x*canvas.width),Math.floor((1-y)*canvas.height),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);return Array.from(pixel);};
  renderer.render(video,alt,quadState);
  const edgePixels=[[.5,.2],[.8,.5],[.5,.8],[.2,.5]].map(([x,y])=>sample(x,y));
  if(edgePixels.some(p=>p[2]<20))throw new Error(`Neon missing on quad edge: ${JSON.stringify(edgePixels)}`);
  quadState.quad!.opacity=0;renderer.render(video,alt,quadState);
  const fadedEdgePixels=[[.5,.2],[.8,.5],[.5,.8],[.2,.5]].map(([x,y])=>sample(x,y));
  if(fadedEdgePixels.some(p=>p[2]>5||p[1]>5))throw new Error('Expired quad left residual effect/edge pixels');
  // Explicit asymmetric synthetic media verifies the camera UV mirror, not only polygon math.
  const oldTime=video.currentTime;ctx.fillStyle='#0000dd';ctx.fillRect(320,0,320,360);
  await new Promise<void>(resolve=>{const wait=()=>video.currentTime>oldTime?resolve():requestAnimationFrame(wait);requestAnimationFrame(wait);});
  renderer.render(video,alt,quadState);const mirrorLeft=sample(.1,.5),mirrorRight=sample(.9,.5);
  if(!(mirrorLeft[2]>150&&mirrorLeft[0]<20&&mirrorRight[0]>150&&mirrorRight[2]<20))throw new Error('Synthetic camera mirror is wrong');
  quadState.quad!.opacity=1;quadState.effects={...effects};
  renderer.render(video,undefined,quadState);const fallbackInsideLeft=sample(.3,.5),fallbackInsideRight=sample(.7,.5);
  if(!(fallbackInsideLeft[2]>150&&fallbackInsideRight[0]>150))throw new Error('Default camera fallback inside quad is not mirrored');
  const freeze=document.createElement('canvas');freeze.width=640;freeze.height=360;freeze.getContext('2d')!.drawImage(source,0,0);
  quadState.alternateIsCamera=true;renderer.render(video,freeze,quadState);const freezeInsideLeft=sample(.3,.5),freezeInsideRight=sample(.7,.5);
  if(!(freezeInsideLeft[2]>150&&freezeInsideRight[0]>150))throw new Error('Camera-derived freeze inside quad is not mirrored');
  quadState.alternateIsCamera=false;renderer.render(video,freeze,quadState);const externalInsideLeft=sample(.3,.5),externalInsideRight=sample(.7,.5);
  if(!(externalInsideLeft[0]>150&&externalInsideRight[2]>150))throw new Error('External media orientation changed');
  // Record the same final canvas, then decode the resulting local blob through a video element.
  quadState.quad!.opacity=1;renderer.render(video,alt,quadState);
  const recordingSession=new RecordingSession();
  let recorded:MediaStream|undefined;
  const captureStream=canvas.captureStream.bind(canvas);
  canvas.captureStream=(rate?:number)=>{recorded=captureStream(rate);return recorded;};
  const captureStartPixel=sample(.5,.5);let renderedFrames=0;let captureEndPixel=captureStartPixel;
  const finished=new Promise<Blob>((resolve,reject)=>{if(!recordingSession.start(canvas,resolve,reject))reject(new Error('Product RecordingSession could not start'));});
  const started=performance.now();
  await new Promise<void>(resolve=>{const tick=(now:number)=>{
    // Real changing synthetic input, outside the quad, avoids static-frame dedup ambiguity.
    ctx.fillStyle='#222222';ctx.fillRect(0,0,640,24);ctx.fillStyle='#ffffff';ctx.fillRect((renderedFrames*17)%600,4,18,16);
    quadState.time=now;renderer.render(video,alt,quadState);renderedFrames++;
    if(now-started>=1200){captureEndPixel=sample(.5,.5);recordingSession.stop();resolve();}else requestAnimationFrame(tick);
  };requestAnimationFrame(tick);});
  const streamSettings=recorded?.getVideoTracks()[0]?.getSettings();
  const blob=await finished;if(!blob.size)throw new Error('Empty canvas recording');
  const playback=document.createElement('video');playback.muted=true;playback.src=URL.createObjectURL(blob);document.body.append(playback);
  const presented=new Promise<VideoFrameCallbackMetadata>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('No presented recording frame at mediaTime >= 0.4s within 10s')),10000);playback.addEventListener('ended',()=>{clearTimeout(timer);reject(new Error('Recording ended before a middle frame was presented'));},{once:true});const next=(_now:number,meta:VideoFrameCallbackMetadata)=>{if(meta.mediaTime>=.4){clearTimeout(timer);resolve(meta);}else playback.requestVideoFrameCallback(next);};playback.requestVideoFrameCallback(next);});
  await playback.play();const decodedFrame=await presented;
  const recording={bytes:blob.size,mime:blob.type,width:playback.videoWidth,height:playback.videoHeight,decodedTime:playback.currentTime};
  const playbackCanvas=document.createElement('canvas');playbackCanvas.width=playback.videoWidth;playbackCanvas.height=playback.videoHeight;const pc=playbackCanvas.getContext('2d')!;pc.drawImage(playback,0,0);const center=Array.from(pc.getImageData(Math.floor(playback.videoWidth*.5),Math.floor(playback.videoHeight*.5),1,1).data);
  if(!(center[1]>120&&center[0]<60))throw new Error(`Recording omitted the composited quad: ${JSON.stringify({recording,decodedFrame,center,captureStartPixel,captureEndPixel,renderedFrames,currentTime:video.currentTime,readyState:video.readyState,canvas:{width:canvas.width,height:canvas.height},streamSettings})}`);
  await new Promise<void>(resolve=>{if(playback.ended)resolve();else playback.addEventListener('ended',()=>resolve(),{once:true});});
  const fullyPlayed=playback.ended;playback.pause();URL.revokeObjectURL(playback.src);
  const error=gl.getError();if(error!==gl.NO_ERROR)throw new Error(`WebGL error ${error}`);
  renderer.dispose();(video.srcObject as MediaStream).getTracks().forEach(t=>t.stop());
  return {method:'Synthetic moving local MediaStream + actual WebGL2 shader pixels + product RecordingSession/default codec + local decode; no model or real camera',reports,edgePixels,fadedEdgePixels,mirrorLeft,mirrorRight,recording,decodedFrame,captureStartPixel,captureEndPixel,renderedFrames,recordedCenter:center,fullyPlayed,fallbackInsideLeft,fallbackInsideRight,freezeInsideLeft,freezeInsideRight,externalInsideLeft,externalInsideRight};
};
