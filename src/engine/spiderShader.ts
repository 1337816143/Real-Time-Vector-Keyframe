/** Original procedural mask: red fabric, curved web lines and landmark-aligned white lenses. */
export const SPIDER_UNIFORMS=`
uniform float uSpiderEnabled;
uniform float uFaceOpacity;
uniform vec2 uFaceOutline[36];
uniform vec2 uFaceCenter;
uniform vec2 uFaceAxisX;
uniform vec2 uFaceAxisY;
uniform vec2 uFaceHalfSize;
uniform vec2 uFaceEyes[2];
`;
export const SPIDER_SHADER=`
float faceSdf(vec2 uv) {
  float aspect=uViewport.x/max(1.0,uViewport.y);
  vec2 q=vec2(uv.x*aspect,1.0-uv.y);
  float best=100.0;bool inside=false;
  for(int i=0;i<36;i++){
    int j=(i+1)%36;
    vec2 a=vec2(uFaceOutline[i].x*aspect,uFaceOutline[i].y);
    vec2 b=vec2(uFaceOutline[j].x*aspect,uFaceOutline[j].y);
    best=min(best,segmentDistance(q,a,b));
    if((a.y>q.y)!=(b.y>q.y)){
      float crossingX=(b.x-a.x)*(q.y-a.y)/(b.y-a.y)+a.x;
      if(q.x<crossingX)inside=!inside;
    }
  }
  return inside?-best:best;
}
vec2 faceLocal(vec2 point){
  float aspect=uViewport.x/max(1.0,uViewport.y);
  vec2 delta=vec2((point.x-uFaceCenter.x)*aspect,point.y-uFaceCenter.y);
  return vec2(dot(delta,uFaceAxisX),dot(delta,uFaceAxisY))/max(uFaceHalfSize,vec2(.001));
}
vec3 spiderPaint(vec2 uv){
  vec2 q=faceLocal(vec2(uv.x,1.0-uv.y));
  vec2 webPoint=q-vec2(0.0,-.04);
  float radius=length(webPoint*vec2(1.0,.84));
  float theta=atan(webPoint.y,webPoint.x);
  float spoke=abs(sin(theta*7.0))*max(radius,.05);
  float rings=abs(sin((radius+.035*sin(theta*7.0))*20.0));
  float web=1.0-smoothstep(.018,.035,min(spoke,rings*.13));
  float fabric=.94+.045*sin(q.x*115.0)*sin(q.y*115.0);
  vec3 red=vec3(.72,.022,.055)*fabric*(1.0-.15*min(1.0,length(q)));
  vec3 color=mix(red,vec3(.025,.018,.026),web*.94);
  for(int i=0;i<2;i++){
    vec2 e=faceLocal(uFaceEyes[i]);
    vec2 d=q-e;
    float tilt=(e.x<0.0?-1.0:1.0)*.22;
    d.y+=d.x*tilt;
    // Almond-like lenses use the measured eye centers, with a black outer rim.
    vec2 lens=vec2(d.x/.30,d.y/.15);
    float shape=length(lens)+.10*abs(lens.x);
    float border=1.0-smoothstep(.98,1.07,shape);
    float white=1.0-smoothstep(.74,.84,shape);
    color=mix(color,vec3(.018,.019,.026),border);
    color=mix(color,vec3(.93,.97,1.0),white);
  }
  return color;
}
`;
