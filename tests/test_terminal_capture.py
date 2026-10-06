"""Independent-review counterexample regressions; synthetic objects only."""
import json,unittest
from unittest.mock import patch
import test_response_capture as t
from test_runtime_controls import fixture
D=t.D

class TerminalCaptureTests(unittest.TestCase):
 def test_seal_while_read_active_prevents_queued_read_forever(self):
  ledger,assets=t.setup();t.complete(ledger,assets);nested=[]
  def callback():
   _,r=t.emit(ledger,D.REMOTE_URLS[1],b'sdk:'+D.REMOTE_URLS[1].encode());nested.append(r);ledger.seal()
  _,outer=t.emit(ledger,D.REMOTE_URLS[0],b'sdk:'+D.REMOTE_URLS[0].encode(),callback=callback)
  self.assertEqual(outer.calls,1);self.assertEqual(nested[0].calls,0)
  for _ in range(3):
   result=ledger.finalize();self.assertFalse(result['networkValid']);self.assertEqual(nested[0].calls,0)
   self.assertIn('sealed-with-active-capture',result['responseCapture']['terminalInvalidReasons']);self.assertIn('sealed-with-unresolved-capture',result['responseCapture']['terminalInvalidReasons']);json.dumps(result,allow_nan=False)
 def test_finalize_inside_body_never_recovers_on_late_return(self):
  ledger,assets=t.setup();t.complete(ledger,assets);results=[]
  def callback():results.append(ledger.finalize())
  _,r=t.emit(ledger,D.REMOTE_URLS[0],b'sdk:'+D.REMOTE_URLS[0].encode(),callback=callback)
  results.extend([ledger.finalize(),ledger.finalize()]);self.assertEqual(r.calls,1)
  self.assertTrue(all(not s['networkValid'] for s in results));self.assertTrue(results[0]['responseCapture']['reentrantCapturePending']);self.assertFalse(results[-1]['responseCapture']['reentrantCapturePending']);self.assertIn('capture-returned-after-seal',results[-1]['responseCapture']['terminalInvalidReasons'])
 def test_idle_completed_seal_and_repeated_finalize_stay_valid(self):
  ledger,assets=t.setup();t.complete(ledger,assets);ledger.seal()
  for _ in range(3):self.assertTrue(ledger.finalize()['networkValid'])
 def test_incomplete_seal_cannot_be_completed_later(self):
  ledger,assets=t.setup();t.complete(ledger,assets);req,r=t.emit(ledger,D.REMOTE_URLS[0],b'x',finish=False);ledger.seal();ledger.finished(req)
  self.assertEqual(r.calls,0)
  for _ in range(3):self.assertFalse(ledger.finalize()['networkValid'])
 def test_same_response_object_failed_first_never_retried(self):
  ledger,assets=t.setup();t.complete(ledger,assets);life={'alive':False};req,r=t.emit(ledger,D.REMOTE_URLS[0],b'sdk:'+D.REMOTE_URLS[0].encode(),life)
  life['alive']=True;ledger.response(r);ledger.finished(req);result=ledger.finalize();self.assertEqual(r.calls,1);self.assertFalse(result['networkValid']);self.assertIn('duplicate-response-object',result['responseCapture']['terminalInvalidReasons'])
 def test_same_response_object_success_first_not_read_twice(self):
  ledger,assets=t.setup();t.complete(ledger,assets);req,r=t.emit(ledger,D.REMOTE_URLS[0],b'sdk:'+D.REMOTE_URLS[0].encode());ledger.response(r);ledger.finished(req)
  self.assertEqual(r.calls,1);self.assertFalse(ledger.finalize()['networkValid'])
 def test_distinct_same_url_objects_each_captured_once(self):
  ledger,assets=t.setup();t.complete(ledger,assets);responses=[]
  for _ in range(2):
   _,r=t.emit(ledger,D.REMOTE_URLS[0],b'sdk:'+D.REMOTE_URLS[0].encode());responses.append(r)
  self.assertIsNot(responses[0],responses[1]);self.assertEqual([r.calls for r in responses],[1,1]);self.assertTrue(ledger.finalize()['networkValid'])
 def test_main_unresolved_observer_stops_plan_without_replacement_trials(self):
  original=D.NetworkLedger.finalize
  def unresolved(ledger):
   result=original(ledger);result['networkValid']=False;result['responseCapture']['reentrantCapturePending']=True;return result
  with fixture() as (h,root),patch.object(D.NetworkLedger,'finalize',unresolved):
   self.assertEqual(D.main(),1);summary=json.loads((root/'test-results/animation-contention/summary.json').read_text());self.assertEqual(h.launch_count,1);self.assertEqual(h.close_count,1);self.assertFalse(summary['comparisonValid']);self.assertEqual(summary['planIncompleteReason'],'observer-capture-unresolved-after-finalization');self.assertEqual([r['status'] for r in summary['plannedTrials']][1:],['unexecuted']*3)
 def test_finalized_invalid_is_sticky_even_if_internal_snapshot_fields_change(self):
  ledger,assets=t.setup();t.complete(ledger,assets);ledger.overflow=True;self.assertFalse(ledger.finalize()['networkValid']);ledger.overflow=False
  self.assertFalse(ledger.finalize()['networkValid']);self.assertIn('finalized-invalid',ledger.invalid_reasons)

if __name__=='__main__':unittest.main()
