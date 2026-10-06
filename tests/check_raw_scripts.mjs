// Pure fake DOM/Worker execution; never launches a browser or network.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));let cases=0;
function scene(condition){
 const selectors=['.hero-portal','.portal-noise','.orbit-one','.orbit-two'];const names=['morph','scan','spin','spin'];const events=[];
 let targets=selectors.map((selector,i)=>({selector,isConnected:true,getAnimations(){return [animations[i]];}}));
 let animations=names.map((animationName,i)=>({animationName,effect:{target:targets[i]},currentTime:700,playState:'running',pause(){events.push(['pause',i]);this.playState='paused';},play(){events.push(['play',i]);this.playState='running';}}));
 const document={querySelector(selector){return targets.find(t=>t.selector===selector)||null;},getAnimations(){return animations;}};const window={};const context=vm.createContext({document,window});
 const start=vm.runInContext('('+input.host+')',context)(condition);
 assert.equal(start.length,4);assert.equal(events.filter(x=>x[0]==='pause').length,4);assert.equal(events.filter(x=>x[0]==='play').length,condition==='playing'?4:0);
 assert.ok(start.every(x=>x.currentTime===300));if(condition==='playing')animations.forEach(a=>a.currentTime=500);
 return {end:()=>vm.runInContext('('+input.end+')',context)(),replaceTargets(){targets.forEach(t=>t.isConnected=false);targets=targets.map(t=>({...t,isConnected:true}));},replaceAnimations(){animations=animations.map(a=>({...a}));},invalidTime(){animations[0].currentTime=NaN;}};
}
for(const condition of ['playing','paused']){const s=scene(condition);assert.equal(s.end().length,4);cases++;}
for(const change of ['replaceTargets','replaceAnimations','invalidTime']){const s=scene('playing');s[change]();assert.throws(()=>s.end());cases++;}
for(const [mode,forceFallback] of [['pass',false],['pass',true],['slow-constructor',false],['warmup-error',false],['warmup-error',true],['frame-error',true],['constructor-error',false]]){
 let worker,clock=0,canvas,bitmap,blobText='',revoked=0;const timeoutSizes=[];
 class Blob{constructor(parts){blobText=parts.join('');}}
 const URL={createObjectURL(){return 'blob:synthetic-wrapper';},revokeObjectURL(){revoked++;}};
 class Worker{
  constructor(url,options){assert.equal(options.type,'module');assert.equal(url,forceFallback?'blob:synthetic-wrapper':'http://approved/assets/worker.js');worker=this;this.messages=[];if(mode==='slow-constructor')clock+=150;if(mode==='constructor-error')throw new Error('synthetic constructor error');}
  postMessage(message,transfer){this.messages.push(message.type);
   if(message.type==='init'){
    assert.deepEqual(Object.keys(message).sort(),forceFallback?['delegate','type']:['type']);if(forceFallback)assert.equal(message.delegate,'GPU');
    Promise.resolve().then(()=>{clock+=mode==='slow-constructor'?29900:4000;this.onmessage({data:mode==='warmup-error'?{type:'error',diagnostic:'warm-up exceeds freshness budget (245, 135, 211, 200 ms)'}:{type:'ready',delegate:'CPU',gpuFailure:forceFallback?'Synthetic GPU factory failure':null,warmupMs:180,warmupSamples:[220,180,100]}});});
   }else if(message.type==='frame'){
    assert.equal(message.id,1);assert.equal(transfer[0],bitmap);assert.equal(bitmap.width,320);assert.equal(bitmap.height,240);bitmap.width=0;
    Promise.resolve().then(()=>this.onmessage({data:mode==='frame-error'?{type:'error',diagnostic:'synthetic frame error'}:{type:'result',id:1,inferenceMs:100,landmarks:[]}}));
   }
  }
  terminate(){this.terminated=true;}
 }
 const document={createElement(name){
  assert.equal(name,'canvas');
  canvas={width:0,height:0,getContext(kind){
   assert.equal(kind,'2d');
   return {set fillStyle(value){assert.equal(value,'#111111');},fillRect(x,y,w,h){assert.deepEqual([x,y,w,h],[0,0,320,240]);}};
  }};
  return canvas;
 }};
 const fn=vm.runInNewContext('('+input.raw+')',{Worker,Blob,URL,document,createImageBitmap:async value=>{assert.equal(value,canvas);return bitmap={width:value.width,height:value.height};},performance:{now(){return clock;}},setTimeout(callback,ms){timeoutSizes.push(ms);return timeoutSizes.length;},clearTimeout(){}});
 if(['warmup-error','frame-error','constructor-error'].includes(mode)){
  await assert.rejects(()=>fn({workerPath:'http://approved/assets/worker.js',forceFallback}));
  // Original payload intentionally leaves failing workers for the caller's
  // browser finally cleanup; the Python harness verifies that outer cleanup.
  if(mode==='warmup-error')assert.equal(worker.messages.join(','),'init');
 }else{
  const result=await fn({workerPath:'http://approved/assets/worker.js',forceFallback});assert.deepEqual(timeoutSizes,[60000,10000]);assert.equal(result.bitmapTransferred,true);assert.equal(result.landmarkCount,0);assert.equal(result.frameId,1);assert.ok(worker.terminated);assert.equal(worker.messages.join(','),'init,frame,close');
  if(mode==='slow-constructor')assert.equal(result.initMs,30050);
  if(forceFallback){assert.equal(revoked,1);assert.ok(blobText.includes("throw new Error('Synthetic GPU factory failure')"));assert.ok(blobText.includes('await import('));assert.equal(result.delegate,'CPU');assert.equal(result.gpuFailure,'Synthetic GPU factory failure');}
 }
 cases++;
}
console.log('PASS: '+cases+' fake host identity / exact original raw-payload scenarios');
