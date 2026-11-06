"""Reject the real frozen old C2; legacy geometry PASS cannot admit a lifecycle."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from post_glue_lifecycle import Violation, verify

PIN='cc535b9d49cdf9c12834ba56efc93d31fb30e1888712d9fbfd50c859f2b75b02'
PREINSTALLED={'fixed receiver half A','fixed receiver half B','preassembled captive-lock cap',
              'M3x8 lock-cap button screw','M3 lock-cap nut','standard-screw drive collar',
              'WDS 899 captive M3x12 screw','WDS 899-M3 retaining washer','M3 positive-lock nut',
              *{f'M3x8 carrier button screw {a}' for a in (40,160,280)},
              *{f'M3 carrier nut {a}' for a in (40,160,280)}}


def run(receipt):
    receipt=Path(receipt); raw=receipt.read_bytes()
    assert hashlib.sha256(raw).hexdigest()==PIN, 'Use exact rejected frozen candidate'
    old=json.loads(raw)
    names={p['name'] for p in old['review_components']}
    assert PREINSTALLED<=names, 'Old assembly inventory changed'
    # This is the old documented manufacturing sequence, not a new path search:
    # receivers/carrier/collar/cap are factory-assembled before bar bonding.
    parts={n:dict(initial='secured' if n in PREINSTALLED else 'outside',
                  final='secured',role='hardware' if n.startswith('M3') else 'printed')
           for n in names if n!='full-height bar'}
    model=dict(schema=1,bar_already_glued=True,above_root_exterior_access=False,parts=parts,modules={'old-coupling':list(parts)},actions=[])
    try: verify(model)
    except Violation as error:
        assert 'Pre-glue/captive installed part' in str(error)
        return dict(status='REJECTED',legacy_receipt_sha256=PIN,
                    legacy_geometry_review_pass=old['geometry_review_pass'],
                    reason=str(error), documented_preinstalled_components=sorted(PREINSTALLED),
                    scope='Rejects documented old sequence; not a search for a redesigned alternative')
    raise AssertionError('Rejected historical pre-glue sequence admitted')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('receipt',type=Path)
    print(json.dumps(run(parser.parse_args().receipt),indent=2))
