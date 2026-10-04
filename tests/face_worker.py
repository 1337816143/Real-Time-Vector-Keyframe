"""Runs production FaceTracker/Worker on blank frames and a pinned official public portrait.
No webcam, authentication or user media. Portrait remains in memory and never enters dist/artifacts.
Audit browser network destinations/methods; fixture retrieval is a separate pinned GET.
"""
import functools,json,threading,time,urllib.parse,urllib.request,os,base64,hashlib
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
out=Path('test-results/face-worker');out.mkdir(parents=True,exist_ok=True)
workers=list(Path('dist/assets').glob('face.worker-*.js'))
assert len(workers)==1,'Expected exactly one production Face Worker asset'
handler=functools.partial(SimpleHTTPRequestHandler,directory=str(Path('dist').resolve()))
server=ThreadingHTTPServer(('127.0.0.1',0),handler);threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}'
requests=[];blocked=[]
with sync_playwright() as p:
    launch={'headless':True,'args':['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}
    if os.environ.get('CHROMIUM_PATH'):launch['executable_path']=os.environ['CHROMIUM_PATH']
    browser=p.chromium.launch(**launch);context=browser.new_context()
    def route_request(route):
        req=route.request;row={'url':req.url,'method':req.method,'postBytes':len(req.post_data or '')};requests.append(row)
        allowed=req.url.startswith(base+'/') or req.url.startswith('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/') or req.url=='https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
        if not allowed or req.method!='GET':blocked.append(row);route.abort()
        else:route.continue_()
    context.route('**/*',route_request);page=context.new_page();page.goto(base+'/')
    page.wait_for_timeout(300)
    assert not any('face_landmarker.task' in r['url'] for r in requests),'Face model loaded before opt-in'
    try:
        reports=[]
        for force_fallback in [False,True]:
          report=page.evaluate('''async ({workerPath,forceFallback}) => {
          let workerUrl=workerPath;
          if(forceFallback){
            const wrapper=`let savedFactory,forced=false;const queued=[];self.onmessage=e=>queued.push(e);
              Object.defineProperty(self,'ModuleFactory',{configurable:true,get(){if(!savedFactory)return undefined;if(forced)return savedFactory;return (...args)=>{forced=true;throw new Error('Synthetic GPU factory failure');};},set(v){savedFactory=v;}});
              await import(${JSON.stringify(workerPath)});for(const event of queued)self.onmessage(event);`;
            workerUrl=URL.createObjectURL(new Blob([wrapper],{type:'text/javascript'}));
          }
          const started=performance.now();const worker=new Worker(workerUrl,{type:'module'});
          const init=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Model initialization timeout')),60000);worker.onerror=e=>{clearTimeout(timer);reject(new Error(e.message));};worker.onmessage=e=>{if(e.data.type==='ready'){clearTimeout(timer);resolve(e.data);}else if(e.data.type==='error'){clearTimeout(timer);reject(new Error(e.data.diagnostic||e.data.message));}};worker.postMessage({type:'init'});});
          const initMs=performance.now()-started;
          const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const c=canvas.getContext('2d');c.fillStyle='#111111';c.fillRect(0,0,320,240);const bitmap=await createImageBitmap(canvas);
          const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Blank-frame inference timeout')),10000);worker.onmessage=e=>{if(e.data.type==='result'){clearTimeout(timer);resolve(e.data);}else if(e.data.type==='error'){clearTimeout(timer);reject(new Error(e.data.diagnostic||e.data.message));}};worker.postMessage({type:'frame',id:1,timestamp:performance.now(),bitmap},[bitmap]);});
          worker.postMessage({type:'close'});worker.terminate();if(forceFallback)URL.revokeObjectURL(workerUrl);
          return {delegate:init.delegate,gpuFailure:init.gpuFailure,warmupMs:init.warmupMs,warmupSamples:init.warmupSamples,initMs,inferenceMs:result.inferenceMs,landmarkCount:result.landmarks.length,frameId:result.id,bitmapTransferred:bitmap.width===0};
        }''',{'workerPath':base+'/assets/'+workers[0].name,'forceFallback':force_fallback})
          assert report['initMs']<30000,report
          assert report['landmarkCount']==0 and report['frameId']==1 and report['bitmapTransferred'],report
          assert report['inferenceMs']<250,report
          if force_fallback:assert report['delegate']=='CPU' and report['gpuFailure']=='Synthetic GPU factory failure',report
          report['forcedGpuFactoryFailure']=force_fallback;reports.append(report)
        page.add_script_tag(content=Path('test-results/face-pipeline-fixture.js').read_text())
        pipeline=page.evaluate('(options)=>window.runFacePipeline(options)',{'workerPath':base+'/assets/'+workers[0].name})
        assert pipeline['status']=='no-face' and pipeline['consecutiveFresh']>=3,pipeline
        # Official upstream test fixture, pinned by v0.10.35 external_files.bzl. Kept in memory only,
        # never in dist/test artifacts, and never a user's photograph or camera frame.
        portrait_url='https://storage.googleapis.com/mediapipe-assets/portrait.jpg?generation=1674261630039907'
        portrait=urllib.request.urlopen(portrait_url,timeout=30).read()
        portrait_sha=hashlib.sha256(portrait).hexdigest()
        assert portrait_sha=='a6f11efaa834706db23f275b6115058fa87fc7f14362681e6abe14e82749de3e'
        positive=page.evaluate('(options)=>window.runFacePipeline(options)',{'workerPath':base+'/assets/'+workers[0].name,'sourceDataUrl':'data:image/jpeg;base64,'+base64.b64encode(portrait).decode()})
        assert positive['status']=='tracking' and positive['consecutiveFresh']>=3,positive
        assert not blocked,blocked
        report={'positivePipeline':positive,'fixture':{'url':portrait_url,'sha256':portrait_sha,'persisted':False},'productPipeline':pipeline,'method':'Official Face Landmarker and actual tracker: blank frames plus pinned public portrait replay; user camera and real-device accuracy untested','runs':reports,'requests':requests,'unexpectedNetwork':blocked}
        (out/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
    except Exception as error:
        (out/'failure.json').write_text(json.dumps({'error':str(error),'requests':requests,'blocked':blocked},indent=2));raise
    finally:
        browser.close();server.shutdown()
