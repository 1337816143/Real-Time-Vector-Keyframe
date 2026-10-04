"""Failure-only diagnostics, NOT a release gate or production Worker pass.
Measures the raw pinned SDK without startup-budget policy, on blank frames and official portrait.
"""
import base64,functools,hashlib,json,threading,urllib.request
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
out=Path('test-results/face-benchmark');out.mkdir(parents=True,exist_ok=True)
portrait_url='https://storage.googleapis.com/mediapipe-assets/portrait.jpg?generation=1674261630039907'
portrait=urllib.request.urlopen(portrait_url,timeout=30).read()
assert hashlib.sha256(portrait).hexdigest()=='a6f11efaa834706db23f275b6115058fa87fc7f14362681e6abe14e82749de3e'
uri='data:image/jpeg;base64,'+base64.b64encode(portrait).decode()
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(SimpleHTTPRequestHandler,directory=str(Path('.').resolve())))
threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
requests=[];blocked=[]
report={'method':'Failure-only raw SDK diagnostic; production startup gate bypassed in this separate test Worker; not release validation','runs':[]}
with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  try:
    context=browser.new_context()
    def route_request(route):
      req=route.request;row={'url':req.url,'method':req.method,'postBytes':len(req.post_data or '')};requests.append(row)
      allowed=req.url.startswith(base+'/') or req.url.startswith('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/') or req.url=='https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
      if not allowed or req.method!='GET':blocked.append(row);route.abort()
      else:route.continue_()
    context.route('**/*',route_request);page=context.new_page();page.goto(base+'/dist/')
    for delegate in ['CPU','GPU']:
      try:
        value=page.evaluate('''async ({delegate,portrait,base})=>{
          const worker=new Worker(base+'/test-results/face-benchmark-worker.js',{type:'module'});
          const request=m=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Diagnostic frame timeout')),20000);worker.onmessage=e=>{clearTimeout(timer);e.data.type==='error'?reject(new Error(e.data.message)):resolve(e.data);};worker.postMessage(m,m.bitmap?[m.bitmap]:[]);});
          const started=performance.now();const rows=[];let phase='initialization';
          try {
            await request({type:'init',delegate});const initMs=performance.now()-started;
            const image=new Image();image.src=portrait;await image.decode();
            const canvas=document.createElement('canvas');canvas.width=320;canvas.height=Math.round(320*image.height/image.width);const ctx=canvas.getContext('2d');
            for(const [mode,count] of [['blank',5],['portrait',7],['loss',3],['reacquisition',7]])for(let index=0;index<count;index++){
              phase=mode;if(mode==='blank'||mode==='loss'){ctx.fillStyle='#111';ctx.fillRect(0,0,canvas.width,canvas.height);}else ctx.drawImage(image,0,0,canvas.width,canvas.height);
              const sentAt=performance.now();const bitmap=await createImageBitmap(canvas);const row=await request({type:'frame',id:rows.length+1,timestamp:sentAt,bitmap});rows.push({...row,mode,index,ageMs:performance.now()-sentAt,width:canvas.width,height:canvas.height});
            }
            return {delegate,initMs,rows};
          } catch(error){return {delegate,error:String(error),phase,rows};}
          finally{worker.terminate();}
        }''',{'delegate':delegate,'portrait':uri,'base':base})
        for phase in ['blank','portrait','loss','reacquisition']:
          rows=[r for r in value.get('rows',[]) if r['mode']==phase];streak=0;longest=0
          for row in rows:
            valid=(row['landmarkCount']>=468 and row['geometryValid']) if phase in ['portrait','reacquisition'] else row['landmarkCount']==0 and not row['geometryValid']
            streak=streak+1 if valid and row['ageMs']<250 else 0;longest=max(longest,streak)
          value.setdefault('phaseSummaries',{})[phase]={'samples':len(rows),'inferenceUnder200':sum(r['inferenceMs']<=200 for r in rows),'roundtripUnder250':sum(r['ageMs']<250 for r in rows),'longestFreshValidStreak':longest,'staleSamples':sum(r['ageMs']>=250 for r in rows)}
        report['runs'].append(value);print(json.dumps(value),flush=True)
      except Exception as e:report['runs'].append({'delegate':delegate,'error':str(e)})
      report.update({'requests':requests,'unexpectedNetwork':blocked,'fixture':{'url':portrait_url,'sha256':hashlib.sha256(portrait).hexdigest(),'persisted':False}})
      (out/'report.json').write_text(json.dumps(report,indent=2))
  finally:browser.close();server.shutdown()
