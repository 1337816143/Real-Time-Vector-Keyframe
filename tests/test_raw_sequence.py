"""Execute the exact approved original raw loop with fake pages and progress sinks."""
import ast,copy,hashlib,importlib.util,json,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('raw_diagnostic',ROOT/'scripts/face_animation_contention.py');d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
ORIGINAL=ROOT/'tests/face_worker.py'
if not ORIGINAL.exists():ORIGINAL=ROOT.parent/'candidate/tests/face_worker.py'
PROTOCOL=d.load_raw_protocol(ORIGINAL);REPORTER=d.load_reporter()

def raw_report(forced=False):
 return {'delegate':'CPU','gpuFailure':'Synthetic GPU factory failure' if forced else None,'warmupMs':180.0,'warmupSamples':[220.0,180.0,100.0],'initMs':5000.0,'inferenceMs':100.0,'landmarkCount':0,'frameId':1,'bitmapTransferred':True}
class Out:
 def __init__(self,events,fail_progress=None,files=None,name='root'):self.events=events;self.fail_progress=fail_progress;self.files={} if files is None else files;self.name=name
 def mkdir(self,**kwargs):pass
 def __truediv__(self,name):return Out(self.events,self.fail_progress,self.files,name)
 def __str__(self):return 'synthetic/'+self.name
 def write_text(self,text):
  value=json.loads(text);self.events.append(('write',self.name,value.get('phase'),len(value.get('observedRuns',[]))))
  if self.name=='progress.json' and value['phase']==self.fail_progress:raise OSError('Synthetic progress failure')
  self.files[self.name]=text
class Page:
 def __init__(self,events,fail=None,changes=None):self.events=events;self.fail=fail;self.changes=changes or {};self.calls=[]
 def evaluate(self,payload,args):
  assert hashlib.sha256(payload.encode()).hexdigest()==d.RAW_PAYLOAD_SHA256
  forced=args['forceFallback'];self.calls.append(forced);self.events.append(('evaluate',forced))
  assert args['workerPath']=='http://approved/assets/face.worker-approved.js'
  if forced is self.fail:raise RuntimeError('warm-up exceeds freshness budget (245, 135, 211, 200 ms)')
  r=raw_report(forced);r.update(self.changes.get(forced,{}));return r

def execute(*,fail=None,changes=None,fail_progress=None):
 events=[];page=Page(events,fail,changes);out=Out(events,fail_progress)
 result=d.run_raw_sequence(PROTOCOL,REPORTER,page,'http://approved','assets/face.worker-approved.js',out)
 return result,page,out,events

def host_row(condition):
 state='running' if condition=='playing' else 'paused'
 def phase(end):
  return [{'selector':selector,'name':name,'token':'animation-'+str(i),'sameObject':True,'sameTarget':True,'playState':state,'currentTime':500 if end and condition=='playing' else 300} for i,(selector,name) in enumerate(d.HOST_TARGETS)]
 return {'hostStart':phase(False),'hostEnd':phase(True)}

class RawSequenceTests(unittest.TestCase):
 def test_javascript_fixture_is_bound_to_actual_sources(self):
  fixture=json.loads((ROOT/'tests/fixtures/animation-raw-javascript.json').read_text());self.assertEqual(fixture['host'],d.HOST_SETUP);self.assertEqual(fixture['end'],d.HOST_END);self.assertEqual(hashlib.sha256(fixture['raw'].encode()).hexdigest(),d.RAW_PAYLOAD_SHA256)
 def test_whole_original_loop_and_payload_identity(self):
  self.assertEqual(PROTOCOL['identity']['sourceGitBlob'],'09b90f4592d302493cacd4162dcc04862c89516a')
  self.assertEqual(PROTOCOL['identity']['loopSourceSha256'],d.RAW_LOOP_SOURCE_SHA256)
 def test_both_stages_pass_in_exact_original_order(self):
  r,p,o,e=execute();self.assertTrue(r['rawSubsequencePassed']);self.assertEqual(p.calls,[False,True]);self.assertEqual(e,[('evaluate',False),('write','progress.json','raw-default',1),('evaluate',True),('write','progress.json','raw-forced-fallback',2)])
  self.assertEqual(r['stageStatus'],{'raw-default':'passed','raw-forced-fallback':'passed'});self.assertFalse(r['fullOriginalAcceptanceExecuted'])
 def test_default_warmup_failure_never_runs_fallback(self):
  r,p,o,e=execute(fail=False);self.assertEqual(p.calls,[False]);self.assertEqual(r['stageStatus']['raw-default'],'failed_in_phase');self.assertEqual(r['stageStatus']['raw-forced-fallback'],'not_executed');self.assertIsNone(r['stageReports']['raw-forced-fallback']);self.assertFalse(r['rawSubsequencePassed'])
 def test_forced_warmup_failure_retains_successful_default(self):
  r,p,o,e=execute(fail=True);self.assertEqual(p.calls,[False,True]);self.assertEqual(r['stageStatus']['raw-default'],'passed');self.assertEqual(r['rawFailure']['failurePhase'],'raw-forced-fallback');self.assertIsNone(r['rawFailure']['failedPhaseWarmupSamples']);self.assertIsNone(r['stageReports']['raw-forced-fallback']);self.assertIn('200',r['rawFailure']['errorText'])
 def test_default_late_assertions_stop_before_fallback(self):
  for change in ({'initMs':30000},{'inferenceMs':250},{'landmarkCount':478},{'frameId':2},{'bitmapTransferred':False}):
   with self.subTest(change=change):
    r,p,o,e=execute(changes={False:change});self.assertEqual(p.calls,[False]);self.assertEqual(e[1],('write','progress.json','raw-default',1));self.assertEqual(r['stageStatus']['raw-default'],'failed_in_phase');self.assertEqual(r['stageStatus']['raw-forced-fallback'],'not_executed');self.assertTrue(r['rawObservationValid'])
 def test_fallback_assertions_are_not_skipped(self):
  for change in ({'initMs':30000},{'inferenceMs':250},{'landmarkCount':478},{'frameId':2},{'bitmapTransferred':False},{'delegate':'GPU'},{'gpuFailure':None}):
   with self.subTest(change=change):
    r,p,o,e=execute(changes={True:change});self.assertEqual(p.calls,[False,True]);self.assertEqual(e[3],('write','progress.json','raw-forced-fallback',2));self.assertEqual(r['stageStatus']['raw-forced-fallback'],'failed_in_phase');self.assertFalse(r['rawSubsequencePassed'])
 def test_default_progress_write_failure_prevents_fallback(self):
  r,p,o,e=execute(fail_progress='raw-default');self.assertEqual(p.calls,[False]);self.assertEqual(r['stageStatus']['raw-forced-fallback'],'not_executed');self.assertEqual(len(r['rawFailure']['observedRuns']),1)
 def test_fallback_progress_write_failure_not_labeled_pass(self):
  r,p,o,e=execute(fail_progress='raw-forced-fallback');self.assertEqual(r['stageStatus']['raw-default'],'passed');self.assertEqual(r['stageStatus']['raw-forced-fallback'],'failed_in_phase');self.assertFalse(r['rawSubsequencePassed'])
 def test_progress_written_before_original_assertions(self):
  r,p,o,e=execute(changes={False:{'inferenceMs':300}});stored=json.loads(o.files['progress.json']);self.assertEqual(stored['phase'],'raw-default');self.assertEqual(stored['observedRuns'][0]['inferenceMs'],300);self.assertFalse(r['rawLoopCompleted'])
 def test_force_flag_and_cpu_synthetic_failure_are_original(self):
  r,p,o,e=execute();self.assertIs(r['stageReports']['raw-default']['forcedGpuFactoryFailure'],False);self.assertIs(r['stageReports']['raw-forced-fallback']['forcedGpuFactoryFailure'],True);self.assertEqual(r['stageReports']['raw-forced-fallback']['delegate'],'CPU');self.assertEqual(r['stageReports']['raw-forced-fallback']['gpuFailure'],'Synthetic GPU factory failure')
 def test_no_fake_gpu_success_claim_or_later_pipeline(self):
  r,p,o,e=execute();self.assertFalse(r['fullOriginalAcceptanceExecuted']);self.assertEqual(len(p.calls),2);self.assertEqual(set(r['stageReports']),set(d.RAW_PHASES))
 def test_malformed_observation_cannot_become_accepted_diagnostic(self):
  r,p,o,e=execute(changes={False:{'warmupSamples':[float('nan'),180,100]}});self.assertFalse(r['rawObservationValid']);self.assertFalse(r['rawSubsequencePassed']);json.dumps(r,allow_nan=False)
 def test_original_source_tamper_rejected_before_compilation(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'face_worker.py';p.write_text(ORIGINAL.read_text().replace('30000','31000'))
   with self.assertRaises(ValueError):d.load_raw_protocol(p)
 def test_default_failure_makes_fallback_contrast_ineligible(self):
  rows=[]
  for i in range(4):r,*_=execute(fail=False if i==0 else None);rows.append(r)
  self.assertFalse(d.contrasts(rows,True)['raw-forced-fallback']['eligible'])
 def test_fallback_failure_does_not_get_samples_from_error_string(self):
  rows=[execute(fail=True)[0] for _ in range(4)];c=d.contrasts(rows,True);self.assertTrue(c['raw-default']['eligible']);self.assertFalse(c['raw-forced-fallback']['eligible']);self.assertEqual(c['raw-forced-fallback']['pairs'],[])
 def test_complete_precise_samples_have_separate_phase_contrasts(self):
  rows=[execute()[0] for _ in range(4)];c=d.contrasts(rows,True);self.assertEqual(set(c),set(d.RAW_PHASES));self.assertTrue(all(c[p]['eligible'] for p in d.RAW_PHASES))

if __name__=='__main__':unittest.main()
