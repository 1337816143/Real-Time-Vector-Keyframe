"""Run the actual main with fake browser/server/thread/metadata and synthetic approved inputs."""
import contextlib,hashlib,io,json,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
import test_raw_sequence as t
d=t.d

class Request:
    def __init__(self,url):self.url=url;self.method='GET'
class Response:
    def __init__(self,request,body,status=200,fail=False):self.request=request;self.url=request.url;self.status=status;self.payload=body;self.fail=fail
    def body(self):
        if self.fail:raise RuntimeError('body unavailable')
        return self.payload
class Server:
    server_port=12345
    def __init__(self,*a,**k):pass
    def serve_forever(self):raise AssertionError('No server should run')
    def shutdown(self):pass
    def server_close(self):pass
class Thread:
    def __init__(self,*a,**k):pass
    def start(self):pass
class Harness:
    def __init__(self,root,**options):
        self.root=root;self.options=options;self.launch_count=0;self.chromium=self;self.raw_calls=[];self.close_count=0
        self.assets={'index.html':b'<html>approved fixture</html>','assets/index.js':b'approved js','assets/index.css':b'approved css','assets/face.worker-approved.js':b'approved worker'}
        for name,body in self.assets.items():
            p=root/'dist'/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(body)
        control=root/'src/control';control.parent.mkdir();control.write_bytes(b'approved source')
        collector=root/'scripts/runner_snapshot.py';collector.parent.mkdir();collector.write_bytes(b'approved metadata collector')
        original=root/'tests/face_worker.py';original.parent.mkdir();original.write_bytes(t.ORIGINAL.read_bytes())
        self.manifest={'sourceCommit':'synthetic-approved','sourceGitBlobs':{str(p.relative_to(root)):hashlib.sha1(('blob '+str(len(p.read_bytes()))+'\0').encode()+p.read_bytes()).hexdigest() for p in (control,collector,original)},'distRequiredSha256':{n:hashlib.sha256(b).hexdigest() for n,b in self.assets.items()},'distOptionalSha256':{},'runtimeVersions':{'python':'3.12.3','playwright':'1.57.0','chromium':'143.0.7499.4'}}
        body=json.dumps(self.manifest).encode();(root/d.MANIFEST_PATH).write_bytes(body);self.manifest_hash=hashlib.sha256(body).hexdigest()
        if options.get('missing_worker'):(root/'dist/assets/face.worker-approved.js').unlink()
        if options.get('bad_source'):control.write_bytes(b'unapproved changed source')
        if options.get('bad_manifest'):(root/d.MANIFEST_PATH).write_bytes(b'{}')
    def __enter__(self):return self
    def __exit__(self,*a):return False
    def launch(self,**kwargs):
        assert kwargs=={'headless':True,'args':d.BROWSER_ARGS}
        self.launch_count+=1;self.condition=d.TRIALS[self.launch_count-1][1];self.version='143.0.7499.4';self.events={};return self
    def new_context(self):return self
    def route(self,*args):pass
    def on(self,name,callback):self.events[name]=callback
    def new_page(self):return self
    def emit(self,url,body,status=200,finished=True,fail_body=False):
        request=Request(url);response=Response(request,body,status,fail_body)
        self.events['request'](request);self.events['response'](response)
        if finished:self.events['requestfinished'](request)
    def goto(self,url):
        for name,body in self.assets.items():
            if name.endswith('.css') and self.options.get('changed_response'):body=b'changed served bytes'
            self.emit('http://127.0.0.1:12345/'+('' if name=='index.html' else name),body)
        for remote in d.REMOTE_URLS:self.emit(remote,('bytes:'+remote).encode())
        if self.options.get('extra_503'):self.emit(d.REMOTE_URLS[0],b'bad response',status=503)
        if self.options.get('unfinished'):self.emit(d.REMOTE_URLS[0],b'unfinished',finished=False)
        if self.options.get('missing_body'):self.emit(d.REMOTE_URLS[0],b'missing body',fail_body=True)
        if self.options.get('conflicting_duplicate'):self.emit(d.REMOTE_URLS[0],b'conflicting bytes')
    def wait_for_timeout(self,ms):assert ms==300
    def evaluate(self,script,arg=None):
        if script==d.HOST_SETUP:return t.host_row(self.condition)['hostStart']
        if hashlib.sha256(script.encode()).hexdigest()==d.RAW_PAYLOAD_SHA256:
            forced=arg['forceFallback'];self.raw_calls.append((self.launch_count,forced))
            for remote in d.REMOTE_URLS:self.emit(remote,('bytes:'+remote).encode())
            if self.options.get('default_failure') and not forced:raise RuntimeError('warm-up exceeds freshness budget (245, 135, 211, 200 ms)')
            if self.options.get('fallback_failure') and forced:raise RuntimeError('warm-up exceeds freshness budget (245, 135, 211, 200 ms)')
            return t.raw_report(forced)
        assert script==d.HOST_END
        host=t.host_row(self.condition)['hostEnd']
        if self.options.get('replacement_nodes'):
            for item in host:item['sameTarget']=False;item['selector']='.replacement'
        if self.options.get('nonfinite'):
            for item in host:item['currentTime']=float('nan')
        return host
    def close(self):
        self.close_count+=1
        if self.options.get('mutate_dist'):(self.root/'dist/assets/index.css').write_bytes(b'changed after trial')

@contextlib.contextmanager
def fixture(**options):
    with tempfile.TemporaryDirectory() as tmp:
        root=Path(tmp);h=Harness(root,**options);pw=types.ModuleType('playwright');api=types.ModuleType('playwright.sync_api');api.sync_playwright=lambda:h
        with contextlib.chdir(root),patch.dict(sys.modules,{'playwright':pw,'playwright.sync_api':api}),patch('http.server.ThreadingHTTPServer',Server),patch('threading.Thread',Thread),patch.object(d,'safe_snapshot',return_value={'synthetic':True}),patch.object(d,'runtime_versions',return_value={'python':'3.12.3','playwright':'1.57.0'}),patch.object(d,'APPROVED_MANIFEST_SHA256',h.manifest_hash),contextlib.redirect_stdout(io.StringIO()):yield h,root

def run(**options):
    with fixture(**options) as (h,root):
        code=d.main();summary=json.loads((root/'test-results/animation-contention/summary.json').read_text());return code,summary,h.launch_count

class ReviewRegressions(unittest.TestCase):
    def test_known_approved_complete_main_path(self):
        code,s,count=run();self.assertEqual(code,0);self.assertTrue(s['comparisonValid']);self.assertTrue(all(s['pairedContrasts'][p]['eligible'] for p in d.RAW_PHASES));self.assertEqual(count,4);self.assertTrue(s['rawSubsequenceOnly']);self.assertFalse(s['precedingCIWorkloadIncluded'])
    def test_unapproved_source_rejected_before_browser(self):
        code,s,count=run(bad_source=True);self.assertEqual(code,1);self.assertEqual(count,0);self.assertFalse(s['comparisonValid']);self.assertIn('failure',s)
    def test_modified_manifest_rejected(self):
        code,s,count=run(bad_manifest=True);self.assertEqual(code,1);self.assertEqual(count,0)
    def test_dist_drift_is_not_accepted(self):
        code,s,count=run(mutate_dist=True);self.assertEqual(code,1);self.assertFalse(s['comparisonValid']);self.assertEqual(count,1);self.assertIsNone(s['rows'][0]['inputIdentityAfter'])
    def test_served_css_mismatch_even_when_disk_unchanged_rejected(self):
        code,s,count=run(changed_response=True);self.assertEqual(code,1);self.assertFalse(s['comparisonValid']);self.assertTrue(any(not row['networkValid'] for row in s['rows']))
    def test_same_url_extra_503_rejected_and_retained(self):
        code,s,count=run(extra_503=True);self.assertEqual(code,1);self.assertFalse(s['comparisonValid']);self.assertTrue(any(item['status']==503 for record in s['rows'][0]['networkRecords'] for item in record['responses']))
    def test_same_url_unfinished_request_rejected(self):
        code,s,count=run(unfinished=True);self.assertEqual(code,1);self.assertFalse(s['comparisonValid']);self.assertTrue(any(not record['finished'] for record in s['rows'][0]['networkRecords']))
    def test_same_url_body_unavailable_rejected(self):
        code,s,count=run(missing_body=True);self.assertEqual(code,1);self.assertFalse(s['comparisonValid'])
    def test_conflicting_duplicate_bytes_rejected(self):
        code,s,count=run(conflicting_duplicate=True);self.assertEqual(code,1);self.assertFalse(s['comparisonValid'])
    def test_replaced_nodes_not_accepted(self):
        code,s,count=run(replacement_nodes=True);self.assertEqual(code,1);self.assertFalse(s['comparisonValid'])
    def test_default_failure_does_not_create_fallback_measurements_or_extra_trials(self):
        with fixture(default_failure=True) as (h,root):
            self.assertEqual(d.main(),1);s=json.loads((root/'test-results/animation-contention/summary.json').read_text())
            self.assertEqual(h.launch_count,4);self.assertEqual(h.close_count,4);self.assertEqual(h.raw_calls,[(1,False),(2,False),(3,False),(4,False)])
            self.assertTrue(all(row['stageStatus']['raw-forced-fallback']=='not_executed' for row in s['rows']))
            self.assertFalse(s['pairedContrasts']['raw-forced-fallback']['eligible'])
    def test_fallback_failure_is_separate_from_successful_default(self):
        with fixture(fallback_failure=True) as (h,root):
            self.assertEqual(d.main(),1);s=json.loads((root/'test-results/animation-contention/summary.json').read_text())
            self.assertEqual(len(h.raw_calls),8);self.assertEqual(h.launch_count,4);self.assertEqual(h.close_count,4)
            self.assertTrue(all(row['stageStatus']['raw-default']=='passed' and row['stageStatus']['raw-forced-fallback']=='failed_in_phase' for row in s['rows']))
            self.assertTrue(s['pairedContrasts']['raw-default']['eligible']);self.assertFalse(s['pairedContrasts']['raw-forced-fallback']['eligible'])
    def test_missing_worker_retains_fresh_summary_all_unexecuted(self):
        with fixture(missing_worker=True) as (h,root):
            out=root/'test-results/animation-contention';out.mkdir(parents=True);(out/'summary.json').write_text('{"stale":true}')
            self.assertEqual(d.main(),1);s=json.loads((out/'summary.json').read_text());self.assertNotIn('stale',s);self.assertIn('failure',s);self.assertFalse(s['rows']);self.assertTrue(all(r['status']=='unexecuted' for r in s['plannedTrials']))
    def test_nonfinite_animation_control_rejected(self):
        row={'condition':'playing',**t.host_row('playing')};row['hostEnd'][0]['currentTime']=float('nan')
        self.assertFalse(d.host_condition_observed(row))
    def test_symlink_dist_root_rejected_before_browser(self):
        with fixture() as (h,root):
            (root/'dist').rename(root/'saved-dist');(root/'dist').symlink_to(root/'saved-dist',target_is_directory=True)
            self.assertEqual(d.main(),1);self.assertEqual(h.launch_count,0)

if __name__=='__main__':unittest.main()
