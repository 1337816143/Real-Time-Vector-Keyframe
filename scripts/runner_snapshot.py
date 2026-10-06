"""Diagnostic-only allowlisted Linux runner snapshot; never an acceptance test.

No network, subprocesses, environment variables, command lines, executable-path
links, process signaling or system changes. /proc process names are truncated
kernel comm names, not verified executable paths or proof of browser ownership.
"""
import json
import math
import os
from pathlib import Path, PurePosixPath
import sys
import time

PHASES = ('before-browser-tests', 'before-face-worker', 'after-face-worker')
NAMES = frozenset(('chrome', 'chromium', 'headless_shell', 'chrome-headless',
                   'chrome_crashpad', 'playwright', 'node', 'python', 'python3',
                   'python3.12', 'python3.13', 'python3.14'))
CPU_STAT_KEYS = frozenset(('usage_usec', 'user_usec', 'system_usec', 'nr_periods',
                          'nr_throttled', 'throttled_usec', 'nr_bursts', 'burst_usec'))


class Source:
    def read(self, path):
        return Path(path).read_text()

    def pids(self):
        return [p.name for p in Path('/proc').iterdir() if p.name.isdecimal()]


def collect(source, *, uid, own_pid, logical_cpus, affinity_cpus, clock_ticks,
            page_size, utc, monotonic_seconds):
    missing = []

    def read(path, label):
        try:
            return source.read(path)
        except (OSError, UnicodeError):
            missing.append(label)
            return None

    def numbers(path, label, count):
        raw = read(path, label)
        try:
            if raw is None:
                return None
            values = [float(v) for v in raw.split()[:count]]
            if len(values) != count or any(not math.isfinite(v) or v < 0 for v in values):
                raise ValueError('Malformed numeric fields')
            return values
        except (ValueError, AttributeError):
            missing.append(label + ':malformed')
            return None

    models = sorted({line.partition(':')[2].strip()
                     for line in (read('/proc/cpuinfo', 'cpuModel') or '').splitlines()
                     if line.partition(':')[0].strip() in ('model name', 'Hardware')})
    if not models or models == ['']:
        models = []
        missing.append('cpuModel:empty')
    if affinity_cpus is None:
        missing.append('affinityCpus')
    if logical_cpus is None:
        missing.append('logicalCpus')
    pressure = {}
    for line in (read('/proc/pressure/cpu', 'cpuPressure') or '').splitlines():
        fields = line.split()
        if not fields or fields[0] not in ('some', 'full'):
            continue
        row = {}
        for field in fields[1:]:
            key, _, value = field.partition('=')
            if key in ('avg10', 'avg60', 'avg300', 'total'):
                try:
                    number = int(value) if key == 'total' else float(value)
                    if (key == 'total' and not 0 <= number <= 2**64 - 1) or (key != 'total' and (not math.isfinite(number) or not 0 <= number <= 100)):
                        raise ValueError('Malformed pressure')
                    row[key] = number
                except (ValueError, OverflowError):
                    missing.append('cpuPressure:' + fields[0] + ':' + key + ':malformed')
        if row:
            pressure[fields[0]] = row
    for kind in ('some', 'full'):
        for key in ('avg10', 'avg60', 'avg300', 'total'):
            if key not in pressure.get(kind, {}):
                missing.append('cpuPressure:' + kind + ':' + key)

    cgroup = {'mode': 'unknown', 'scope': 'current-cgroup-only',
              'localQuotaMicros': None, 'localPeriodMicros': None,
              'localMaxToken': None, 'effectiveQuota': 'unknown',
              'ancestorsObserved': False, 'stats': None}
    membership = read('/proc/self/cgroup', 'cgroupMembership')
    if membership is not None:
        unified = [line[3:] for line in membership.splitlines() if line.startswith('0::')]
        if len(unified) == 1:
            relative = PurePosixPath(unified[0])
            if relative.is_absolute() and '..' not in relative.parts:
                root = '/sys/fs/cgroup' + (str(relative) if str(relative) != '/' else '')
                cgroup['mode'] = 'v2'
                raw = read(root + '/cpu.max', 'cgroupCpuMax')
                try:
                    quota, period = raw.split() if raw is not None else (None, None)
                    if quota is not None:
                        q, p = None if quota == 'max' else int(quota), int(period)
                        if not 0 < p <= 2**64 - 1 or (q is not None and not 0 < q <= 2**64 - 1):
                            raise ValueError('Malformed quota')
                        cgroup.update(localQuotaMicros=q, localPeriodMicros=p, localMaxToken=quota == 'max')
                except (ValueError, TypeError, OverflowError):
                    missing.append('cgroupCpuMax:malformed')
                stats = {}
                raw = read(root + '/cpu.stat', 'cgroupCpuStat')
                for line in (raw or '').splitlines():
                    fields = line.split()
                    if len(fields) == 2 and fields[0] in CPU_STAT_KEYS:
                        try:
                            number = int(fields[1])
                            if not 0 <= number <= 2**64 - 1:
                                raise ValueError('Malformed counter')
                            stats[fields[0]] = number
                        except (ValueError, OverflowError):
                            missing.append('cgroupCpuStat:' + fields[0] + ':malformed')
                for key in CPU_STAT_KEYS:
                    if key not in stats:
                        missing.append('cgroupCpuStat:' + key)
                cgroup['stats'] = stats or None
            else:
                missing.append('cgroupMembership:unsafe-path')
        else:
            missing.append('cgroupMembership:unsupported-or-missing-v2')

    uptime = numbers('/proc/uptime', 'uptime', 1)
    process_rows = []
    vanished = 0
    rejected = 0
    try:
        pids = source.pids()
    except OSError:
        pids = []
        missing.append('processEnumeration')
    for value in pids:
        if not str(value).isdecimal() or int(value) == own_pid:
            continue
        pid = int(value)
        try:
            # stat exposes numeric counters and kernel comm, never command args.
            stat = source.read('/proc/' + str(pid) + '/stat')
            left, right = stat.find('('), stat.rfind(')')
            name = stat[left + 1:right]
            if left < 0 or right <= left or name not in NAMES:
                continue
            status = source.read('/proc/' + str(pid) + '/status')
            def identity(stat_text, status_text):
                a, b = stat_text.find('('), stat_text.rfind(')')
                parts = stat_text[b + 2:].split()
                status_fields = {line.partition(':')[0]: line.partition(':')[2].split()
                                 for line in status_text.splitlines()
                                 if line.partition(':')[0] in ('Pid', 'Uid')}
                owners = tuple(int(v) for v in status_fields['Uid'])
                if len(owners) != 4:
                    raise ValueError('Malformed owner identity')
                return (int(stat_text[:a].strip()), int(status_fields['Pid'][0]),
                        stat_text[a + 1:b], int(parts[19]), owners)
            first = identity(stat, status)
            stat_check = source.read('/proc/' + str(pid) + '/stat')
            status_check = source.read('/proc/' + str(pid) + '/status')
            second = identity(stat_check, status_check)
            if first != second or first[0] != pid or first[1] != pid:
                missing.append('processIdentityChanged')
                vanished += 1
                continue
            if first[4] != (uid, uid, uid, uid):
                continue
            fields = stat[right + 2:].split()  # starts at field 3: state
            start_ticks = int(fields[19])
            ppid, user_ticks, system_ticks, rss_pages = (int(fields[n]) for n in (1, 11, 12, 21))
            if (int(stat[:left].strip()) != pid or fields[0] not in tuple('RSDZTWtXxIKP') or
                    min(start_ticks, ppid, user_ticks, system_ticks, rss_pages) < 0 or
                    max(start_ticks, ppid, user_ticks, system_ticks, rss_pages) > 2**64 - 1):
                raise ValueError('Malformed process counters')
            elapsed = uptime[0] - start_ticks / clock_ticks if uptime else None
            if elapsed is not None and elapsed < 0:
                elapsed = None
                missing.append('processElapsed:futureStart')
            process_rows.append({'pid': pid, 'ppid': ppid,
                                 'processName': name, 'state': fields[0],
                                 'startTicks': start_ticks,
                                 'elapsedSeconds': elapsed,
                                 'cpuSeconds': (user_ticks + system_ticks) / clock_ticks,
                                 'rssBytes': rss_pages * page_size,
                                 'category': 'runtime-possible-browser-parent' if name in ('node', 'playwright') or name.startswith('python') else 'browser-name-match'})
        except (OSError, UnicodeError):
            vanished += 1
            missing.append('processReadRaceOrDenied')
        except (ValueError, IndexError, KeyError, StopIteration, ZeroDivisionError, OverflowError):
            rejected += 1
            missing.append('processFieldsMalformed')
    return {'classification': 'DIAGNOSTIC ONLY; does not alter formal acceptance',
            'utc': utc, 'monotonicSeconds': monotonic_seconds,
            'cpuModels': models, 'logicalCpus': logical_cpus,
            'affinityCpus': affinity_cpus, 'loadAverage1m5m15m': numbers('/proc/loadavg', 'loadAverage', 3),
            'cpuPressure': pressure or None, 'cgroup': cgroup,
            'processes': sorted(process_rows, key=lambda row: row['pid']),
            'processReadRacesOrDenied': vanished, 'malformedProcessesSkipped': rejected,
            'missing': sorted(set(missing)),
            'limits': ['Kernel comm is an allowlisted name, not a verified executable path',
                       'Node/Python entries may be unrelated to browsers',
                       'Absence from a snapshot does not prove absence between snapshots',
                       'Current cgroup max is local only; ancestor/effective quota remains unknown',
                       'Repeated stat/status checks reject changed PID/start/UID; sampling is not atomic']}


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in PHASES:
        print('Snapshot phase missing or invalid', file=sys.stderr)
        return 2
    phase = sys.argv[1]
    try:
        try:
            affinity = len(os.sched_getaffinity(0))
        except (AttributeError, OSError):
            affinity = None
        result = collect(Source(), uid=os.getuid(), own_pid=os.getpid(),
                         logical_cpus=os.cpu_count(), affinity_cpus=affinity,
                         clock_ticks=os.sysconf('SC_CLK_TCK'), page_size=os.sysconf('SC_PAGE_SIZE'),
                         utc=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                         monotonic_seconds=time.monotonic())
        result['phase'] = phase
        out = Path('test-results/runner-observation')
        out.mkdir(parents=True, exist_ok=True)
        (out / (phase + '.json')).write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
        print('Saved diagnostic snapshot: ' + phase)
        return 0
    except Exception:
        fallback = {'classification': 'DIAGNOSTIC ONLY; does not alter formal acceptance',
                    'phase': phase, 'missing': ['snapshotCollectionFailed'],
                    'processes': [], 'cpuPressure': None, 'cgroup': None}
        try:
            out = Path('test-results/runner-observation')
            out.mkdir(parents=True, exist_ok=True)
            (out / (phase + '.json')).write_text(json.dumps(fallback, indent=2) + '\n')
        except Exception:
            print('Diagnostic fallback artifact unavailable', file=sys.stderr)
        print('Diagnostic snapshot unavailable', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
