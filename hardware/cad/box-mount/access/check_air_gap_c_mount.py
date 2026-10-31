"""Reject restored support, reopened support holes, and a missing keeper."""
from __future__ import annotations
import argparse,json
from copy import deepcopy
from pathlib import Path
import air_gap_c_mount as box


def reject(action,message):
    try:action()
    except ValueError as error:
        if message not in str(error):raise
    else:raise AssertionError('Unsafe air-gap box admitted: '+message)


def check(reference,receipt):
    data=box.prepare(reference);report=box.g.bind_input(data,'actual_air_gap_base',receipt)
    actual=dict(box.g.load_records(data,report['review_components'],box.PARTS))
    data['candidate']['parts']=actual;data['air_gap_records']=report['review_components']
    box.unchanged_subjects(data)
    def mutated(parts):
        return dict(data,candidate=dict(data['candidate'],parts=parts))
    body=actual['shell']
    with box.inherited.detached_booleans():
        restored=deepcopy(body)+deepcopy(data['reference_support_g5'])
        reject(lambda:box.verify(mutated(dict(actual,shell=restored))),'Retired integral bearing projects above roof')
        reopened=deepcopy(body)-deepcopy(data['retired_support_cuts'])
        reject(lambda:box.verify(mutated(dict(actual,shell=reopened))),'Actual air-gap shell differs from pre-buffer roof')
        missing={name:part for name,part in actual.items() if name!='keeper_tab_1'}
        reject(lambda:box.verify(mutated(missing)),'Retired support remains in air-gap inventory')
    box.unchanged_subjects(data)
    print('PASS: actual air-gap exports unchanged; restored bearing, reopened support holes, and missing keeper rejected')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('reference-base','receipt'):parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args();check(args.reference_base,args.receipt)
