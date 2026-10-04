import type { Vec2 } from './types';

// Ordered MediaPipe face oval. Only geometry is retained; no camera image is stored here.
export const FACE_OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
export interface SpiderFaceFrame {
  outline: Vec2[];
  center: Vec2;
  axisX: Vec2;
  axisY: Vec2;
  halfSize: Vec2;
  eyes: [Vec2, Vec2];
  opacity: number;
  timestamp: number;
}
export function mapFacePoint(point: Vec2, videoWidth:number, videoHeight:number, viewWidth:number, viewHeight:number, mirror:boolean):Vec2 {
  const sourceAspect=videoWidth/Math.max(1,videoHeight),viewAspect=viewWidth/Math.max(1,viewHeight);
  let x=mirror?1-point.x:point.x,y=point.y;
  if(sourceAspect>viewAspect)x=(x-.5)/(viewAspect/sourceAspect)+.5;
  else y=(y-.5)/(sourceAspect/viewAspect)+.5;
  return {x,y};
}
function validFaceOutline(points:Vec2[], aspect:number):boolean {
  const p=points.map(v=>({x:v.x*aspect,y:v.y}));
  if(p.some(v=>!Number.isFinite(v.x)||!Number.isFinite(v.y)))return false;
  const twiceArea=p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a.x*b.y-b.x*a.y;},0);
  if(Math.abs(twiceArea)<.0002)return false;
  const orient=(a:Vec2,b:Vec2,c:Vec2)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  for(let i=0;i<p.length;i++){
    const a=p[i],b=p[(i+1)%p.length];
    if(Math.hypot(a.x-b.x,a.y-b.y)<1e-6)return false;
    for(let j=i+2;j<p.length;j++){
      if(i===0&&j===p.length-1)continue;
      const c=p[j],d=p[(j+1)%p.length];
      if(Math.max(a.x,b.x)<Math.min(c.x,d.x)||Math.max(c.x,d.x)<Math.min(a.x,b.x)||Math.max(a.y,b.y)<Math.min(c.y,d.y)||Math.max(c.y,d.y)<Math.min(a.y,b.y))continue;
      if(orient(a,b,c)*orient(a,b,d)<=0&&orient(c,d,a)*orient(c,d,b)<=0)return false;
    }
  }
  return true;
}
export function faceFromLandmarks(landmarks:Vec2[], timestamp:number, geometry:{videoWidth:number;videoHeight:number;viewWidth:number;viewHeight:number;mirror:boolean}):SpiderFaceFrame|undefined {
  if(landmarks.length<468||!Number.isFinite(timestamp)||![geometry.videoWidth,geometry.videoHeight,geometry.viewWidth,geometry.viewHeight].every(n=>Number.isFinite(n)&&n>0))return undefined;
  const selected=[...FACE_OVAL,33,133,362,263,152,10].map(i=>landmarks[i]);
  if(selected.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>4||Math.abs(p.y)>4))return undefined;
  const g=geometry, map=(p:Vec2)=>mapFacePoint(p,g.videoWidth,g.videoHeight,g.viewWidth,g.viewHeight,g.mirror);
  const pt=(i:number)=>map(landmarks[i]);
  const avg=(a:Vec2,b:Vec2)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const eyes:[Vec2,Vec2]=[avg(pt(33),pt(133)),avg(pt(362),pt(263))];
  const aspect=g.viewWidth/Math.max(1,g.viewHeight);
  const delta={x:(eyes[1].x-eyes[0].x)*aspect,y:eyes[1].y-eyes[0].y};
  const eyeDistance=Math.hypot(delta.x,delta.y);
  if(eyeDistance<.018)return undefined;
  const axisX={x:delta.x/eyeDistance,y:delta.y/eyeDistance};
  let axisY={x:-axisX.y,y:axisX.x};
  const top=pt(10),chin=pt(152),center=avg(top,chin);
  if((chin.x-top.x)*aspect*axisY.x+(chin.y-top.y)*axisY.y<0)axisY={x:-axisY.x,y:-axisY.y};
  const outline=FACE_OVAL.map(pt);
  if(!validFaceOutline(outline,aspect))return undefined;
  const projected=outline.map(p=>({x:((p.x-center.x)*aspect)*axisX.x+(p.y-center.y)*axisX.y,y:((p.x-center.x)*aspect)*axisY.x+(p.y-center.y)*axisY.y}));
  const halfSize={x:Math.max(...projected.map(p=>Math.abs(p.x))),y:Math.max(...projected.map(p=>Math.abs(p.y)))};
  if(![center.x,center.y,axisX.x,axisX.y,axisY.x,axisY.y,halfSize.x,halfSize.y].every(Number.isFinite))return undefined;
  if(halfSize.x<.025||halfSize.y<.035||halfSize.x>3||halfSize.y>3)return undefined;
  return {outline,center,axisX,axisY,halfSize,eyes,opacity:1,timestamp};
}
