import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';

test('camera recovery: one visibility listener across repeated Studio lifecycles, only current video resumes',async t=>{
  const previous = new Map(['window','document','MediaStream','HTMLMediaElement','performance'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  t.after(()=>{for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  const listeners=[];
  let unrelatedVideo;let documentQueries=0;
  globalThis.window={location:{search:''}};
  globalThis.document={
    visibilityState:'visible',
    createElement:()=>({width:0,height:0,getContext:()=>null}),
    querySelector:selector=>{documentQueries++;return selector==='.studio-shell > video.source-media:first-of-type'?unrelatedVideo:null;},
    addEventListener:(event,callback)=>listeners.push({event,callback}),
  };
  globalThis.MediaStream=class {};
  globalThis.HTMLMediaElement={HAVE_METADATA:1,HAVE_CURRENT_DATA:2};
  const result=await build({stdin:{contents:"export {VfxRenderer} from './src/engine/renderer'; export {installCameraRecoveryRuntime} from './src/engine/cameraRecoveryRuntime';",resolveDir:process.cwd(),sourcefile:'recovery-lifecycle-test.ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2022'});
  const {VfxRenderer,installCameraRecoveryRuntime}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  VfxRenderer.prototype.render=()=>undefined;
  installCameraRecoveryRuntime();
  installCameraRecoveryRuntime();
  const makeVideo=()=>({srcObject:null,currentTime:0,videoWidth:0,videoHeight:0,readyState:0,paused:true,isConnected:true,classList:{toggle(){}},events:new Map(),playCalls:0,
    addEventListener(event,callback){this.events.set(event,callback);},play(){this.playCalls++;return Promise.resolve();}});
  const makeRenderer=()=>{
    const target={texture:{},framebuffer:{}};
    return {canvas:{dataset:{},getContext:()=>null},gl:{deleteTexture(){},deleteFramebuffer(){},deleteProgram(){},deleteVertexArray(){}},history:[],ping:target,pong:target,sceneA:target,sceneB:target,transitionSnapshot:target};
  };
  const departed=[];
  for(let i=0;i<10;i++){
    const video=makeVideo();
    const renderer=makeRenderer();
    VfxRenderer.prototype.render.call(renderer,video,undefined,{time:0});
    VfxRenderer.prototype.dispose.call(renderer);
    video.isConnected=false;departed.push(video);
  }
  assert.equal(listeners.filter(x=>x.event==='visibilitychange').length,1);
  const visible=()=>listeners.find(x=>x.event==='visibilitychange').callback();
  visible();assert.ok(departed.every(video=>video.playCalls===0));
  const video=makeVideo();const renderer=makeRenderer();
  VfxRenderer.prototype.render.call(renderer,video,undefined,{time:0});
  const sharedRenderer=makeRenderer();
  VfxRenderer.prototype.render.call(sharedRenderer,video,undefined,{time:0});
  video.srcObject={};video.readyState=2;
  unrelatedVideo=makeVideo();unrelatedVideo.srcObject={};unrelatedVideo.readyState=2;
  document.visibilityState='hidden';visible();assert.equal(video.playCalls,0);
  document.visibilityState='visible';visible();assert.equal(video.playCalls,1);
  assert.equal(unrelatedVideo.playCalls,0,'A different embedded video must not be resumed');
  VfxRenderer.prototype.dispose.call(renderer);visible();assert.equal(video.playCalls,2,'Remaining shared owner still resumes once');
  VfxRenderer.prototype.dispose.call(sharedRenderer);visible();assert.equal(video.playCalls,2,'Last disposed renderer must release its video even before DOM removal');
  // A late metadata event on an old detached video cannot restart playback either.
  const beforeStaleEvents=documentQueries;
  for(const old of departed){
    old.isConnected=true;old.srcObject={};old.readyState=2;
    for(const name of ['loadedmetadata','canplay','playing','pause'])old.events.get(name)();
  }
  assert.ok(departed.every(old=>old.playCalls===0));
  assert.equal(documentQueries,beforeStaleEvents,'Disposed video events must not touch a newer Studio recovery note');
  const pending=makeVideo();const pendingRenderer=makeRenderer();
  VfxRenderer.prototype.render.call(pendingRenderer,pending,undefined,{time:0});
  let rejectPlay;pending.play=()=>new Promise((resolve,reject)=>{rejectPlay=reject;});pending.srcObject={};pending.readyState=2;
  visible();assert.equal(typeof rejectPlay,'function');
  VfxRenderer.prototype.dispose.call(pendingRenderer);
  const beforeRejection=documentQueries;rejectPlay(new Error('Delayed old play rejection'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(documentQueries,beforeRejection,'Late play rejection must not show a note in a new Studio');
  const replaced=makeVideo();const replacedRenderer=makeRenderer();
  VfxRenderer.prototype.render.call(replacedRenderer,replaced,undefined,{time:0});
  let rejectReplaced;replaced.play=()=>new Promise((resolve,reject)=>{rejectReplaced=reject;});replaced.srcObject={};replaced.readyState=2;
  visible();replaced.srcObject={};const beforeReplacement=documentQueries;
  rejectReplaced(new Error('Old camera stream rejected'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(documentQueries,beforeReplacement,'Previous stream rejection cannot alter current stream recovery UI');
  VfxRenderer.prototype.dispose.call(replacedRenderer);

  // Tracking retry replaces the renderer without replacing the connected camera video.
  let now=100;Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>now}});
  const observed=makeVideo();const pendingFrames=[];
  observed.requestVideoFrameCallback=callback=>{pendingFrames.push(callback);return pendingFrames.length;};
  observed.srcObject=new MediaStream();observed.srcObject.getVideoTracks=()=>[{id:'synthetic-track'}];
  observed.readyState=2;observed.videoWidth=640;observed.videoHeight=480;observed.paused=false;
  const healthyRenderer=()=>{
    const owner=makeRenderer();Object.assign(owner.gl,{isContextLost:()=>false,readPixels(){}});
    Object.assign(owner.canvas,{width:64,height:64,getContext:()=>owner.gl});return owner;
  };
  const render=(owner)=>VfxRenderer.prototype.render.call(owner,observed,undefined,{time:now});
  const first=healthyRenderer();render(first);pendingFrames.shift()();
  now=500;observed.currentTime=.4;render(first);
  now=800;observed.currentTime=.7;render(first);assert.equal(first.canvas.dataset.vfxLive,'true');
  VfxRenderer.prototype.dispose.call(first);pendingFrames.shift()();
  const replacement=healthyRenderer();now=1100;observed.currentTime=1;render(replacement);
  assert.equal(pendingFrames.length,1,'Renderer replacement must not stop the existing video-owned observer');
  for(const time of [2100,3100]){
    now=time;observed.currentTime=time/1000;pendingFrames.shift()();render(replacement);
    assert.equal(replacement.canvas.dataset.vfxLive,'true','Advancing camera must stay live beyond the old 1800ms health window');
  }
  VfxRenderer.prototype.dispose.call(replacement);observed.isConnected=false;observed.srcObject=null;
  pendingFrames.shift()();assert.equal(pendingFrames.length,0);
});
