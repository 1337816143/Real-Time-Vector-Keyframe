"""Fixed A-B-B-A startup diagnostic; never replaces original face acceptance.

Runs the original default-to-forced-fallback raw sub-sequence four times, in fresh browsers; this is not the preceding full-CI workload. The only
condition change is playing versus pausing the same CSS animations at a common
300 ms phase. Never retries a trial or alters the production Worker or budgets.
"""
import hashlib
import ast
import importlib.util
import json
import math
import importlib.metadata
import platform
from urllib.parse import urlsplit, unquote
import os
from pathlib import Path
import re
import time

BROWSER_ARGS = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
TRIALS = (('AB-1', 'playing'), ('AB-2', 'paused'), ('BA-1', 'paused'), ('BA-2', 'playing'))
REMOTE_URLS = (
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/vision_wasm_module_internal.js',
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/vision_wasm_module_internal.wasm',
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
)

# Both conditions normalize the same phase. Pausing never removes animations,
# transforms, clipping, shadows, layers, DOM nodes or original stylesheets.
APPROVED_MANIFEST_SHA256 = 'b646404443cbca0793abde0fbf71e39e0f867b7fc27f796d8a1e660df82f517c'
MANIFEST_PATH = 'scripts/animation_contention_inputs.json'
HOST_TARGETS = (('.hero-portal','morph'),('.portal-noise','scan'),('.orbit-one','spin'),('.orbit-two','spin'))
HOST_SETUP = r'''condition => {
  const expected=[['.hero-portal','morph'],['.portal-noise','scan'],['.orbit-one','spin'],['.orbit-two','spin']];
  const rows=expected.map(([selector,name],index)=>{
    const target=document.querySelector(selector);
    if(!target||!target.isConnected) throw new Error('Expected connected landing target missing');
    const matches=target.getAnimations().filter(a=>a.effect?.target===target&&a.animationName===name);
    if(matches.length!==1) throw new Error('Expected unique CSS animation missing');
    return {selector,name,target,animation:matches[0],token:'animation-'+index};
  });
  const all=document.getAnimations();
  if(document.querySelector('.studio-shell')||all.length!==4||!all.every(a=>rows.some(r=>r.animation===a))) throw new Error('Unexpected landing animation set');
  for(const r of rows){r.animation.pause();r.animation.currentTime=300;}
  if(condition==='playing') for(const r of rows) r.animation.play();
  else if(condition!=='paused') throw new Error('Unknown diagnostic condition');
  window.__animationContentionRefs=rows;
  return rows.map(r=>({selector:r.selector,name:r.name,token:r.token,sameObject:true,sameTarget:true,currentTime:r.animation.currentTime,playState:r.animation.playState}));
}'''
HOST_END = r'''() => {
  const rows=window.__animationContentionRefs;
  if(!rows||rows.length!==4) throw new Error('Missing animation identity references');
  const all=document.getAnimations();
  if(all.length!==4||!all.every(a=>rows.some(r=>r.animation===a))) throw new Error('Animation objects changed');
  return rows.map(r=>{
    const sameTarget=r.target.isConnected&&document.querySelector(r.selector)===r.target&&r.animation.effect?.target===r.target;
    const sameObject=all.includes(r.animation)&&r.target.getAnimations().includes(r.animation)&&r.animation.animationName===r.name;
    if(!sameTarget||!sameObject||!Number.isFinite(r.animation.currentTime)) throw new Error('Animation identity or time changed');
    return {selector:r.selector,name:r.name,token:r.token,sameObject,sameTarget,currentTime:r.animation.currentTime,playState:r.animation.playState};
  });
}'''
RAW_SOURCE_GIT_BLOB='09b90f4592d302493cacd4162dcc04862c89516a'
RAW_LOOP_SOURCE_SHA256='24f7f8e945b7a38877d96d4273c68449b1c6b910b2a72acff52e8758d1d37d35'
RAW_PAYLOAD_SHA256='882d71c4d03921f7a1ccfb3e2188e0157cc13160f1614be5c2bc44910a01d7db'
REPORTER_SHA256='3ba17ee1ad5514c6ec56dd5e44c2016ee4dd98d18eaa574030d23a6766f64e85'
RAW_PHASES=('raw-default','raw-forced-fallback')


def load_raw_protocol(path):
    body=path.read_bytes()
    if hashlib.sha1(('blob '+str(len(body))+'\0').encode()+body).hexdigest()!=RAW_SOURCE_GIT_BLOB:
        raise ValueError('Unapproved original face test')
    source=body.decode();tree=ast.parse(source)
    loops=[n for n in ast.walk(tree) if isinstance(n,ast.For) and isinstance(n.target,ast.Name) and n.target.id=='force_fallback']
    if len(loops)!=1: raise ValueError('Ambiguous original raw sequence')
    loop=loops[0]
    if ast.literal_eval(loop.iter)!=[False,True]: raise ValueError('Unexpected original raw order')
    segment=ast.get_source_segment(source,loop)
    if hashlib.sha256(segment.encode()).hexdigest()!=RAW_LOOP_SOURCE_SHA256:
        raise ValueError('Original raw loop drift')
    payloads=[n.args[0].value for n in ast.walk(loop) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute)
              and n.func.attr=='evaluate' and n.args and isinstance(n.args[0],ast.Constant) and isinstance(n.args[0].value,str)]
    if len(payloads)!=1 or hashlib.sha256(payloads[0].encode()).hexdigest()!=RAW_PAYLOAD_SHA256:
        raise ValueError('Original JavaScript payload drift')
    module=ast.Module(body=[loop],type_ignores=[])
    return {'code':compile(module,'approved-tests/face_worker.py:raw-loop','exec',optimize=0),
            'identity':{'sourceGitBlob':RAW_SOURCE_GIT_BLOB,'loopSourceSha256':RAW_LOOP_SOURCE_SHA256,'payloadSha256':RAW_PAYLOAD_SHA256}}


def load_reporter():
    path=Path(__file__).with_name('face_failure_reporting.py')
    if hashlib.sha256(path.read_bytes()).hexdigest()!=REPORTER_SHA256: raise ValueError('Unapproved reporting helper')
    spec=importlib.util.spec_from_file_location('approved_face_failure_reporting',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def run_raw_sequence(protocol,reporter,page,base,worker,out):
    # The original for-loop is compiled unchanged, not a rewritten sequence.
    # It owns phase -> evaluate -> annotate/append -> progress write -> assertions.
    namespace={'page':page,'base':base,'workers':[Path(worker)],'out':out,
               'reports':[],'phase':'not_started','json':json}
    completed=False;error=None
    try:
        out.mkdir(parents=True,exist_ok=True)
        exec(protocol['code'],namespace)
        completed=True
    except Exception as exc:
        error=exc
    phase=namespace['phase'];reports=namespace['reports']
    result={'rawLoopCompleted':completed,'fullOriginalAcceptanceExecuted':False,
            'scope':'default-to-forced-fallback raw sub-sequence only; preceding CI workload and later pipelines omitted',
            'rawProgressArtifact':str(out/'progress.json'),'rawSubsequencePassed':False}
    if completed:
        try:json.dumps(reports,allow_nan=False);serializable=True
        except (TypeError,ValueError,OverflowError):serializable=False
        usable=serializable and len(reports)==2 and reporter.raw_report_passes(reports[0],False) and reporter.raw_report_passes(reports[1],True)
        result.update(rawObservationValid=usable,rawSubsequencePassed=usable,
                      stageStatus={p:'passed' if usable else 'unknown' for p in RAW_PHASES},
                      stageReports={p:reports[i] if usable else None for i,p in enumerate(RAW_PHASES)},
                      rawFailure=None)
    else:
        record={'error':str(error),'phase':phase,'observedRuns':reports,'productPipeline':None,'positivePipeline':None}
        # Match the original failure/progress representation. A malformed original
        # record remains in its raw artifact, while the strict summary is unknown.
        try:(out/'failure.json').write_text(json.dumps(record,indent=2))
        except Exception:result['rawFailureArtifactUnavailable']=True
        classified=reporter.summarize(record)
        usable=classified['classification']=='consistent_failure_record'
        observed=classified.get('observedRuns',[]) if usable else []
        result.update(rawObservationValid=usable,stageStatus={p:classified['stageStatus'][p] for p in RAW_PHASES},
                      stageReports={p:observed[i] if len(observed)>i else None for i,p in enumerate(RAW_PHASES)},
                      rawFailure=classified)
    return result


def host_condition_observed(row):
    state='running' if row.get('condition')=='playing' else 'paused'
    for phase in ('hostStart','hostEnd'):
        observations=row.get(phase,[])
        if len(observations)!=4: return False
        for i,(item,(selector,name)) in enumerate(zip(observations,HOST_TARGETS)):
            current=item.get('currentTime')
            if (item.get('selector')!=selector or item.get('name')!=name or item.get('token')!='animation-'+str(i)
                    or item.get('sameObject') is not True or item.get('sameTarget') is not True
                    or item.get('playState')!=state or not isinstance(current,(int,float)) or not math.isfinite(current)):
                return False
            if phase=='hostStart' and abs(current-300)>1: return False
            if state=='paused' and abs(current-300)>.01: return False
            if state=='running' and phase=='hostEnd' and current<=300: return False
    return True


def identity_consistent(rows,expected_identity=None,expected_browser=None):
    if len(rows)!=4 or expected_identity is None or expected_browser is None: return False
    expected=rows[0].get('runtimeHashes')
    if not isinstance(expected,dict) or set(expected)!=set(REMOTE_URLS): return False
    if not all(re.fullmatch('[0-9a-f]{64}',str(v)) for v in expected.values()): return False
    return all(row.get('label')==label and row.get('condition')==condition
               and row.get('inputIdentityBefore')==expected_identity and row.get('inputIdentityAfter')==expected_identity
               and row.get('runtimeHashes')==expected and row.get('browserVersion')==expected_browser
               and row.get('networkValid') is True and row.get('rawObservationValid') is True and not row.get('trialError')
               and not row.get('blockedRequests') and not row.get('teardownFailed') and not row.get('cleanupError')
               and host_condition_observed(row) for row,(label,condition) in zip(rows,TRIALS))


def contrasts(rows,controls_valid):
    result={}
    for phase in RAW_PHASES:
        value={'eligible':False,'pairs':[],'reason':'incomplete-controls-prerequisites-or-precise-samples'}
        if controls_valid:
            prerequisites=phase=='raw-default' or all(r.get('stageStatus',{}).get('raw-default')=='passed' for r in rows)
            reports=[r.get('stageReports',{}).get(phase) for r in rows]
            samples=[r.get('warmupSamples') if isinstance(r,dict) else None for r in reports]
            available=len(rows)==4 and all(isinstance(s,list) and len(s)>=2 and all(isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x) for x in s[:2]) for s in samples)
            if prerequisites and available:
                means=[sum(s[:2])/2 for s in samples]
                value.update(eligible=True,reason=None,pairs=[{'order':'AB','playingMinusPausedMs':means[0]-means[1]},
                                                             {'order':'BA','playingMinusPausedMs':means[3]-means[2]}],
                             precision='original numeric report samples only; error-message integers excluded',
                             scope='warmup observations, not a full-phase or original-CI pass')
        result[phase]=value
    return result


def read_approved_manifest(root):
    body=(root/MANIFEST_PATH).read_bytes()
    if hashlib.sha256(body).hexdigest()!=APPROVED_MANIFEST_SHA256: raise ValueError('Unapproved input manifest')
    return json.loads(body)


def runtime_versions():
    return {'python':platform.python_version(),'playwright':importlib.metadata.version('playwright')}


def verify_inputs(root,manifest):
    root=root.resolve();observed={'source':{},'dist':{}}
    def require_confined_regular_path(path):
        if not path.resolve().is_relative_to(root): raise ValueError('Escaping input path')
        for candidate in (path,*path.parents):
            if candidate==root: break
            if candidate.is_symlink(): raise ValueError('Symlink in input path')
    require_confined_regular_path(root/'dist')
    for name,expected in manifest['sourceGitBlobs'].items():
        path=root/name
        require_confined_regular_path(path)
        body=path.read_bytes();digest=hashlib.sha1(('blob '+str(len(body))+'\0').encode()+body).hexdigest()
        if digest!=expected: raise ValueError('Approved source identity mismatch')
        observed['source'][name]=digest
    required=manifest['distRequiredSha256'];allowed={**required,**manifest['distOptionalSha256']}
    for path in (root/'dist').rglob('*'):
        if path.is_symlink(): raise ValueError('Symlink in dist')
        if not path.is_file(): continue
        name=str(path.relative_to(root/'dist'))
        if name not in allowed: raise ValueError('Unapproved dist file')
        digest=hashlib.sha256(path.read_bytes()).hexdigest()
        if digest!=allowed[name]: raise ValueError('Approved dist identity mismatch')
        observed['dist'][name]=digest
    if not set(required)<=set(observed['dist']): raise ValueError('Missing approved page asset')
    if len([n for n in required if n.startswith('assets/face.worker-') and n.endswith('.js')])!=1:
        raise ValueError('Ambiguous approved Worker')
    return hashlib.sha256(json.dumps(observed,sort_keys=True).encode()).hexdigest()


class NetworkLedger:
    """Capture actual response bytes at completion, before raw Worker teardown.

    Only digests are retained. One body() call runs at a time; reentrant event
    callbacks enqueue bounded metadata. Finalization never tries a late read.
    body() itself has no interruptible per-call timeout/stream limit: the outer
    600-second command bounds execution, not native Playwright buffer memory.
    """
    MAX_REQUESTS = 128
    MAX_RESPONSES = 128
    MAX_BODY_BYTES = 64 * 1024 * 1024
    MAX_TOTAL_BYTES = 256 * 1024 * 1024
    ERROR_CLASSES = {'Error','TimeoutError','TargetClosedError','RuntimeError','ValueError','TypeError'}
    def __init__(self,base,manifest):
        self.base=base;self.expected=manifest['distRequiredSha256'];self.entries={};self.blocked=[]
        self.response_objects={};self.invalid_reasons=set()
        self.response_count=0;self.capture_busy=False;self.sealed=False;self.overflow=False;self.late_event=False
        self.capture_count=0;self.capture_bytes=0;self.capture_seconds=0.0
    def key(self,url):
        if url in REMOTE_URLS: return ('remote',url)
        if url.startswith(self.base+'/'):
            parsed=urlsplit(url)
            if parsed.query or parsed.fragment: return None
            name=unquote(parsed.path).lstrip('/') or 'index.html'
            if name in self.expected: return ('local',name)
        return None
    def request(self,request):
        if self.sealed:self.late_event=True;return None
        identity=id(request)
        if identity not in self.entries:
            if len(self.entries)>=self.MAX_REQUESTS:self.overflow=True;return None
            key=self.key(request.url)
            self.entries[identity]={'request':request,'key':key,'method':request.method,'finished':False,'failed':False,'responses':[]}
            if key is None or request.method!='GET': self.blocked.append({'kind':'nonallowlisted-request'})
        return self.entries[identity]
    def response(self,response):
        entry=self.request(response.request)
        if entry is None:return
        identity=id(response)
        if identity in self.response_objects:
            self.invalid_reasons.add('duplicate-response-object');return
        if self.response_count>=self.MAX_RESPONSES:self.overflow=True;return
        self.response_count+=1;self.response_objects[identity]=response
        entry['responses'].append({'response':response,'capture':{'status':response.status,'sha256':None,'captureState':'pending','capturePhase':None,'byteLength':None,'captureSeconds':None}})
        self._drain()
    def finished(self,request):
        entry=self.request(request)
        if entry is not None:entry['finished']=True;self._drain()
    def failed(self,request):
        entry=self.request(request)
        if entry is not None:entry['failed']=True
    def _drain(self):
        if self.capture_busy or self.sealed:return
        self.capture_busy=True
        try:
            # New callbacks during body() may append metadata; the next bounded
            # scan sees it. A response is attempted once, including on failure.
            for _ in range(self.MAX_RESPONSES):
                if self.sealed:break
                pending=next(((entry,item) for entry in self.entries.values() for item in entry['responses']
                              if entry['finished'] and item['capture']['captureState']=='pending'),None)
                if pending is None:break
                entry,item=pending;capture=item['capture'];capture['captureState']='failed';capture['capturePhase']='request-completion'
                if entry['failed'] or capture['status']!=200 or entry['key'] is None or entry['method']!='GET':
                    capture['error']='response-incomplete-or-non200';continue
                if self.capture_bytes>=self.MAX_TOTAL_BYTES:
                    capture['error']='capture-byte-budget-exhausted';continue
                if self.sealed:break
                start=time.monotonic();self.capture_count+=1
                try:
                    body=item['response'].body()
                    if not isinstance(body,bytes):raise TypeError('Unexpected response body type')
                    size=len(body);capture['byteLength']=size;self.capture_bytes+=size
                    if size>self.MAX_BODY_BYTES or self.capture_bytes>self.MAX_TOTAL_BYTES:
                        capture['error']='capture-byte-budget-exceeded'
                    else:
                        capture['sha256']=hashlib.sha256(body).hexdigest();capture['captureState']='captured'
                    del body
                except Exception as error:
                    capture['error']='body-hash-unavailable'
                    kind=type(error).__name__;capture['errorClass']=kind if kind in self.ERROR_CLASSES else 'OtherError'
                finally:
                    if self.sealed:self.invalid_reasons.add('capture-returned-after-seal')
                    elapsed=time.monotonic()-start
                    if not math.isfinite(elapsed) or elapsed<0:
                        capture['sha256']=None;capture['captureState']='failed';capture['error']='capture-clock-invalid'
                    else:
                        capture['captureSeconds']=elapsed
                        total=self.capture_seconds+elapsed
                        if not math.isfinite(total):
                            capture['sha256']=None;capture['captureState']='failed';capture['error']='capture-clock-invalid'
                        else:self.capture_seconds=total
        finally:self.capture_busy=False
    def seal(self):
        if self.sealed:return
        self.sealed=True
        if self.capture_busy:self.invalid_reasons.add('sealed-with-active-capture')
        if any(not entry['finished'] or not entry['responses'] or
               any(item['capture']['captureState']=='pending' for item in entry['responses'])
               for entry in self.entries.values()):
            self.invalid_reasons.add('sealed-with-unresolved-capture')
    def finalize(self):
        self.seal()
        records=[];hashes={};locals_seen=set();valid=not(self.blocked or self.overflow or self.late_event or self.capture_busy or self.invalid_reasons)
        for index,entry in enumerate(self.entries.values()):
            key=entry['key'];record={'requestIndex':index,'key':key,'finished':entry['finished'],'failed':entry['failed'],'responses':[],'valid':True}
            if key is None or entry['method']!='GET' or not entry['finished'] or entry['failed'] or not entry['responses']:
                record['valid']=False
            for captured in entry['responses']:
                item=dict(captured['capture'])
                if item['captureState']=='pending':item['error']='body-not-captured-at-completion'
                if item['sha256'] is None or item['captureState']!='captured' or item['status']!=200:record['valid']=False
                elif key and key[0]=='local':
                    locals_seen.add(key[1])
                    if item['sha256']!=self.expected[key[1]]:record['valid']=False;item['error']='approved-asset-mismatch'
                elif key and key[0]=='remote':
                    prior=hashes.get(key[1])
                    if prior is not None and prior!=item['sha256']:record['valid']=False;item['error']='conflicting-response-bytes'
                    hashes[key[1]]=item['sha256']
                record['responses'].append(item)
            valid=valid and record['valid'];records.append(record)
        valid=valid and set(hashes)==set(REMOTE_URLS) and locals_seen==set(self.expected)
        if not valid:self.invalid_reasons.add('finalized-invalid')
        return {'networkValid':bool(valid),'networkRecords':records,'runtimeHashes':hashes,'blockedRequests':list(self.blocked),
                'responseCapture':{'bodyCalls':self.capture_count,'bodyBytesObserved':self.capture_bytes,'bodyCaptureSeconds':self.capture_seconds,
                                   'recordLimitExceeded':self.overflow,'eventsAfterSeal':self.late_event,'reentrantCapturePending':self.capture_busy,
                                   'terminalInvalidReasons':sorted(self.invalid_reasons),
                                   'maxRequests':self.MAX_REQUESTS,'maxResponses':self.MAX_RESPONSES,'maxBodyBytesAfterRead':self.MAX_BODY_BYTES,'maxTotalBytesAfterRead':self.MAX_TOTAL_BYTES,
                                   'scope':'observer calls overlap startup; not subtracted from raw timings; native body buffers not hard-bounded'}}

def safe_snapshot():
    try:
        from runner_snapshot import Source,collect
        return collect(Source(),uid=os.getuid(),own_pid=os.getpid(),logical_cpus=os.cpu_count(),
                       affinity_cpus=len(os.sched_getaffinity(0)),clock_ticks=os.sysconf('SC_CLK_TCK'),page_size=os.sysconf('SC_PAGE_SIZE'),
                       utc=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),monotonic_seconds=time.monotonic())
    except Exception: return {'missing':['diagnosticRunnerSnapshotUnavailable']}


def main():
    output=Path('test-results/animation-contention');root=Path('.')
    summary={'classification':'DIAGNOSTIC ONLY; no original formal acceptance',
             'rawSubsequenceOnly':True,'precedingCIWorkloadIncluded':False,
             'plannedTrials':[{'label':label,'condition':condition,'status':'unexecuted'} for label,condition in TRIALS],
             'rows':[],'comparisonValid':False,'pairedContrasts':{'eligible':False},'stage':'output-initialization'}
    def save():
        output.mkdir(parents=True,exist_ok=True)
        (output/'summary.json').write_text(json.dumps(summary,indent=2,allow_nan=False)+'\n')
    try: save()
    except Exception:
        print('Diagnostic artifact initialization failed');return 1
    server=None
    try:
        summary['stage']='approved-input-preflight'
        manifest=read_approved_manifest(root)
        expected_identity=verify_inputs(root,manifest)
        protocol=load_raw_protocol(root/'tests/face_worker.py');reporter=load_reporter()
        versions=runtime_versions()
        if versions!={k:manifest['runtimeVersions'][k] for k in ('python','playwright')}:
            raise ValueError('Unapproved runtime toolchain')
        summary.update(approvedManifestSha256=APPROVED_MANIFEST_SHA256,inputIdentity=expected_identity,runtimeVersions=versions,
                       approvedSource=manifest['sourceCommit'],browserArgs=BROWSER_ARGS,rawProtocolIdentity=protocol['identity'],reportingHelperSha256=REPORTER_SHA256)
        worker=next(n for n in manifest['distRequiredSha256'] if n.startswith('assets/face.worker-') and n.endswith('.js'))
        import functools,threading
        from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
        from playwright.sync_api import sync_playwright
        summary['stage']='server-setup'
        server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(SimpleHTTPRequestHandler,directory=str(Path('dist').resolve())))
        threading.Thread(target=server.serve_forever,daemon=True).start();base='http://127.0.0.1:'+str(server.server_port)
        with sync_playwright() as playwright:
            for index,(label,condition) in enumerate(TRIALS):
                row={'label':label,'condition':condition,'rawSequenceExecuted':False};browser=None;ledger=None
                try:
                    summary['stage']='trial-'+label
                    row['inputIdentityBefore']=verify_inputs(root,manifest)
                    if row['inputIdentityBefore']!=expected_identity: raise ValueError('Input set drift')
                    row['before']=safe_snapshot()
                    browser=playwright.chromium.launch(headless=True,args=BROWSER_ARGS);row['browserVersion']=browser.version
                    if browser.version!=manifest['runtimeVersions']['chromium']: raise ValueError('Unapproved Chromium version')
                    context=browser.new_context();ledger=NetworkLedger(base,manifest)
                    def route_request(route):
                        entry=ledger.request(route.request)
                        if entry is not None and entry['key'] is not None and route.request.method=='GET': route.continue_()
                        else: route.abort()
                    context.route('**/*',route_request)
                    context.on('request',ledger.request);context.on('response',ledger.response)
                    context.on('requestfinished',ledger.finished);context.on('requestfailed',ledger.failed)
                    page=context.new_page();page.goto(base+'/');page.wait_for_timeout(300)
                    row['hostStart']=page.evaluate(HOST_SETUP,condition)
                    row['rawSequenceExecuted']=True
                    row.update(run_raw_sequence(protocol,reporter,page,base,worker,output/'trials'/label/'face-worker'))
                    row['hostEnd']=page.evaluate(HOST_END)  # body capture already occurred at completion events
                except Exception as error:
                    row.setdefault('rawSubsequencePassed',False);row['trialError']=type(error).__name__
                finally:
                    if ledger is not None:ledger.seal()
                    if browser:
                        try: browser.close()
                        except Exception: row['teardownFailed']=True
                    if ledger is not None:
                        try: row.update(ledger.finalize())
                        except Exception: row['networkValid']=False;row['networkAccountingError']='unavailable'
                    row['after']=safe_snapshot()
                    try: row['inputIdentityAfter']=verify_inputs(root,manifest)
                    except Exception: row['inputIdentityAfter']=None;row['inputIdentityError']='missing-or-changed-approved-input'
                    summary['rows'].append(row);summary['plannedTrials'][index]['status']='executed' if row['rawSequenceExecuted'] else 'not-started-error';save()
                if row.get('responseCapture',{}).get('reentrantCapturePending'):
                    summary['planIncompleteReason']='observer-capture-unresolved-after-finalization';break
                if row.get('teardownFailed') or row.get('inputIdentityBefore')!=expected_identity or row.get('inputIdentityAfter')!=expected_identity: break
        summary['comparisonValid']=identity_consistent(summary['rows'],expected_identity,manifest['runtimeVersions']['chromium'])
        summary['pairedContrasts']=contrasts(summary['rows'],summary['comparisonValid']);summary['stage']='completed'
    except Exception as error:
        summary['failure']={'stage':summary['stage'],'errorClass':type(error).__name__}
    finally:
        if server:
            try: server.shutdown();server.server_close()
            except Exception:
                summary['serverCleanupFailed']=True;summary['comparisonValid']=False
                summary['pairedContrasts']={'eligible':False,'reason':'server-cleanup-failed'}
        try: save()
        except Exception: print('Diagnostic final artifact write failed');return 1
    return 0 if summary['comparisonValid'] and all(summary['pairedContrasts'][phase]['eligible'] for phase in RAW_PHASES) and all(r.get('rawSubsequencePassed') for r in summary['rows']) else 1


if __name__=='__main__': raise SystemExit(main())
