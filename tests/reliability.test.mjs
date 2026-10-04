import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
const load = (file, name) => {
  const source = fs.readFileSync(new URL(`../src/engine/${file}.ts`, import.meta.url), 'utf8');
  const js = stripTypeScriptTypes(source, { mode: 'transform' }).replace(/^import[\s\S]*?;\n/gm, '').replace(/\bexport /g, '');
  return vm.runInThisContext(`(()=>{${js};return ${name};})()`);
};
const CameraSession = load('cameraSession', 'CameraSession');
const RecordingSession = load('recordingSession', 'RecordingSession');
const HandTracker = load('handTracking', 'HandTracker');
const GestureController = load('gesture', 'GestureController');
const stream = (id) => ({ id, tracks: [{readyState:'live', stop() { this.readyState = 'ended'; }}], getTracks() { return this.tracks; } });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
function camera() {
  const requests=[];
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:(constraints)=>{assert.equal(constraints.audio,false);const request=deferred();requests.push(request);return request.promise;}}}});
  const video={srcObject:null,play:async()=>{}};
  const statuses=[];
  return {session:new CameraSession(),video,requests,status:(...a)=>statuses.push(a),statuses};
}
test('synthetic camera: newest request wins and superseded tracks end',async()=>{
  const c=camera(),a=stream('old'),b=stream('new');
  const first=c.session.start(c.video,'user',c.status), second=c.session.start(c.video,'environment',c.status);
  c.requests[1].resolve(b);await second;c.requests[0].resolve(a);await first;
  assert.equal(c.video.srcObject,b);assert.equal(a.tracks[0].readyState,'ended');assert.equal(b.tracks[0].readyState,'live');
  c.session.dispose();assert.equal(b.tracks[0].readyState,'ended');assert.equal(c.video.srcObject,null);
});
test('synthetic camera: late permission success after exit is stopped and never attached',async()=>{
  const c=camera(),late=stream('late');const promise=c.session.start(c.video,'user',c.status);c.session.dispose();c.requests[0].resolve(late);await promise;
  assert.equal(late.tracks[0].readyState,'ended');assert.equal(c.video.srcObject,null);assert.deepEqual(c.statuses.map(s=>s[0]),['loading']);
});
test('synthetic camera: superseded rejection cannot overwrite current ready state',async()=>{
  const c=camera();const a=c.session.start(c.video,'user',c.status),b=c.session.start(c.video,'user',c.status);
  c.requests[1].resolve(stream('new'));await b;c.requests[0].reject(new Error('old failure'));await a;
  assert.equal(c.statuses.at(-1)[0],'ready');c.session.dispose();
});
test('synthetic camera: playback rejection releases allocated stream',async()=>{
  const c=camera(),s=stream('play failure');c.video.play=async()=>{throw new Error('play failed');};
  const p=c.session.start(c.video,'user',c.status);c.requests[0].resolve(s);await p;
  assert.equal(s.tracks[0].readyState,'ended');assert.equal(c.video.srcObject,null);assert.equal(c.statuses.at(-1)[0],'error');
});
test('synthetic camera: exit while play awaits suppresses ready callback',async()=>{
  const c=camera(),s=stream('play pending'),play=deferred();c.video.play=()=>play.promise;
  const p=c.session.start(c.video,'user',c.status);c.requests[0].resolve(s);await Promise.resolve();c.session.dispose();play.resolve();await p;
  assert.equal(s.tracks[0].readyState,'ended');assert.notEqual(c.statuses.at(-1)[0],'ready');
});
class FakeRecorder {
  static instances=[]; static isTypeSupported(type){return type==='video/webm';}
  constructor(stream,options){this.stream=stream;this.mimeType=options?.mimeType||'video/webm';this.state='inactive';FakeRecorder.instances.push(this);}
  start(){this.state='recording';}
  stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['synthetic-video'])});this.onstop?.();});}
}
function recording(){globalThis.MediaRecorder=FakeRecorder;const capture=stream('canvas');return {session:new RecordingSession(),capture,canvas:{captureStream:()=>capture}};}
test('synthetic recording: dispose stops recorder and capture stream without post-exit callback',async()=>{
  const r=recording();let callbacks=0;r.session.start(r.canvas,()=>callbacks++,()=>callbacks++);const rec=FakeRecorder.instances.at(-1);
  r.session.dispose();await Promise.resolve();assert.equal(rec.state,'inactive');assert.equal(r.capture.tracks[0].readyState,'ended');assert.equal(callbacks,0);
});
test('synthetic recording: normal stop emits blob and releases capture track',async()=>{
  const r=recording();let blob;r.session.start(r.canvas,b=>blob=b,assert.fail);r.session.stop();await Promise.resolve();
  assert.equal(blob.type,'video/webm');assert.ok(blob.size);assert.equal(r.capture.tracks[0].readyState,'ended');
});
test('synthetic recording: duplicate start cannot create another recorder',()=>{
  const r=recording();assert.equal(r.session.start(r.canvas,()=>{},assert.fail),true);assert.equal(r.session.start(r.canvas,()=>{},assert.fail),false);r.session.dispose();
});
test('synthetic recording: constructor failure stops capture track',()=>{
  const r=recording();globalThis.MediaRecorder=class {static isTypeSupported(){return false;}constructor(){throw new Error('codec');}};let error;
  assert.equal(r.session.start(r.canvas,assert.fail,e=>error=e),false);assert.equal(r.capture.tracks[0].readyState,'ended');assert.equal(error.message,'codec');
});
function landmarks(x,y=.5,gap=.06,vertical=false) {
  const p=Array.from({length:21},()=>({x,y,z:0}));p[0]={x,y:y+.05};p[5]={x:x-.05,y};p[9]={x,y:y-.02};p[17]={x:x+.05,y};
  p[4]={x:vertical?x:x-gap/2,y:vertical?y-gap/2:y};p[8]={x:vertical?x:x+gap/2,y:vertical?y+gap/2:y};return p;
}
const result = (points,labels=['Left','Right']) => ({landmarks:points,handednesses:points.map((_,i)=>[{categoryName:labels[i],score:.99}])});
test('synthetic tracking: swapping detector order preserves IDs, stationary velocity and no swipe',()=>{
  const t=new HandTracker();t.setDisplayGeometry(640,640,640,640);const a=t.toSnapshot(result([landmarks(.2),landmarks(.8)]),1000);
  const b=t.toSnapshot(result([landmarks(.8),landmarks(.2)],['Right','Left']),1040);assert.deepEqual(b.hands.map(h=>[h.id,h.palm]),a.hands.map(h=>[h.id,h.palm]));
  assert.equal(b.hands[0].speed,0);const g=new GestureController({x:.5,y:.5,scale:.22,rotation:0});g.update(a);assert.equal(g.update(b).swipe,0);
});
test('synthetic tracking: equal pixel gaps have equal pinch ratios in non-square input',()=>{
  const t=new HandTracker();t.setDisplayGeometry(1920,1080,1920,1080);
  const a=t.toSnapshot(result([landmarks(.5,.5,60/1920)]),1000),b=t.toSnapshot(result([landmarks(.5,.5,60/1080,true)]),1040);
  assert.ok(Math.abs(a.hands[0].normalizedPinchDistance-b.hands[0].normalizedPinchDistance)<1e-12);
  const g=new GestureController({x:.5,y:.5,scale:.22,rotation:0});g.update(a);assert.equal(g.update(b).released,false);
});
test('synthetic tracking: short dropout retains identity; long dropout resets it and velocity',()=>{
  const t=new HandTracker();t.setDisplayGeometry(640,640,640,640);const a=t.toSnapshot(result([landmarks(.3)]),1000).hands[0];
  t.toSnapshot(result([]),1040);const b=t.toSnapshot(result([landmarks(.31)]),1100).hands[0];assert.equal(a.id,b.id);
  t.toSnapshot(result([]),1500);const c=t.toSnapshot(result([landmarks(.32)]),1550).hands[0];assert.notEqual(a.id,c.id);assert.equal(c.speed,0);
});
test('synthetic tracking: viewport resize does not fabricate a swipe velocity',()=>{
  const t=new HandTracker();t.setDisplayGeometry(1920,1080,1920,1080);t.toSnapshot(result([landmarks(.3)]),1000);
  t.setDisplayGeometry(1920,1080,390,844);const b=t.toSnapshot(result([landmarks(.3)]),1040);assert.equal(b.hands[0].speed,0);
});
test('synthetic gesture: losing grabbed hand does not transfer control to other hand',()=>{
  const t=new HandTracker();t.setDisplayGeometry(640,640,640,640);const g=new GestureController({x:.3,y:.5,scale:.22,rotation:0});
  const a=t.toSnapshot(result([landmarks(.7,.5,.01),landmarks(.2,.5,.01)]),1000);g.update(a,true);
  const b=t.toSnapshot(result([landmarks(.2,.5,.01)],['Right']),1040);const update=g.update(b,true);assert.equal(update.state,'LOST');assert.equal(update.released,false);
});
test('synthetic tracking: crossing high-confidence left/right hands retain anatomical IDs',()=>{
  const t=new HandTracker();t.setDisplayGeometry(640,640,640,640);
  const a=t.toSnapshot(result([landmarks(.45),landmarks(.55)]),1000);
  const b=t.toSnapshot(result([landmarks(.57),landmarks(.43)]),1040);
  assert.equal(b.hands.find(h=>h.handedness==='Left').id,a.hands.find(h=>h.handedness==='Left').id);
  assert.equal(b.hands.find(h=>h.handedness==='Right').id,a.hands.find(h=>h.handedness==='Right').id);
  assert.equal(b.hands.find(h=>h.handedness==='Left').landmarks[0].x,.57);
});
test('synthetic gesture: continued tracking failure reaches release timeout',()=>{
  const t=new HandTracker();t.setDisplayGeometry(640,640,640,640);const g=new GestureController({x:.5,y:.5,scale:.22,rotation:0});
  g.update(t.toSnapshot(result([landmarks(.5,.5,.01)]),1000));
  for(let now=1040;now<1400;now+=40)assert.equal(g.update({hands:[],timestamp:now,trackingFps:0}).state,'LOST');
  const final=g.update({hands:[],timestamp:1440,trackingFps:0});assert.equal(final.state,'IDLE');assert.equal(final.released,true);
});
test('synthetic recording: normal stop before camera switch keeps final data',async()=>{
  const r=recording();let blob;r.session.start(r.canvas,b=>blob=b,assert.fail);
  r.session.stop();assert.equal(r.session.start(r.canvas,assert.fail,assert.fail),false);await Promise.resolve();assert.ok(blob.size);assert.equal(r.capture.tracks[0].readyState,'ended');
});
test('synthetic tracking: disappearance near other hand cannot inherit its anatomical ID',()=>{
  const t=new HandTracker();t.setDisplayGeometry(640,640,640,640);
  const a=t.toSnapshot(result([landmarks(.4),landmarks(.6)]),1000);
  const b=t.toSnapshot(result([landmarks(.41)],['Right']),1040);
  assert.equal(b.hands[0].id,a.hands.find(h=>h.handedness==='Right').id);assert.equal(b.hands[0].handedness,'Right');
});
test('synthetic tracking: source reset clears history and velocity',()=>{
  const t=new HandTracker();t.setDisplayGeometry(640,640,640,640);const a=t.toSnapshot(result([landmarks(.2)]),1000);t.reset();
  const b=t.toSnapshot(result([landmarks(.8)]),1040);assert.equal(b.hands[0].speed,0);assert.notEqual(b.hands[0].id,a.hands[0].id);
});
