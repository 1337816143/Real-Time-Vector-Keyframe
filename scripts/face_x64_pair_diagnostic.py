"""Manual-only same-runner comparison; never a release or tested-dist producer.

This driver runs existing source tests unchanged. It does not alter budgets,
warmup attempts, delegates, dimensions, browser flags, models or dependencies.
Only allowlisted public runner metadata is read; no environment dump or IMDS.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import signal
import shutil
import subprocess
import sys
import time

BASELINE = '80c4cac13716caf177d8737a66919a477b1e83e8'
CANDIDATE = 'b07328628967735c0e7538ef61c2102d4cd85280'
IDENTITY_PATHS = [
    'package-lock.json', 'package.json', '.github/workflows/ci.yml',
    'src/engine/face.worker.ts', 'src/engine/faceTask.ts',
    'src/engine/facePolicy.ts', 'src/engine/faceTracking.ts',
    'tests/face_worker.py', 'tests/face_benchmark.py',
    'tests/face_benchmark.worker.ts', 'tests/face_pipeline_entry.ts',
]


def read_public(path):
    try:
        return Path(path).read_text().strip()
    except OSError:
        return None


def snapshot():
    models = set()
    for line in (read_public('/proc/cpuinfo') or '').splitlines():
        key, sep, value = line.partition(':')
        if sep and key.strip() in ['model name', 'Hardware', 'CPU architecture']:
            models.add(value.strip())
    return {
        'utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'architecture': platform.machine(), 'kernel': platform.release(),
        'cpuModels': sorted(models), 'logicalCpus': os.cpu_count(),
        'affinityCpus': len(os.sched_getaffinity(0)) if hasattr(os, 'sched_getaffinity') else None,
        'loadAverage1m5m15m': list(os.getloadavg()),
        'cgroupCpuMax': read_public('/sys/fs/cgroup/cpu.max'),
        'cgroupCpuStat': read_public('/sys/fs/cgroup/cpu.stat'),
        'cpuPressure': read_public('/proc/pressure/cpu'),
    }


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_step(name, command, cwd, output, timeout, report):
    log = output / (name + '.log')
    before = snapshot()
    start = time.monotonic()
    code = 125
    error = None
    try:
        with log.open('w') as handle:
            process = subprocess.Popen(command, cwd=cwd, stdout=handle,
                                       stderr=subprocess.STDOUT, start_new_session=True)
            try:
                code = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                # Clean only this step's own process group, including its browser.
                # Leaving an orphan would contaminate the other revision's measurement.
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
                except ProcessLookupError:
                    pass
                finally:
                    # The parent may exit before a descendant. Reap any survivors.
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait(timeout=5)
                raise
    except subprocess.TimeoutExpired:
        code = 124
        error = 'Timed out; this step is failed, never accepted'
    except OSError as exc:
        error = str(exc)
    row = {'step': name, 'command': command, 'returnCode': code, 'error': error,
           'elapsedSeconds': time.monotonic() - start, 'before': before,
           'after': snapshot(), 'log': log.name}
    report['steps'].append(row)
    (output / 'steps.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'step': name, 'returnCode': code,
                      'elapsedSeconds': row['elapsedSeconds']}), flush=True)
    return code == 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    summary = {
        'classification': 'DIAGNOSTIC ONLY: does not replace original CI acceptance',
        'baseline': BASELINE, 'candidate': CANDIDATE,
        'order': ['baseline', 'candidate'], 'formalPasses': {}, 'steps': [],
        'publicRunnerMetadata': {key: os.environ.get(key) for key in
                                 ['RUNNER_OS', 'RUNNER_ARCH', 'ImageOS', 'ImageVersion',
                                  'GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']},
        'azureRegion': {'value': None, 'source': 'This run: Set up job / Runner Image Provisioner / Azure Region',
                        'note': 'Review the existing GitHub runner header; no IMDS or environment-secret access'},
        'pythonVersion': platform.python_version(),
        'nodeVersion': subprocess.check_output(['node', '--version'], text=True).strip(),
        'npmVersion': subprocess.check_output(['npm', '--version'], text=True).strip(),
        'playwrightVersion': importlib.metadata.version('playwright'),
        'initialRunner': snapshot(),
        'limits': ['One formal run per revision; no retry-until-green',
                   'Sequential order can be affected by host drift; it is not causal proof by itself',
                   'Runtime CDN WASM/model response body hashes are not exposed by unchanged tests',
                   'No real camera, device or thermal acceptance',
                   'No tested-dist artifact is produced or uploaded'],
    }
    sources = {'baseline': (args.baseline.resolve(), BASELINE),
               'candidate': (args.candidate.resolve(), CANDIDATE)}
    identity = {}
    setup_ok = True
    try:
        # Verify both exact commits before running any installation or test.
        for label, (path, expected) in sources.items():
            actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=path, text=True).strip()
            if actual != expected:
                raise RuntimeError(f'{label} commit mismatch: {actual}')
            identity[label] = {'commit': actual,
                               'files': {p: sha(path / p) for p in IDENTITY_PATHS}}
        for p in IDENTITY_PATHS:
            if identity['baseline']['files'][p] != identity['candidate']['files'][p]:
                raise RuntimeError(f'Unexpected control drift in {p}; stop before comparison')
        # Finish both builds before formal timing so diagnostic load never separates the pair.
        for label, (path, _) in sources.items():
            for suffix, command, timeout in [
                ('install', ['npm', 'ci'], 120), ('unit', ['npm', 'test'], 60),
                ('build', ['npm', 'run', 'build'], 60),
                ('fixtures', ['npm', 'run', 'test:gpu:fixture'], 60),
            ]:
                if not run_step(label + '-' + suffix, command, path, output, timeout, summary):
                    setup_ok = False
                    break
            if not setup_ok:
                break
            workers = list((path / 'dist/assets').glob('face.worker-*.js'))
            if len(workers) != 1:
                raise RuntimeError(f'{label}: expected one built Face Worker')
            identity[label]['builtWorkerSha256'] = sha(workers[0])
        if not setup_ok:
            raise RuntimeError('Preparation failed; no paired inference claim is possible')
        if identity['baseline']['builtWorkerSha256'] != identity['candidate']['builtWorkerSha256']:
            raise RuntimeError('Unexpected built Worker drift; stop before comparison')
        (output / 'identity.json').write_text(json.dumps(identity, indent=2) + '\n')
        for label, (path, _) in sources.items():
            summary['formalPasses'][label] = run_step(
                label + '-formal-face-worker', [sys.executable, 'tests/face_worker.py'],
                path, output, 120, summary)
        # Reuse the existing failure-only A/B/A input-kind benchmark, after the formal pair.
        for label, (path, _) in sources.items():
            if not summary['formalPasses'][label]:
                run_step(label + '-failure-diagnostic', [sys.executable, 'tests/face_benchmark.py'],
                         path, output, 180, summary)
    except Exception as exc:
        summary['driverError'] = str(exc)
    finally:
        for label, (path, _) in sources.items():
            for folder in ['face-worker', 'face-benchmark']:
                source = path / 'test-results' / folder
                if source.exists():
                    shutil.copytree(source, output / label / folder, dirs_exist_ok=True)
        summary['finalRunner'] = snapshot()
        (output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    # Failure-only diagnostics can never turn a failed original test green.
    return 0 if (not summary.get('driverError') and
                 summary['formalPasses'] == {'baseline': True, 'candidate': True}) else 1


if __name__ == '__main__':
    sys.exit(main())
