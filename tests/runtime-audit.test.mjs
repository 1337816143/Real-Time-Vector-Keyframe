import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import ts from 'typescript';

// Exercise production code with deterministic media objects, not a copy of it.
const load = (file, name) => {
  const source = fs.readFileSync(`src/engine/${file}.ts`, 'utf8');
  const js = stripTypeScriptTypes(source, { mode: 'transform' }).replace(/^import[\s\S]*?;\n/gm, '').replace(/\bexport /g, '');
  return vm.runInThisContext(`(()=>{${js};return ${name};})()`);
};
const HandTracker = load('handTracking', 'HandTracker');
const GestureController = load('gesture', 'GestureController');
function detected(x) {
  const landmarks = Array.from({length:21}, () => ({x,y:.5,z:0}));
  landmarks[5].x=x-.05; landmarks[17].x=x+.05;
  landmarks[4].x=x-.04; landmarks[8].x=x+.04;
  return {landmarks:[landmarks],handednesses:[[{categoryName:'Left',score:.99}]]};
}
test('runtime audit: toggling mirror on a stationary open hand must not cause a preset swipe', () => {
  const tracker=new HandTracker(); tracker.setDisplayGeometry(640,640,640,640);
  const gesture=new GestureController({x:.5,y:.5,scale:.22,rotation:0});
  const before=tracker.toSnapshot(detected(.2),1000); gesture.update(before);
  tracker.setMirrored(false);
  const after=tracker.toSnapshot(detected(.2),1040);
  assert.equal(after.hands[0].id,before.hands[0].id);
  assert.equal(after.hands[0].palm.x,.2);
  assert.equal(after.hands[0].speed,0,'Mirroring is a coordinate change, not hand motion');
  assert.equal(gesture.update(after).swipe,0);
});
test('runtime audit: repeating the same mirror setting preserves real movement', () => {
  const tracker=new HandTracker(); tracker.setDisplayGeometry(640,640,640,640);
  tracker.toSnapshot(detected(.2),1000); tracker.setMirrored(true);
  assert.ok(tracker.toSnapshot(detected(.3),1040).hands[0].speed>0);
});

// Select the actual Studio handler by AST; dependencies are local synthetic media.
function alternateHarness() {
  const source=fs.readFileSync('src/components/Studio.tsx','utf8');
  const ast=ts.createSourceFile('Studio.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declarations=new Map();
  function visit(node) {
    if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer)
      declarations.set(node.name.text,node.initializer.getText(ast));
    ts.forEachChild(node,visit);
  }
  visit(ast);
  const created=[],revoked=[],sourceRef={current:undefined},mediaRef={current:undefined};
  const image={onload:null,src:'',removeAttribute(){this.src='';}};
  const video={src:'',pauses:0,loads:0,playCatch:0,removeAttribute(){this.src='';},pause(){this.pauses++;},load(){this.loads++;},play(){return {catch:()=>{this.playCatch++;}};}};
  const scope={altImageRef:{current:image},altVideoRef:{current:video},altSourceRef:sourceRef,altMediaRef:mediaRef,
    objectUrlsRef:{current:[]},setAltMediaName(){},setEffects(){},useCallback:fn=>fn,
    URL:{createObjectURL(file){const url=`blob:synthetic-${created.length}-${file.name}`;created.push(url);return url;},revokeObjectURL(url){revoked.push(url);}}};
  const code=['clearAltMedia','handleAltMedia'].filter(name=>declarations.has(name))
    .map(name=>`const ${name}=${declarations.get(name)};`).join('\n');
  const {select,clear}=vm.runInNewContext(stripTypeScriptTypes(code,{mode:'transform'})+
    ';({select:handleAltMedia,clear:typeof clearAltMedia === "function" ? clearAltMedia : undefined})',scope);
  return {select,clear,image,video,sourceRef,created,revoked,scope};
}
test('runtime audit: a late alternate image cannot replace the newer video selection', () => {
  const h=alternateHarness(); h.select({name:'old.png',type:'image/png'}); const oldLoad=h.image.onload;
  h.select({name:'new.webm',type:'video/webm'}); oldLoad();
  assert.equal(h.sourceRef.current,h.video,'Latest user selection must own the alternate source');
});
test('runtime audit: replacing alternate media releases obsolete object URLs and video playback', () => {
  const h=alternateHarness(); h.select({name:'first.webm',type:'video/webm'});
  const pauses=h.video.pauses,loads=h.video.loads;
  for(let i=0;i<20;i++)h.select({name:`image-${i}.png`,type:'image/png'});
  assert.equal(h.revoked.length,20,'Only the current alternate-media URL may remain live');
  assert.deepEqual(h.revoked,h.created.slice(0,-1));
  assert.ok(h.video.pauses>pauses,'Obsolete video decoder must be paused');
  assert.ok(h.video.loads>loads,'Obsolete video source must be released');
  assert.equal(h.video.src,'');
});
test('runtime audit: unsupported alternate media leaves the current selection intact', () => {
  const h=alternateHarness(); h.select({name:'first.webm',type:'video/webm'});
  h.select({name:'unsupported.txt',type:'text/plain'});
  assert.equal(h.created.length,1); assert.equal(h.revoked.length,0); assert.equal(h.sourceRef.current,h.video);
});
test('runtime audit: cleanup invalidates queued image loads and is idempotent', () => {
  const h=alternateHarness(); h.select({name:'first.png',type:'image/png'}); const oldLoad=h.image.onload;
  oldLoad(); assert.equal(h.sourceRef.current,h.image);
  h.clear(); oldLoad(); h.clear();
  assert.equal(h.sourceRef.current,undefined); assert.equal(h.image.onload,null);
  assert.equal(h.image.src,''); assert.deepEqual(h.revoked,h.created);
});
test('runtime audit: exit releases selected video even after React detaches the element refs', () => {
  const h=alternateHarness(); h.select({name:'first.webm',type:'video/webm'});
  h.scope.altVideoRef.current=null; h.scope.altImageRef.current=null;
  h.clear();
  assert.equal(h.sourceRef.current,undefined); assert.equal(h.video.pauses,1);
  assert.equal(h.video.loads,1); assert.equal(h.video.src,''); assert.deepEqual(h.revoked,h.created);
});
test('runtime audit: media replacement handles play rejection and current image still loads', () => {
  const h=alternateHarness(); h.select({name:'first.webm',type:'video/webm'});
  assert.equal(h.video.playCatch,1,'Releasing a selected video may reject its pending play promise');
  h.select({name:'current.png',type:'image/png'}); h.image.onload();
  assert.equal(h.sourceRef.current,h.image);
});
test('runtime audit: cancelled picker and missing media element cannot discard a usable selection', () => {
  const h=alternateHarness(); h.select({name:'first.webm',type:'video/webm'});
  h.select(); h.scope.altImageRef.current=null; h.select({name:'missing.png',type:'image/png'});
  assert.equal(h.created.length,1); assert.equal(h.revoked.length,0); assert.equal(h.sourceRef.current,h.video);
});

const CameraSession=load('cameraSession','CameraSession');
const RecordingSession=load('recordingSession','RecordingSession');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const stream=()=>({stops:0,getTracks(){return [{stop:()=>this.stops++}];}});
test('runtime audit: rejected old camera play cannot clear a newer camera or publish its failure',async t=>{
  const prior=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  t.after(()=>{if(prior)Object.defineProperty(globalThis,'navigator',prior);else delete globalThis.navigator;});
  const requests=[],plays=[],statuses=[],video={srcObject:null,play(){const d=deferred();plays.push(d);return d.promise;}};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia(){const d=deferred();requests.push(d);return d.promise;}}}});
  const session=new CameraSession();t.after(()=>session.dispose());
  const first=session.start(video,'user',s=>statuses.push(s)),a=stream();requests[0].resolve(a);await Promise.resolve();
  const second=session.start(video,'environment',s=>statuses.push(s)),b=stream();requests[1].resolve(b);await Promise.resolve();
  plays[1].resolve();await second;plays[0].reject(new Error('Aborted by replacement'));await first;
  assert.equal(video.srcObject,b);assert.equal(b.stops,0);assert.ok(a.stops>=1);
  assert.deepEqual(statuses,['loading','loading','ready']);
});
test('runtime audit: queued cancelled recording callbacks cannot finish or stop a new recording',t=>{
  const prior=globalThis.MediaRecorder,instances=[];t.after(()=>{if(prior)globalThis.MediaRecorder=prior;else delete globalThis.MediaRecorder;});
  globalThis.MediaRecorder=class {static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='video/webm';instances.push(this);}start(){this.state='recording';}stop(){this.state='inactive';}};
  const session=new RecordingSession();t.after(()=>session.dispose());const captures=[],completed=[],errors=[];
  const canvas={captureStream(){const s=stream();captures.push(s);return s;}};
  session.start(canvas,b=>completed.push(b),e=>errors.push(e));const oldStop=instances[0].onstop,oldData=instances[0].ondataavailable;
  session.dispose();session.start(canvas,b=>completed.push(b),e=>errors.push(e));
  oldData({data:new Blob(['cancelled'])});oldStop();
  assert.equal(completed.length,0);assert.equal(errors.length,0);assert.equal(session.isRecording(),true);assert.equal(captures[1].stops,0);
  instances[1].ondataavailable({data:new Blob(['new'])});session.stop();instances[1].onstop();
  assert.equal(completed.length,1);assert.equal(completed[0].size,3);assert.equal(captures[1].stops,1);
});
test('runtime audit: uncertain single-frame handedness reversal does not replace anatomical labels or IDs',()=>{
  const tracker=new HandTracker();tracker.setDisplayGeometry(640,640,640,640);
  const first=detected(.2);const before=tracker.toSnapshot(first,1000).hands[0];
  const flipped=detected(.2);flipped.handednesses[0][0]={categoryName:'Right',score:.4};
  const after=tracker.toSnapshot(flipped,1040).hands[0];
  assert.equal(after.id,before.id);assert.equal(after.handedness,'Left');assert.equal(after.speed,0);
});

function detectedHands(xs,labels=['Left','Right']) {
  return {landmarks:xs.map(x=>detected(x).landmarks[0]),handednesses:xs.map((_,i)=>[{categoryName:labels[i],score:.99}])};
}
for (const interruption of ['empty','other-hand']) test(`runtime audit: ${interruption} after mirror change cannot consume absent-hand velocity reset`,()=>{
  const tracker=new HandTracker();tracker.setDisplayGeometry(640,640,640,640);
  const gesture=new GestureController({x:.5,y:.5,scale:.22,rotation:0});
  const first=tracker.toSnapshot(detectedHands([.2,.8]),1000);gesture.update(first);
  tracker.setMirrored(false);
  gesture.update(tracker.toSnapshot(interruption==='empty'?detectedHands([]):detectedHands([.8],['Right']),1040));
  const returned=tracker.toSnapshot(detectedHands([.2],['Left']),1080);
  assert.deepEqual({id:returned.hands[0].id,speed:returned.hands[0].speed,swipe:gesture.update(returned).swipe},
    {id:first.hands[0].id,speed:0,swipe:0});
  assert.ok(tracker.toSnapshot(detectedHands([.22],['Left']),1120).hands[0].speed>0,'Real movement resumes after that hand rebases');
});
test('runtime audit: display geometry changes invalidate each absent hand independently',()=>{
  const tracker=new HandTracker();tracker.setDisplayGeometry(640,640,640,640);
  const first=tracker.toSnapshot(detectedHands([.2,.8]),1000);
  tracker.setDisplayGeometry(640,640,320,640);
  const right=tracker.toSnapshot(detectedHands([.8],['Right']),1040).hands[0];
  const left=tracker.toSnapshot(detectedHands([.2],['Left']),1080).hands[0];
  assert.equal(right.id,first.hands[1].id);assert.equal(right.speed,0);
  assert.equal(left.id,first.hands[0].id);assert.equal(left.speed,0);
});
test('runtime audit: repeated coordinate changes do not revive an absent hand baseline',()=>{
  const tracker=new HandTracker();tracker.setDisplayGeometry(640,640,640,640);
  const first=tracker.toSnapshot(detectedHands([.2,.8]),1000);
  tracker.setMirrored(false);tracker.toSnapshot(detectedHands([.8],['Right']),1020);
  tracker.setMirrored(true);tracker.toSnapshot(detectedHands([]),1040);
  tracker.setMirrored(false);tracker.toSnapshot(detectedHands([.8],['Right']),1060);
  const left=tracker.toSnapshot(detectedHands([.2],['Left']),1080).hands[0];
  assert.equal(left.id,first.hands[0].id);assert.equal(left.speed,0);
});
test('runtime audit: coordinate baseline bookkeeping is removed on pruning and source reset',()=>{
  const tracker=new HandTracker();tracker.setDisplayGeometry(640,640,640,640);
  tracker.toSnapshot(detectedHands([.2,.8]),1000);assert.equal(tracker.handCoordinateEpoch.size,2);
  tracker.toSnapshot(detectedHands([.8],['Right']),1200);
  tracker.toSnapshot(detectedHands([]),1360);assert.equal(tracker.handCoordinateEpoch.size,1);
  tracker.reset();assert.equal(tracker.handCoordinateEpoch.size,0);
});
