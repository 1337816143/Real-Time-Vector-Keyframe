"""Synthetic only: no real /proc reads, browsers, model or CI executions."""
import ast
import importlib.util
import json
from pathlib import Path
import unittest

MODULE = Path(__file__).resolve().parents[1] / 'scripts/runner_snapshot.py'
spec = importlib.util.spec_from_file_location('snapshot', MODULE)
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)


def stat(pid=101, name='chrome', ppid=100, start=10000, rss=20):
    fields = ['0'] * 50
    fields[0], fields[1] = 'S', str(ppid)
    fields[11], fields[12], fields[19], fields[21] = '250', '50', str(start), str(rss)
    return str(pid) + ' (' + name + ') ' + ' '.join(fields)


class Fake:
    def __init__(self):
        self.data = {
            '/proc/cpuinfo': 'model name : Synthetic CPU\nserial : DO_NOT_EXPORT\n',
            '/proc/pressure/cpu': 'some avg10=2.5 avg60=1 avg300=0.5 total=42 SECRET=DO_NOT_EXPORT\nfull avg10=0 avg60=0 avg300=0 total=0',
            '/proc/self/cgroup': '0::/runner-group',
            '/sys/fs/cgroup/runner-group/cpu.max': '200000 100000',
            '/sys/fs/cgroup/runner-group/cpu.stat': 'usage_usec 1000\nnr_throttled 1\nthrottled_usec 20\nsecret DO_NOT_EXPORT',
            '/proc/uptime': '150.5 10', '/proc/loadavg': '1.0 2.0 3.0 1/99 100',
            '/proc/101/stat': stat(), '/proc/101/status': 'Name:\tchrome\nPid:\t101\nUid:\t1001\t1001\t1001\t1001\nSecret:\tDO_NOT_EXPORT',
        }
        self.ids = ['101']
        self.reads = []

    def read(self, path):
        self.reads.append(path)
        if path not in self.data:
            raise FileNotFoundError(path)
        return self.data[path]

    def pids(self):
        return self.ids


def collect(fake):
    return snapshot.collect(fake, uid=1001, own_pid=999,
                            logical_cpus=4, affinity_cpus=2,
                            clock_ticks=100, page_size=4096,
                            utc='2026-10-06T00:00:00Z', monotonic_seconds=10)


class SafetyTests(unittest.TestCase):
    def test_allowlisted_fields_and_units(self):
        f = Fake(); r = collect(f)
        self.assertEqual(r['cpuModels'], ['Synthetic CPU'])
        self.assertEqual(r['loadAverage1m5m15m'], [1, 2, 3])
        self.assertEqual(r['cgroup']['localQuotaMicros'], 200000)
        self.assertEqual(r['processes'][0]['elapsedSeconds'], 50.5)
        self.assertEqual(r['processes'][0]['cpuSeconds'], 3)
        self.assertEqual(r['processes'][0]['rssBytes'], 81920)
        self.assertEqual(set(r['processes'][0]), {'pid','ppid','processName','state','startTicks','elapsedSeconds','cpuSeconds','rssBytes','category'})
        self.assertNotIn('DO_NOT_EXPORT', json.dumps(r))
        self.assertTrue(all(not any(x in p for x in ('cmdline','environ','/exe','/fd')) for p in f.reads))

    def test_other_user_filtered(self):
        f = Fake(); f.data['/proc/101/status'] = 'Pid:\t101\nUid:\t1002\t1002\t1002\t1002'
        self.assertEqual(collect(f)['processes'], [])

    def test_unknown_name_filtered_before_status(self):
        f = Fake(); f.data['/proc/101/stat'] = stat(name='unknown-secret')
        self.assertEqual(collect(f)['processes'], [])
        self.assertNotIn('/proc/101/status', f.reads)

    def test_collector_itself_excluded(self):
        f = Fake(); f.ids = ['999']; self.assertEqual(collect(f)['processes'], [])
        self.assertFalse(any('/999/' in path for path in f.reads))

    def test_process_race_and_invalid_stat(self):
        f = Fake(); f.ids += ['102', '103', 'invalid', '../escape']
        f.data['/proc/103/stat'] = '103 (chrome) S broken'
        f.data['/proc/103/status'] = 'Pid:\t101\nUid:\t1001'
        r = collect(f)
        self.assertEqual(r['processReadRacesOrDenied'], 1)
        self.assertEqual(r['malformedProcessesSkipped'], 1)
        self.assertEqual(len(r['processes']), 1)
        self.assertFalse(any('escape' in p for p in f.reads))

    def test_quota_missing_is_unknown_not_unlimited(self):
        f = Fake(); del f.data['/sys/fs/cgroup/runner-group/cpu.max']
        r = collect(f); self.assertIsNone(r['cgroup']['localMaxToken'])
        self.assertIn('cgroupCpuMax', r['missing'])

    def test_unlimited_requires_explicit_max(self):
        f = Fake(); f.data['/sys/fs/cgroup/runner-group/cpu.max'] = 'max 100000'
        r = collect(f); self.assertTrue(r['cgroup']['localMaxToken'])
        self.assertIsNone(r['cgroup']['localQuotaMicros'])

    def test_cgroup_path_traversal_rejected(self):
        f = Fake(); f.data['/proc/self/cgroup'] = '0::/../../credentials'
        r = collect(f); self.assertIn('cgroupMembership:unsafe-path', r['missing'])
        self.assertFalse(any(p.startswith('/sys/') for p in f.reads))

    def test_v1_reported_unsupported(self):
        f = Fake(); f.data['/proc/self/cgroup'] = '2:cpu:/runner'
        r = collect(f); self.assertEqual(r['cgroup']['mode'], 'unknown')
        self.assertIn('cgroupMembership:unsupported-or-missing-v2', r['missing'])

    def test_missing_and_malformed_metadata_preserved(self):
        f = Fake(); f.data['/proc/loadavg'] = 'broken'
        f.data['/sys/fs/cgroup/runner-group/cpu.max'] = 'broken'
        del f.data['/proc/pressure/cpu']
        r = collect(f); self.assertIsNone(r['loadAverage1m5m15m'])
        self.assertIsNone(r['cpuPressure'])
        self.assertIsNone(r['cgroup']['localMaxToken'])
        self.assertTrue(r['missing'])

    def test_uptime_missing_preserves_process_without_fake_duration(self):
        f = Fake(); del f.data['/proc/uptime']
        self.assertIsNone(collect(f)['processes'][0]['elapsedSeconds'])

    def test_runtime_names_are_not_claimed_browser_ownership(self):
        f = Fake(); f.data['/proc/101/stat'] = stat(name='node')
        self.assertEqual(collect(f)['processes'][0]['category'], 'runtime-possible-browser-parent')

    def test_nonfinite_or_incomplete_numbers_become_missing(self):
        for raw in ('nan 2 3', 'inf 2 3', '1 2', '-1 2 3', ''):
            f = Fake(); f.data['/proc/loadavg'] = raw
            self.assertIsNone(collect(f)['loadAverage1m5m15m'])

    def test_bad_quota_and_negative_process_values_are_rejected(self):
        f = Fake(); f.data['/sys/fs/cgroup/runner-group/cpu.max'] = '-1 100000'
        f.data['/proc/101/stat'] = stat(rss=-3)
        r = collect(f); self.assertIsNone(r['cgroup']['localQuotaMicros'])
        self.assertIsNone(r['cgroup']['localMaxToken']); self.assertEqual(r['processes'], [])

    def test_process_state_is_not_an_arbitrary_string(self):
        f = Fake(); f.data['/proc/101/stat'] = stat().replace(') S ', ') DO_NOT_EXPORT ')
        r = collect(f); self.assertEqual(r['processes'], [])
        self.assertNotIn('DO_NOT_EXPORT', json.dumps(r))

    def test_no_network_process_or_environment_apis(self):
        tree = ast.parse(MODULE.read_text())
        imports = {alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names}
        self.assertEqual(imports, {'json','math','os','sys','time'})
        attributes = {node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute)}
        self.assertFalse(attributes & {'environ','getenv','system','popen','kill','killpg','readlink','execv','spawnv'})
        names = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
        self.assertFalse(names & {'subprocess','socket','urllib','requests'})


if __name__ == '__main__':
    unittest.main()
