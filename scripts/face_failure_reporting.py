"""Reporting-only: classify the structured failure record, never infer phase from text.

Unknown/inconsistent combinations stay unknown. Failure error timings are not
parsed into invented samples or used to reinterpret a production pass/fail.
"""
import argparse
import json
import math
from pathlib import Path

PHASES=('raw-default','raw-forced-fallback','product-blank','product-positive')

def number(value):
    try:
        return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)
    except (ValueError,OverflowError):
        return False

def raw_report_schema(report):
    """A report exists only after evaluate returned a complete ready/blank result.

    Validate structure and the production-ready warmup invariant independently
    of later formal assertions: a long init, nonblank result or failed transfer
    is still a legitimate current-phase assertion failure, not missing data.
    """
    required=('forcedGpuFactoryFailure','delegate','gpuFailure','warmupSamples','warmupMs',
              'initMs','inferenceMs','landmarkCount','frameId','bitmapTransferred')
    if not isinstance(report,dict) or any(key not in report for key in required):return False
    if type(report['forcedGpuFactoryFailure']) is not bool or type(report['bitmapTransferred']) is not bool:return False
    if report['delegate'] not in ('CPU','GPU') or (report['gpuFailure'] is not None and not isinstance(report['gpuFailure'],str)):return False
    if any(type(report[key]) is not int or not 0<=report[key]<=2**53-1 for key in ('landmarkCount','frameId')):return False
    if any(not number(report[key]) or report[key]<0 for key in ('initMs','inferenceMs','warmupMs')):return False
    samples=report['warmupSamples']
    if not isinstance(samples,list) or not 2<=len(samples)<=4 or any(not number(x) or x<0 for x in samples):return False
    if not all(x<=200 for x in samples[-2:]):return False
    if any(samples[i]<=200 and samples[i+1]<=200 for i in range(len(samples)-2)):return False
    return abs(report['warmupMs']-max(samples[-2:]))<=1e-6

def raw_report_passes(report,forced):
    if not raw_report_schema(report) or report['forcedGpuFactoryFailure'] is not forced:return False
    if forced and (report['delegate']!='CPU' or report['gpuFailure']!='Synthetic GPU factory failure'):return False
    return (report['initMs']<30000 and report['inferenceMs']<250 and
            report['landmarkCount']==0 and report['frameId']==1 and report['bitmapTransferred'] is True)

def pipeline_report_schema(report):
    return (isinstance(report,dict) and isinstance(report.get('status'),str) and bool(report['status']) and
            type(report.get('consecutiveFresh')) is int and 0<=report['consecutiveFresh']<=2**53-1)

def pipeline_report_passes(report,positive):
    return (pipeline_report_schema(report) and report.get('status')==('tracking' if positive else 'no-face') and
            number(report.get('consecutiveFresh')) and report['consecutiveFresh']>=3)

def summarize(data):
    phase=data.get('phase') if isinstance(data,dict) else None
    result={'classification':'unknown','source':'structured failure.json','failurePhase':phase if phase in PHASES else 'unknown',
            'stageStatus':{p:'unknown' for p in PHASES},'reason':None,
            'failedPhaseWarmupSamples':None,'failedSamplesPrecision':'not available; error text is display-only',
            'errorText':data.get('error') if isinstance(data,dict) and isinstance(data.get('error'),str) else None}
    def unknown(reason):result['reason']=reason;return result
    try:
        json.dumps(data,allow_nan=False)
    except (TypeError,ValueError,OverflowError):
        return unknown('non-json-or-nonfinite-record')
    if not isinstance(data,dict) or phase not in PHASES:return unknown('unrecognized-phase-or-record')
    if not isinstance(data.get('error'),str):return unknown('missing-failure-error')
    runs=data.get('observedRuns')
    if not isinstance(runs,list) or any(not raw_report_schema(r) for r in runs):return unknown('invalid-or-incomplete-observed-run')
    if 'productPipeline' not in data or 'positivePipeline' not in data:return unknown('missing-pipeline-state-fields')
    blank,positive=data['productPipeline'],data['positivePipeline']
    if any(x is not None and not pipeline_report_schema(x) for x in (blank,positive)):return unknown('invalid-or-incomplete-pipeline-report')
    index=PHASES.index(phase)
    if index==0:
        if len(runs)>1 or (runs and runs[0].get('forcedGpuFactoryFailure') is not False):return unknown('default-phase-run-count-or-mode-mismatch')
        if blank is not None or positive is not None:return unknown('later-pipeline-present-before-raw-completion')
    elif index==1:
        if not 1<=len(runs)<=2 or not raw_report_passes(runs[0],False):return unknown('fallback-phase-without-valid-completed-default')
        if len(runs)==2 and runs[1].get('forcedGpuFactoryFailure') is not True:return unknown('fallback-observation-mode-mismatch')
        if blank is not None or positive is not None:return unknown('later-pipeline-present-before-raw-completion')
    else:
        if len(runs)!=2 or not raw_report_passes(runs[0],False) or not raw_report_passes(runs[1],True):return unknown('pipeline-phase-without-both-valid-raw-reports')
        if index==2 and positive is not None:return unknown('portrait-report-present-before-blank-completion')
        if index==3 and not pipeline_report_passes(blank,False):return unknown('portrait-phase-without-completed-blank')
    result.update(classification='consistent_failure_record',reason=None,
                  stageStatus={p:'passed' if i<index else 'failed_in_phase' if i==index else 'not_executed' for i,p in enumerate(PHASES)},
                  observedRuns=[{key:r.get(key) for key in ('forcedGpuFactoryFailure','delegate','gpuFailure','warmupSamples','warmupMs','initMs','inferenceMs','landmarkCount','frameId','bitmapTransferred')} for r in runs],
                  samplesProvenance='observedRuns numeric arrays are preserved, not reconstructed from error text',
                  productBlankReportAvailable=blank is not None,productPositiveReportAvailable=positive is not None,
                  failureScopeNote='failed_in_phase locates the current phase; it does not prove which internal assertion or post-check failed')
    if index<2 and len(runs)>index:
        samples=runs[index].get('warmupSamples')
        if isinstance(samples,list) and all(number(x) for x in samples):
            result['failedPhaseWarmupSamples']=samples
            result['failedSamplesPrecision']='original observedRuns numeric values; failure may concern a later assertion'
    if index>=2:
        report=blank if index==2 else positive
        result['currentPipelineReportedAssertionsSatisfied']=pipeline_report_passes(report,index==3) if report is not None else None
        result['currentPipelineNote']='A report meeting these two assertions does not prove the complete phase passed; network/output post-checks can still fail'
    return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('failure_json',type=Path);args=parser.parse_args()
    try:
        result=summarize(json.loads(args.failure_json.read_text()))
    except (OSError,ValueError,UnicodeError):
        result=summarize(None);result['reason']='input-unreadable-or-invalid-json'
    print(json.dumps(result,indent=2,allow_nan=False))
    return 0 if result['classification']=='consistent_failure_record' else 2

if __name__=='__main__':raise SystemExit(main())
