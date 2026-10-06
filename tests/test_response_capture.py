"""Offline response-lifetime/reentrancy/missing-data regressions; no browser/network."""
import hashlib,importlib.util,json,unittest
from pathlib import Path
from unittest.mock import patch
import test_raw_sequence as t
from test_runtime_controls import Request,Response
D=t.d
PREFIX_HASH='509889f2525035c49ef495843ad0b4dc23e0b0affc41fddfb2c70c09ff46c5a4'
OLD=Path(__file__).resolve().parent/'fixtures/deferred_network_ledger.py'
spec=importlib.util.spec_from_file_location('old_deferred_recorder',OLD);old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)

class LifetimeResponse(Response):
 def __init__(self,request,body,life,callback=None):super().__init__(request,body);self.life=life;self.calls=0;self.callback=callback
 def body(self):
  self.calls+=1
  if not self.life['alive']:raise RuntimeError('Synthetic Worker disposed')
  if self.callback:self.callback()
  return self.payload

def setup(cls=D.NetworkLedger):
 assets={'index.html':b'html','assets/index.js':b'js','assets/index.css':b'css','assets/face.worker.js':b'worker'}
 manifest={'distRequiredSha256':{k:hashlib.sha256(v).hexdigest() for k,v in assets.items()}}
 return cls('http://synthetic',manifest),assets

def emit(ledger,url,body,life=None,status=200,finish=True,reverse=False,callback=None):
 request=Request(url);response=LifetimeResponse(request,body,life or {'alive':True},callback);response.status=status
 ledger.request(request)
 if reverse:ledger.finished(request)
 ledger.response(response)
 if finish and not reverse:ledger.finished(request)
 return request,response

def complete(ledger,assets):
 for name,body in assets.items():emit(ledger,'http://synthetic/'+('' if name=='index.html' else name),body)
 for url in D.REMOTE_URLS:emit(ledger,url,b'sdk:'+url.encode())

class CaptureTests(unittest.TestCase):
 def test_precise_success_lifetime_pattern_old_fails_new_retains_actual_bodies(self):
  for cls,expected in [(old.NetworkLedger,False),(D.NetworkLedger,True)]:
   ledger,assets=setup(cls)
   for name,body in assets.items():
    if name!='assets/face.worker.js':emit(ledger,'http://synthetic/'+('' if name=='index.html' else name),body)
   responses=[]
   for _ in range(2):
    life={'alive':True};_,response=emit(ledger,'http://synthetic/assets/face.worker.js',b'worker',life);responses.append(response)
    for url in D.REMOTE_URLS:
     _,response=emit(ledger,url,b'sdk:'+url.encode(),life);responses.append(response)
    life['alive']=False
   result=ledger.finalize();self.assertEqual(result['networkValid'],expected)
   self.assertEqual(sum(r['sha256'] is None for e in result['networkRecords'] for r in e['responses']),0 if expected else 8)
   self.assertEqual([r.calls for r in responses],[1]*8)
 def test_finished_before_response_event_captured_once(self):
  ledger,assets=setup();complete(ledger,assets);_,r=emit(ledger,D.REMOTE_URLS[0],b'sdk:'+D.REMOTE_URLS[0].encode(),reverse=True)
  self.assertEqual(r.calls,1);self.assertTrue(ledger.finalize()['networkValid']);self.assertEqual(r.calls,1)
 def test_missing_completion_never_reads_at_finalization(self):
  ledger,assets=setup();complete(ledger,assets);_,r=emit(ledger,D.REMOTE_URLS[0],b'x',finish=False)
  self.assertFalse(ledger.finalize()['networkValid']);self.assertEqual(r.calls,0)
 def test_failed_capture_never_retried_at_finalization(self):
  ledger,assets=setup();complete(ledger,assets);life={'alive':False};_,r=emit(ledger,D.REMOTE_URLS[0],b'x',life)
  life['alive']=True;result=ledger.finalize();self.assertFalse(result['networkValid']);self.assertEqual(r.calls,1)
  item=result['networkRecords'][-1]['responses'][0];self.assertEqual(item['errorClass'],'RuntimeError');self.assertNotIn('Synthetic Worker',json.dumps(result))
 def test_completion_without_response_is_invalid(self):
  ledger,assets=setup();complete(ledger,assets);req=Request(D.REMOTE_URLS[0]);ledger.finished(req);self.assertFalse(ledger.finalize()['networkValid'])
 def test_same_url_non200_not_hidden_by_prior_good_response(self):
  ledger,assets=setup();complete(ledger,assets);_,r=emit(ledger,D.REMOTE_URLS[0],b'x',status=503);result=ledger.finalize()
  self.assertFalse(result['networkValid']);self.assertEqual(r.calls,0);self.assertEqual(result['networkRecords'][-1]['responses'][0]['status'],503)
 def test_conflicting_duplicate_actual_bytes_are_invalid(self):
  ledger,assets=setup();complete(ledger,assets);emit(ledger,D.REMOTE_URLS[0],b'different');self.assertFalse(ledger.finalize()['networkValid'])
 def test_failed_event_after_capture_remains_invalid(self):
  ledger,assets=setup();complete(ledger,assets);req,r=emit(ledger,D.REMOTE_URLS[0],b'sdk:'+D.REMOTE_URLS[0].encode());ledger.failed(req);self.assertFalse(ledger.finalize()['networkValid'])
 def test_reentrant_capture_is_serial_and_all_responses_accounted(self):
  ledger,assets=setup();complete(ledger,assets);events=[];nested=[]
  def callback():
   events.append('outer-start');req,r=emit(ledger,D.REMOTE_URLS[1],b'sdk:'+D.REMOTE_URLS[1].encode());nested.append(r)
   self.assertEqual(r.calls,0);events.append('outer-end')
  _,r=emit(ledger,D.REMOTE_URLS[0],b'sdk:'+D.REMOTE_URLS[0].encode(),callback=callback)
  self.assertEqual(r.calls,1);self.assertEqual(nested[0].calls,1);self.assertEqual(events,['outer-start','outer-end']);self.assertTrue(ledger.finalize()['networkValid'])
 def test_callbacks_after_seal_invalidate_without_extra_read(self):
  ledger,assets=setup();complete(ledger,assets);ledger.seal();_,r=emit(ledger,D.REMOTE_URLS[0],b'x');result=ledger.finalize()
  self.assertFalse(result['networkValid']);self.assertTrue(result['responseCapture']['eventsAfterSeal']);self.assertEqual(r.calls,0)
 def test_request_and_response_record_limits_failclosed(self):
  ledger,assets=setup();complete(ledger,assets)
  for _ in range(200):emit(ledger,D.REMOTE_URLS[0],b'sdk:'+D.REMOTE_URLS[0].encode())
  result=ledger.finalize();self.assertFalse(result['networkValid']);self.assertTrue(result['responseCapture']['recordLimitExceeded']);self.assertLessEqual(len(result['networkRecords']),128)
  ledger,assets=setup();req=Request(D.REMOTE_URLS[0]);ledger.request(req)
  for _ in range(200):ledger.response(Response(req,b'x'))
  self.assertLessEqual(len(ledger.entries[id(req)]['responses']),128);self.assertFalse(ledger.finalize()['networkValid'])
 def test_body_byte_limit_invalidates_without_digest_substitution(self):
  ledger,assets=setup();complete(ledger,assets);ledger.MAX_BODY_BYTES=1;emit(ledger,D.REMOTE_URLS[0],b'too large');result=ledger.finalize()
  self.assertFalse(result['networkValid']);item=result['networkRecords'][-1]['responses'][0];self.assertIsNone(item['sha256']);self.assertEqual(item['error'],'capture-byte-budget-exceeded')
 def test_total_byte_limit_prevents_further_body_calls(self):
  ledger,assets=setup();complete(ledger,assets);ledger.MAX_TOTAL_BYTES=ledger.capture_bytes;_,r=emit(ledger,D.REMOTE_URLS[0],b'x');self.assertFalse(ledger.finalize()['networkValid']);self.assertEqual(r.calls,0)
 def test_no_body_bytes_or_exception_text_in_serialized_output(self):
  ledger,assets=setup();complete(ledger,assets);_,r=emit(ledger,D.REMOTE_URLS[0],b'never serialize body',{'alive':False});s=json.dumps(ledger.finalize(),allow_nan=False)
  self.assertNotIn('never serialize body',s);self.assertNotIn('disposed',s)
 def test_duration_recorded_without_changing_raw_report(self):
  ledger,assets=setup()
  with patch.object(D.time,'monotonic',side_effect=[1.0,1.25]):emit(ledger,'http://synthetic/',b'html')
  result=ledger.finalize();self.assertEqual(result['responseCapture']['bodyCaptureSeconds'],0.25);self.assertEqual(result['networkRecords'][0]['responses'][0]['captureSeconds'],0.25)
 def test_nonfinite_capture_clock_invalid_and_serializable(self):
  ledger,assets=setup()
  with patch.object(D.time,'monotonic',side_effect=[1.0,float('nan')]):emit(ledger,'http://synthetic/',b'html')
  result=ledger.finalize();self.assertFalse(result['networkValid']);json.dumps(result,allow_nan=False)
 def test_no_application_protocol_or_reporter_change(self):
  new=Path(D.__file__).read_text()
  self.assertEqual(hashlib.sha256(new[:new.index('class NetworkLedger:')].encode()).hexdigest(),PREFIX_HASH)
  self.assertEqual(D.load_raw_protocol(t.ORIGINAL)['identity']['sourceGitBlob'],'09b90f4592d302493cacd4162dcc04862c89516a')
  self.assertEqual(hashlib.sha256((Path(D.__file__).parent/'face_failure_reporting.py').read_bytes()).hexdigest(),D.REPORTER_SHA256)


if __name__=='__main__':unittest.main()
