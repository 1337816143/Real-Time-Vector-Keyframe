import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
async function bundle(file){const result=await build({entryPoints:[file],bundle:true,write:false,format:'esm',platform:'node',target:'es2022'});return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);}
const {FaceTracker}=await bundle('src/engine/faceTracking.ts');
const {faceFromLandmarks,mapFacePoint,FACE_OVAL}=await bundle('src/engine/faceGeometry.ts');
function landmarks(){const p=Array.from({length:478},()=>({x:.5,y:.5}));FACE_OVAL.forEach((id,i)=>{const a=-Math.PI/2+i*Math.PI*2/36;p[id]={x:.5+Math.cos(a)*.2,y:.5+Math.sin(a)*.3};});for(const id of [33,133])p[id]={x:.42,y:.43};for(const id of [362,263])p[id]={x:.58,y:.43};return p;}
const geometry={videoWidth:640,videoHeight:360,viewWidth:640,viewHeight:360,mirror:true};
function harness(t,extra={}){let time=1000;const workers=[];const bitmaps=[];const tracker=new FaceTracker({clock:()=>time,supported:()=>true,makeWorker:()=>{const w={messages:[],terminated:false,postMessage(message){this.messages.push(message);},terminate(){this.terminated=true;},emit(data){this.onmessage?.({data});}};workers.push(w);return w;},makeBitmap:async()=>{const b={closed:false,close(){this.closed=true;}};bitmaps.push(b);return b;},...extra});t.after(()=>tracker.dispose());return{tracker,workers,bitmaps,now:n=>time=n,video:{readyState:2,currentTime:1,videoWidth:640,videoHeight:360}};}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('face geometry: oval, eyes and mirror use the same cover mapping',()=>{const f=faceFromLandmarks(landmarks(),1000,geometry);assert.equal(f.outline.length,36);assert.ok(Math.abs(f.eyes[0].x-.58)<1e-9);assert.ok(Math.abs(f.eyes[1].x-.42)<1e-9);assert.ok(f.halfSize.x>0&&f.halfSize.y>0);assert.ok(f.axisY.y>0);const p=mapFacePoint({x:.3,y:.4},1920,1080,390,844,true);assert.ok(p.x>1);assert.equal(p.y,.4);});
test('face geometry: missing, nonfinite and collapsed faces cannot paint',()=>{assert.equal(faceFromLandmarks([],0,geometry),undefined);const bad=landmarks();bad[10].x=NaN;assert.equal(faceFromLandmarks(bad,0,geometry),undefined);assert.equal(faceFromLandmarks(Array.from({length:478},()=>({x:.5,y:.5})),0,geometry),undefined);});
test('face pipeline: zero workers or frame work until explicitly enabled',async t=>{const h=harness(t);h.tracker.submit(h.video);await settle();assert.equal(h.workers.length,0);assert.equal(h.bitmaps.length,0);h.tracker.setEnabled(true);assert.equal(h.workers.length,1);assert.deepEqual(h.workers[0].messages,[{type:'init'}]);});
test('face pipeline: one frame in flight, 12fps cap and duplicate camera-frame rejection',async t=>{const h=harness(t);h.tracker.setEnabled(true);const w=h.workers[0];w.emit({type:'ready',delegate:'CPU'});h.tracker.submit(h.video);h.now(1100);h.video.currentTime=2;h.tracker.submit(h.video);await settle();assert.equal(w.messages.filter(x=>x.type==='frame').length,1);const frame=w.messages.at(-1);w.emit({type:'result',id:frame.id,timestamp:frame.timestamp,landmarks:landmarks(),inferenceMs:25});h.now(1101);h.tracker.submit(h.video);await settle();assert.equal(w.messages.filter(x=>x.type==='frame').length,2);const next=w.messages.at(-1);w.emit({type:'result',id:next.id,timestamp:next.timestamp,landmarks:landmarks(),inferenceMs:20});h.now(1200);h.tracker.submit(h.video);assert.equal(w.messages.filter(x=>x.type==='frame').length,2);});
test('face pipeline: late bitmap after disable is closed, never posted',async t=>{let resolve;const h=harness(t,{makeBitmap:()=>new Promise(r=>resolve=r)});h.tracker.setEnabled(true);const w=h.workers[0];w.emit({type:'ready'});h.tracker.submit(h.video);h.tracker.setEnabled(false);const b={closed:false,close(){this.closed=true;}};resolve(b);await settle();assert.equal(b.closed,true);assert.equal(w.messages.filter(x=>x.type==='frame').length,0);assert.equal(w.terminated,true);assert.equal(h.tracker.status,'off');});
test('face pipeline: old worker results cannot resurrect cleared face after disable/retry',async t=>{const h=harness(t);h.tracker.setEnabled(true);const old=h.workers[0];old.emit({type:'ready'});h.tracker.submit(h.video);await settle();const frame=old.messages.at(-1);h.tracker.setEnabled(false);h.tracker.setEnabled(true);old.emit({type:'result',id:frame.id,timestamp:frame.timestamp,landmarks:landmarks(),inferenceMs:1});assert.equal(h.tracker.sample(1040,640,360),undefined);assert.equal(h.tracker.status,'loading');});
test('face pipeline: stale result is discarded and tracking loss does not refresh old geometry',async t=>{const h=harness(t);h.tracker.setEnabled(true);const w=h.workers[0];w.emit({type:'ready'});h.tracker.submit(h.video);await settle();let frame=w.messages.at(-1);h.now(1040);w.emit({type:'result',id:frame.id,timestamp:frame.timestamp,landmarks:landmarks(),inferenceMs:40});assert.equal(h.tracker.sample(1040,640,360).opacity,1);h.now(1100);h.video.currentTime=2;h.tracker.submit(h.video);await settle();frame=w.messages.at(-1);h.now(1110);w.emit({type:'result',id:frame.id,timestamp:frame.timestamp,landmarks:[],inferenceMs:10});assert.equal(h.tracker.sample(1175,640,360).opacity,.5);assert.equal(h.tracker.sample(1251,640,360),undefined);});
test('face pipeline: results taking over 250ms never paint a stale face',async t=>{const h=harness(t);h.tracker.setEnabled(true);const w=h.workers[0];w.emit({type:'ready'});h.tracker.submit(h.video);await settle();const f=w.messages.at(-1);h.now(1400);w.emit({type:'result',id:f.id,timestamp:f.timestamp,landmarks:landmarks(),inferenceMs:400});assert.equal(h.tracker.sample(1400,640,360),undefined);});
test('face pipeline: synchronous bitmap error is contained and requires explicit retry',t=>{const h=harness(t,{makeBitmap:()=>{throw new Error('copy');}});h.tracker.setEnabled(true);h.workers[0].emit({type:'ready'});assert.doesNotThrow(()=>h.tracker.submit(h.video));assert.equal(h.tracker.status,'error');h.tracker.setEnabled(true);assert.equal(h.workers.length,1);h.tracker.reset();assert.equal(h.workers.length,2);});
test('face pipeline: unsupported browser keeps feature off without model fetch',t=>{const h=harness(t,{supported:()=>false});h.tracker.setEnabled(true);assert.equal(h.tracker.status,'unsupported');assert.equal(h.workers.length,0);});

const {nextCyclePreset,CYCLE_PRESETS}=await bundle('src/engine/presetSelection.ts');
test('face opt-in: carousel and swipe never select Spider or force advanced mode into quad',()=>{
  assert.equal(nextCyclePreset('multiverse',1),'cyber');
  for (const preset of [...CYCLE_PRESETS,'spider']) for (const direction of [-1,1]) assert.notEqual(nextCyclePreset(preset,direction),'spider');
});

test('face geometry: invalid dimensions and non-simple outlines fail closed',()=>{
  for(const key of ['videoWidth','videoHeight','viewWidth','viewHeight'])for(const value of [0,-1,NaN,Infinity])assert.equal(faceFromLandmarks(landmarks(),1000,{...geometry,[key]:value}),undefined,`${key}=${value}`);
  const flat=landmarks();FACE_OVAL.forEach((id,i)=>flat[id]={x:.2+(i%2)*.6,y:.2+(i%2)*.6});
  assert.equal(faceFromLandmarks(flat,1000,geometry),undefined);
  const crossed=landmarks();[crossed[FACE_OVAL[4]],crossed[FACE_OVAL[22]]]=[crossed[FACE_OVAL[22]],crossed[FACE_OVAL[4]]];
  assert.equal(faceFromLandmarks(crossed,1000,geometry),undefined);
});

const {createFaceTask,measureFaceWarmup,preferredFaceDelegate}=await bundle('src/engine/faceTask.ts');
test('face worker: cached module factory is restored before GPU-to-CPU fallback',async()=>{
  let factory;const calls=[];const token={};
  const result=await createFaceTask(async delegate=>{calls.push(delegate);assert.equal(factory,token);factory=undefined;if(delegate==='GPU')throw new Error('Synthetic GPU initialization failure');return {ready:true};},()=>{factory=token;});
  assert.deepEqual(calls,['GPU','CPU']);assert.equal(result.delegate,'CPU');assert.equal(result.gpuFailure,'Synthetic GPU initialization failure');assert.equal(result.task.ready,true);
});

test('face pipeline: first positive face may warm slowly but never paints stale; subsequent deadline stays bounded',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness(t);h.tracker.setEnabled(true);const w=h.workers[0];w.emit({type:'ready'});h.tracker.submit(h.video);await settle();
  t.mock.timers.tick(3500);assert.notEqual(h.tracker.status,'error');
  const frame=w.messages.at(-1);h.now(4500);w.emit({type:'result',id:frame.id,timestamp:frame.timestamp,landmarks:landmarks(),inferenceMs:3500});
  assert.equal(h.tracker.sample(4500,640,360),undefined);
  h.now(4501);h.video.currentTime=2;h.tracker.submit(h.video);await settle();t.mock.timers.tick(3001);assert.equal(h.tracker.status,'error');
});

test('face pipeline: persistently stale warmed faces stop clearly instead of silently discarding forever',async t=>{
  const h=harness(t);h.tracker.setEnabled(true);const w=h.workers[0];w.emit({type:'ready'});
  for(let i=0;i<4;i++){
    h.now(1000+i*500);h.video.currentTime=i+1;h.tracker.submit(h.video);await settle();
    const f=w.messages.at(-1);h.now(1000+i*500+(i===0?30:300));
    w.emit({type:'result',id:f.id,timestamp:f.timestamp,landmarks:landmarks(),inferenceMs:i===0?30:300});
  }
  assert.equal(h.tracker.status,'error');assert.match(h.tracker.message,/持续过慢/);assert.equal(w.terminated,true);assert.equal(h.tracker.sample(3000,640,360),undefined);
});

function warmupProbe(durations){let time=0;const timestamps=[];const result=measureFaceWarmup(timestamp=>{timestamps.push(timestamp);time+=durations[timestamp];},()=>time,200);return {result,timestamps};}
test('face warm-up: cold compilation is excluded and two consecutive warm samples are required',()=>{
  const {result,timestamps}=warmupProbe([7000,150,120]);assert.deepEqual(timestamps,[0,1,2]);assert.deepEqual(result.samples,[150,120]);assert.equal(result.steadyMs,150);
});
test('face warm-up: a transient second-frame delay can stabilize within the same strict budget',()=>{
  const {result}=warmupProbe([700,221,80,75]);assert.deepEqual(result.samples,[221,80,75]);assert.equal(result.steadyMs,80);
});
test('face warm-up: an intervening slow sample resets the consecutive streak',()=>{
  const {result}=warmupProbe([700,80,221,90,85]);assert.deepEqual(result.samples,[80,221,90,85]);assert.equal(result.steadyMs,90);
});
test('face warm-up: sustained slowness is bounded at four measured attempts and preserves diagnostics',()=>{
  const calls=[];let time=0;assert.throws(()=>measureFaceWarmup(timestamp=>{calls.push(timestamp);time+=300;},()=>time,200),/300, 300, 300, 300/);assert.deepEqual(calls,[0,1,2,3,4]);
});

test('face backend: software renderers select CPU, hardware/unknown retain GPU, explicit test selection wins',()=>{
  for(const renderer of ['ANGLE (Google, Vulkan SwiftShader Device)','llvmpipe (LLVM)','softpipe','Software Rasterizer'])assert.equal(preferredFaceDelegate(renderer),'CPU');
  for(const renderer of [undefined,'Apple M1','ANGLE (NVIDIA)'])assert.equal(preferredFaceDelegate(renderer),'GPU');
  assert.equal(preferredFaceDelegate('SwiftShader','GPU'),'GPU');assert.equal(preferredFaceDelegate(undefined,'CPU'),'CPU');
});
test('face backend: explicit CPU initialization does not attempt GPU',async()=>{const seen=[];const result=await createFaceTask(async d=>{seen.push(d);return {};},()=>{},'CPU');assert.deepEqual(seen,['CPU']);assert.equal(result.delegate,'CPU');});
test('face pipeline: stale GPU positives restart once on CPU with no old face resurrection',async t=>{
  const h=harness(t);h.tracker.setEnabled(true);const gpu=h.workers[0];gpu.emit({type:'ready',delegate:'GPU'});
  async function frame(worker,index,delay){h.now(1000+index*500);h.video.currentTime=index+1;h.tracker.submit(h.video);await settle();const f=worker.messages.at(-1);h.now(1000+index*500+delay);worker.emit({type:'result',id:f.id,timestamp:f.timestamp,landmarks:landmarks(),inferenceMs:delay});return f;}
  let last;for(let i=0;i<4;i++)last=await frame(gpu,i,i===0?30:300);
  assert.equal(h.workers.length,2);assert.equal(gpu.terminated,true);assert.equal(h.tracker.status,'loading');const cpu=h.workers[1];assert.deepEqual(cpu.messages,[{type:'init',delegate:'CPU'}]);
  gpu.emit({type:'result',id:last.id,timestamp:2800,landmarks:landmarks()});assert.equal(h.tracker.sample(2800,640,360),undefined);
  cpu.emit({type:'ready',delegate:'CPU'});for(let i=4;i<8;i++)await frame(cpu,i,i===4?30:300);
  assert.equal(h.tracker.status,'error');assert.equal(h.workers.length,2);assert.equal(cpu.terminated,true);
});
