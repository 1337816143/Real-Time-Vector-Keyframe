"""Synthetic -O/-OO regressions. No browser, network, metadata scan or CI."""
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import unittest
import test_raw_sequence as t

CHILD=r'''
import hashlib,json,tempfile
from pathlib import Path
import test_raw_sequence as t
cases=[]
for i,change in enumerate(({'initMs':30000},{'inferenceMs':250},{'landmarkCount':478},{'frameId':2},{'bitmapTransferred':False})):
 r,p,o,e=t.execute(changes={False:change})
 cases.append({'kind':'default','i':i,'calls':p.calls,'completed':r['rawLoopCompleted'],'statuses':r['stageStatus'],'progressBeforeFailure':e[1]==('write','progress.json','raw-default',1)})
for i,change in enumerate(({'initMs':30000},{'inferenceMs':250},{'landmarkCount':478},{'frameId':2},{'bitmapTransferred':False},{'delegate':'GPU'},{'gpuFailure':None})):
 r,p,o,e=t.execute(changes={True:change})
 cases.append({'kind':'forced','i':i,'calls':p.calls,'completed':r['rawLoopCompleted'],'statuses':r['stageStatus'],'progressBeforeFailure':e[3]==('write','progress.json','raw-forced-fallback',2)})
r,p,o,e=t.execute();success={'calls':p.calls,'completed':r['rawLoopCompleted'],'passed':r['rawSubsequencePassed']}
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp);(root/'scripts').mkdir();(root/t.d.MANIFEST_PATH).write_text('{}')
 try:t.d.read_approved_manifest(root);manifestRejected=False
 except ValueError:manifestRejected=True
 source=root/'changed.py';source.write_text(t.ORIGINAL.read_text().replace('30000','31000'))
 try:t.d.load_raw_protocol(source);sourceRejected=False
 except ValueError:sourceRejected=True
 # Change only the module's local filename to select a synthetic invalid helper;
 # never modify the frozen helper or use a runtime assert as the rejection check.
 old=t.d.__file__;t.d.__file__=str(root/'driver.py');(root/'face_failure_reporting.py').write_text('raise RuntimeError("must not execute")')
 try:t.d.load_reporter();reporterRejected=False
 except ValueError:reporterRejected=True
 finally:t.d.__file__=old
code=t.PROTOCOL['code'];fingerprint=hashlib.sha256(code.co_code+repr(code.co_consts).encode()).hexdigest()
print(json.dumps({'optimize':__import__('sys').flags.optimize,'cases':cases,'success':success,'manifestRejected':manifestRejected,'sourceRejected':sourceRejected,'reporterRejected':reporterRejected,'codeFingerprint':fingerprint}))
'''

class OptimizationTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.results=[]
  tests=str(Path(__file__).resolve().parent)
  code='import sys;sys.path.insert(0,'+repr(tests)+')\n'+CHILD
  for flags in ([],['-O'],['-OO']):
   result=subprocess.run([sys.executable,*flags,'-c',code],text=True,capture_output=True,check=True)
   cls.results.append(json.loads(result.stdout))
 def test_every_default_assertion_stops_fallback_in_all_modes(self):
  self.assertEqual([r['optimize'] for r in self.results],[0,1,2])
  for result in self.results:
   for case in result['cases']:
    if case['kind']=='default':
     with self.subTest(mode=result['optimize'],case=case['i']):
      self.assertEqual(case['calls'],[False]);self.assertFalse(case['completed']);self.assertEqual(case['statuses']['raw-default'],'failed_in_phase');self.assertEqual(case['statuses']['raw-forced-fallback'],'not_executed');self.assertTrue(case['progressBeforeFailure'])
 def test_forced_assertions_remain_active_in_all_modes(self):
  for result in self.results:
   for case in result['cases']:
    if case['kind']=='forced':
     with self.subTest(mode=result['optimize'],case=case['i']):
      self.assertEqual(case['calls'],[False,True]);self.assertFalse(case['completed']);self.assertEqual(case['statuses']['raw-default'],'passed');self.assertEqual(case['statuses']['raw-forced-fallback'],'failed_in_phase');self.assertTrue(case['progressBeforeFailure'])
 def test_normal_and_optimized_compiled_protocol_are_identical(self):
  self.assertEqual(len({r['codeFingerprint'] for r in self.results}),1)
  for r in self.results:self.assertEqual(r['success'],{'calls':[False,True],'completed':True,'passed':True})
 def test_preflight_rejections_cannot_be_elided(self):
  for r in self.results:
   self.assertTrue(r['manifestRejected']);self.assertTrue(r['sourceRejected']);self.assertTrue(r['reporterRejected'])
 def test_production_guards_do_not_use_assert_statements(self):
  files=[t.ROOT/'scripts/face_animation_contention.py',t.ROOT/'scripts/face_failure_reporting.py',t.ROOT.parent/'verify-observation-draft/frozen-r1/scripts/runner_snapshot.py']
  for file in files:
   if not file.exists() and file.name=='runner_snapshot.py':file=t.ROOT/'scripts/runner_snapshot.py'
   self.assertTrue(file.exists(),str(file));tree=ast.parse(file.read_text());self.assertFalse(any(isinstance(n,ast.Assert) for n in ast.walk(tree)),str(file));self.assertFalse(any(isinstance(n,ast.Name) and n.id=='__debug__' for n in ast.walk(tree)),str(file))
  tree=ast.parse((t.ROOT/'scripts/face_animation_contention.py').read_text());calls=[n for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='compile'];self.assertEqual(len(calls),1);self.assertTrue(any(k.arg=='optimize' and isinstance(k.value,ast.Constant) and k.value.value==0 for k in calls[0].keywords))

if __name__=='__main__':unittest.main()
