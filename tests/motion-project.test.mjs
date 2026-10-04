import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
async function bundle(file) {
  const result=await build({entryPoints:[file],bundle:true,write:false,format:'esm',platform:'node',target:'es2022'});
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const {MotionRecorder}=await bundle('src/engine/motion.ts');
const {createProjectSnapshot,parseProject,stringifyProject}=await bundle('src/engine/project.ts');
const {PRESETS}=await bundle('src/engine/types.ts');
const points=[{x:.2,y:.2},{x:.8,y:.3},{x:.7,y:.8},{x:.3,y:.7}];
const state=(quad,t=1000)=>({maskType:'crossHandQuad',quad:{points:quad,opacity:1,status:'tracking',timestamp:t},transform:{x:.5,y:.5,scale:.22,rotation:0},effects:PRESETS.cyber.effects,gestureState:'IDLE',handSpeed:0,trail:[],time:t});
test('quad motion: four corners are cloned, captured and interpolated in semantic order',()=>{
  const r=new MotionRecorder();r.start(1000);r.capture(state(points),1000);const moved=points.map(p=>({x:p.x+.1,y:p.y}));r.capture(state(moved,1100),1100);r.stop(1100);
  const middle=r.sampleAtTime(50);assert.equal(middle.maskType,'crossHandQuad');assert.ok(Math.abs(middle.quad.points[0].x-.25)<1e-12);
  const track=r.getTrack();track.keyframes[0].quad.points[0].x=9;assert.equal(r.getTrack().keyframes[0].quad.points[0].x,.2);
});
test('quad project: JSON roundtrip preserves mode and motion vertex identity without media bytes',()=>{
  const r=new MotionRecorder();r.start(1000);r.capture(state(points),1000);r.capture(state(points,1100),1100);r.stop(1100);
  const project=createProjectSnapshot({preset:'cyber',mask:{type:'crossHandQuad',transform:state(points).transform,trailReleaseMode:'hold'},effects:PRESETS.cyber.effects,carousel:{enabled:false,intervalMs:3000,transitionType:'crossFade',transitionDurationMs:650},motion:r.getTrack()});
  const parsed=parseProject(stringifyProject(project));assert.equal(parsed.mask.type,'crossHandQuad');assert.deepEqual(parsed.motion.keyframes[0].quad.points,points);assert.equal(parsed.motion.keyframes[0].quad.opacity,1);
});
test('quad project: invalid imported geometry is hidden instead of inventing a hull',()=>{
  const r=new MotionRecorder();r.start(1000);r.capture(state(points),1000);r.capture(state(points,1100),1100);r.stop(1100);
  const project=createProjectSnapshot({preset:'cyber',mask:{type:'crossHandQuad',transform:state(points).transform,trailReleaseMode:'hold'},effects:PRESETS.cyber.effects,carousel:{enabled:false,intervalMs:3000,transitionType:'crossFade',transitionDurationMs:650},motion:r.getTrack()});
  project.motion.keyframes[0].quad.points=[points[0],points[2],points[1],points[3]];const parsed=parseProject(stringifyProject(project));assert.equal(parsed.motion.keyframes[0].quad.opacity,0);
});
test('quad persistence: narrow live-valid 16:9 geometry stays visible in interpolation and JSON',()=>{
  const narrow=[{x:.5,y:.2},{x:.5035,y:.2},{x:.5035,y:.8},{x:.5,y:.8}];
  const r=new MotionRecorder();r.start(1000);r.capture(state(narrow),1000);r.capture(state(narrow,1100),1100);r.stop(1100);assert.equal(r.sampleAtTime(50).quad.opacity,1);
  const project=createProjectSnapshot({preset:'cyber',mask:{type:'crossHandQuad',transform:state(narrow).transform,trailReleaseMode:'hold'},effects:PRESETS.cyber.effects,carousel:{enabled:false,intervalMs:3000,transitionType:'crossFade',transitionDurationMs:650},motion:r.getTrack()});
  assert.deepEqual(parseProject(stringifyProject(project)).motion.keyframes[0].quad.points,narrow);
});
