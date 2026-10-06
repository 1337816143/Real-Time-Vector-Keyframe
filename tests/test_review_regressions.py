"""Correctness regressions for the independent review's synthetic counterexamples."""
import json
import unittest
from unittest.mock import patch
import test_runner_snapshot as t


class ReviewRegressions(unittest.TestCase):
    def test_current_max_has_only_local_meaning(self):
        f = t.Fake(); f.data['/proc/self/cgroup'] = '0::/parent/child'
        f.data['/sys/fs/cgroup/parent/child/cpu.max'] = 'max 100000'
        f.data['/sys/fs/cgroup/parent/child/cpu.stat'] = 'usage_usec 10'
        f.data['/sys/fs/cgroup/parent/cpu.max'] = '50000 100000'
        r = t.collect(f)['cgroup']
        self.assertTrue(r['localMaxToken']); self.assertNotIn('unlimited', r)
        self.assertEqual(r['scope'], 'current-cgroup-only')
        self.assertEqual(r['effectiveQuota'], 'unknown'); self.assertFalse(r['ancestorsObserved'])
        self.assertNotIn('/sys/fs/cgroup/parent/cpu.max', f.reads)

    def test_empty_pressure_marks_each_missing_field(self):
        f = t.Fake(); f.data['/proc/pressure/cpu'] = ''
        r = t.collect(f); self.assertIsNone(r['cpuPressure'])
        for kind in ('some','full'):
            for key in ('avg10','avg60','avg300','total'):
                self.assertIn('cpuPressure:'+kind+':'+key, r['missing'])

    def test_unknown_only_pressure_is_not_a_populated_row(self):
        f = t.Fake(); f.data['/proc/pressure/cpu'] = 'some unknown=1'
        r = t.collect(f); self.assertIsNone(r['cpuPressure'])
        self.assertIn('cpuPressure:some:avg10', r['missing'])

    def test_empty_cgroup_stat_marks_each_missing_counter(self):
        f = t.Fake(); f.data['/sys/fs/cgroup/runner-group/cpu.stat'] = ''
        r = t.collect(f); self.assertIsNone(r['cgroup']['stats'])
        for key in t.snapshot.CPU_STAT_KEYS:
            self.assertIn('cgroupCpuStat:'+key, r['missing'])

    def test_pid_reuse_drops_old_counters(self):
        class Reused(t.Fake):
            def read(self, path):
                result = super().read(path)
                if path == '/proc/101/stat':
                    self.data['/proc/101/status'] = 'Pid:\t101\nUid:\t1001\t1001\t1001\t1001'
                    self.data['/proc/101/stat'] = t.stat(start=14000,rss=1)
                return result
        f = Reused(); f.data['/proc/101/status'] = 'Pid:\t101\nUid:\t1002\t1002\t1002\t1002'
        r = t.collect(f); self.assertFalse(r['processes'])
        self.assertIn('processIdentityChanged',r['missing'])
        self.assertEqual(f.reads.count('/proc/101/stat'),2)

    def test_uid_changes_between_status_reads_are_dropped(self):
        class Changed(t.Fake):
            def read(self,path):
                result = super().read(path)
                if path == '/proc/101/status':
                    self.data[path] = 'Pid:\t101\nUid:\t1002\t1002\t1002\t1002'
                return result
        r = t.collect(Changed()); self.assertFalse(r['processes'])
        self.assertIn('processIdentityChanged',r['missing'])

    def test_status_pid_must_match_stat_and_requested_pid(self):
        f = t.Fake(); f.data['/proc/101/status'] = 'Pid:\t102\nUid:\t1001\t1001\t1001\t1001'
        r = t.collect(f); self.assertFalse(r['processes'])
        self.assertIn('processIdentityChanged',r['missing'])

    def test_extreme_pressure_isolated_valid_fields_retained(self):
        f = t.Fake(); f.data['/proc/pressure/cpu'] = 'some avg10=2 total='+'9'*400
        r = t.collect(f); self.assertEqual(r['cpuPressure']['some']['avg10'],2)
        self.assertNotIn('total',r['cpuPressure']['some'])
        self.assertIn('cpuPressure:some:total:malformed',r['missing'])
        self.assertTrue(r['processes'])

    def test_extreme_stat_isolated_other_values_preserved(self):
        f = t.Fake(); f.data['/sys/fs/cgroup/runner-group/cpu.stat'] = 'usage_usec '+'9'*400+'\nuser_usec 30'
        r = t.collect(f); self.assertEqual(r['cgroup']['stats'],{'user_usec':30})
        self.assertIn('cgroupCpuStat:usage_usec:malformed',r['missing'])
        self.assertTrue(r['processes'])

    def test_future_start_is_unknown_not_zero(self):
        f = t.Fake(); f.data['/proc/101/stat'] = t.stat(start=20000)
        r = t.collect(f); self.assertIsNone(r['processes'][0]['elapsedSeconds'])
        self.assertIn('processElapsed:futureStart',r['missing'])

    def test_path_injection_never_escapes_base(self):
        for membership in ('0::relative','0::/safe/../escape','0::/a\n0::/b'):
            f=t.Fake();f.data['/proc/self/cgroup']=membership;r=t.collect(f)
            self.assertIsNone(r['cgroup']['localMaxToken'])
            self.assertFalse(any(p.startswith('/sys/') for p in f.reads))

    def test_names_are_exact_not_arbitrary_text(self):
        for name in ('chrome --secret','chrome-secret','chrome) secret','Chrome','chromium-browser'):
            f=t.Fake();f.data['/proc/101/stat']=t.stat(name=name)
            self.assertFalse(t.collect(f)['processes'])

    def test_invalid_and_partial_uids_excluded(self):
        for status in ('Uid:\tnan','Uid:\t-1','NoUid: 1001','Uid:\t1001','Uid:\t1001\t1002\t1001\t1001'):
            f=t.Fake();f.data['/proc/101/status']='Pid:\t101\n'+status
            self.assertFalse(t.collect(f)['processes'])

    def test_bad_quota_is_explicitly_unknown(self):
        for raw in ('nan 100000','inf 100000','max 0','0 100000','1 -2','max 100000 extra','9'*400+' 100000'):
            f=t.Fake();f.data['/sys/fs/cgroup/runner-group/cpu.max']=raw;r=t.collect(f)
            self.assertIsNone(r['cgroup']['localMaxToken'])
            self.assertIn('cgroupCpuMax:malformed',r['missing'])

    def test_empty_model_and_unknown_affinity_marked(self):
        f=t.Fake();f.data['/proc/cpuinfo']='serial : DO_NOT_EXPORT'
        r=t.snapshot.collect(f,uid=1001,own_pid=999,logical_cpus=None,affinity_cpus=None,clock_ticks=100,page_size=4096,utc='fixed',monotonic_seconds=1)
        for name in ('cpuModel:empty','affinityCpus','logicalCpus'):
            self.assertIn(name,r['missing'])

    def test_top_level_failure_still_writes_safe_phase_artifact(self):
        written=[]
        class Output:
            def __init__(self,*args): pass
            def __truediv__(self,name): return self
            def mkdir(self,**kwargs): pass
            def write_text(self,text): written.append(text)
        with patch.object(t.snapshot,'Path',Output), patch.object(t.snapshot,'Source',return_value=t.Fake()), patch.object(t.snapshot,'collect',side_effect=RuntimeError('DO_NOT_EXPORT')), patch.object(t.snapshot.sys,'argv',['snapshot','before-face-worker']), patch.object(t.snapshot.os,'getuid',return_value=1001), patch.object(t.snapshot.os,'getpid',return_value=999), patch.object(t.snapshot.os,'cpu_count',return_value=4), patch.object(t.snapshot.os,'sched_getaffinity',return_value={0,1}), patch.object(t.snapshot.os,'sysconf',return_value=100), patch.object(t.snapshot.time,'strftime',return_value='fixed'), patch.object(t.snapshot.time,'gmtime',return_value=None), patch.object(t.snapshot.time,'monotonic',return_value=1):
            self.assertEqual(t.snapshot.main(),1)
        self.assertEqual(len(written),1);self.assertNotIn('DO_NOT_EXPORT',written[0])
        self.assertEqual(json.loads(written[0])['missing'],['snapshotCollectionFailed'])
        self.assertEqual(json.loads(written[0])['phase'],'before-face-worker')

if __name__ == '__main__': unittest.main()
