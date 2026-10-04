import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const source=fs.readFileSync(new URL('../src/engine/crossHandQuad.ts',import.meta.url),'utf8');
const js=stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import[\s\S]*?;\n/gm,'').replace(/\bexport /g,'');
const {validQuad,quadFromHands,CrossHandQuadController,cloneQuad}=vm.runInThisContext(`(()=>{${js};return {validQuad,quadFromHands,CrossHandQuadController,cloneQuad};})()`);
const rectangle=[{x:.2,y:.2},{x:.8,y:.2},{x:.8,y:.8},{x:.2,y:.8}];
const frame=(points,time=1000)=>({timestamp:time,trackingFps:26,hands:[
  {id:7,handedness:'Left',handednessScore:.99,indexTip:points[0],thumbTip:points[3]},
  {id:9,handedness:'Right',handednessScore:.99,indexTip:points[1],thumbTip:points[2]},
]});
test('quad geometry: exact LI RI RT LT order, independent of detector array order',()=>{
  const input=frame(rectangle);input.hands.reverse();assert.deepEqual(quadFromHands(input),rectangle);
});
test('quad geometry: supports tilted trapezoid and valid concave quad',()=>{
  assert.equal(validQuad([{x:.2,y:.2},{x:.9,y:.4},{x:.7,y:.7},{x:.3,y:.8}],16/9),true);
  assert.equal(validQuad([{x:.2,y:.2},{x:.8,y:.2},{x:.4,y:.4},{x:.2,y:.8}]),true);
});
test('quad geometry: self-intersection, zero area, duplicates, NaN and tiny edges are rejected',()=>{
  for(const p of [[rectangle[0],rectangle[2],rectangle[1],rectangle[3]],Array(4).fill({x:.5,y:.5}),[{x:NaN,y:0},...rectangle.slice(1)],[rectangle[0],rectangle[0],...rectangle.slice(2)]])assert.equal(validQuad(p),false);
});
test('quad controller: a single corner can move without forcing a rectangle',()=>{
  const c=new CrossHandQuadController();c.update(frame(rectangle));const changed=rectangle.map(p=>({...p}));changed[1]={x:.9,y:.4};c.update(frame(changed,1040));
  assert.deepEqual(c.sample(1040).points,changed);assert.equal(c.sample(1040).status,'tracking');
});
test('quad controller: stale results expire even while renderer continues at high FPS',()=>{
  const c=new CrossHandQuadController();c.update(frame(rectangle));assert.equal(c.sample(1080).status,'holding');assert.equal(c.sample(1080).opacity,1);
  assert.equal(c.sample(1175).opacity,.5);assert.equal(c.sample(1251).opacity,0);assert.equal(c.sample(5000).opacity,0);
});
test('quad controller: missing/ambiguous hands do not fabricate corners',()=>{
  const c=new CrossHandQuadController(),input=frame(rectangle);input.hands.pop();c.update(input);assert.equal(c.sample(1000).points,undefined);
  const duplicate=frame(rectangle);duplicate.hands[1].handedness='Left';assert.equal(quadFromHands(duplicate),undefined);
});
test('quad controller: out-of-order results cannot rewind geometry',()=>{
  const c=new CrossHandQuadController();c.update(frame(rectangle,1100));c.update(frame(rectangle.map(p=>({x:p.x+.1,y:p.y})),1000));assert.deepEqual(c.sample(1100).points,rectangle);
});
test('quad controller: invalid crossing is flagged then fades, without convex hull substitution',()=>{
  const c=new CrossHandQuadController();c.update(frame(rectangle));c.update(frame([rectangle[0],rectangle[2],rectangle[1],rectangle[3]],1040));
  assert.equal(c.sample(1040).status,'invalid');assert.deepEqual(c.sample(1040).points,rectangle);assert.equal(c.sample(1300).opacity,0);
});
test('quad controller: caller cannot mutate stored geometry and reset drops prior camera state',()=>{
  const c=new CrossHandQuadController();c.update(frame(rectangle));const a=c.sample(1000);a.points[0].x=99;assert.equal(c.sample(1000).points[0].x,.2);
  const b=cloneQuad(c.sample(1000));b.points[1].x=55;assert.equal(c.sample(1000).points[1].x,.8);c.reset();assert.equal(c.sample(1040).points,undefined);
});
