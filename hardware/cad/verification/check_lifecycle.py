"""Prove the lifecycle checker rejects the actual failure class and reverse traps."""
from copy import deepcopy
from dataclasses import asdict
import json
from post_glue_lifecycle import verify, Violation


def fixture():
    # Checker fixture only. Never admitted as a fabricated CAD mechanism.
    return dict(schema=1, bar_already_glued=True, above_root_exterior_access=False,
        parts={'module':dict(initial='outside',final='secured',role='printed')},
        modules={'cup':['module']},
        variables={'grip':dict(domain=['loose','tight'],initial='loose',final='tight',owners=['cup'])},
        actions=[
            dict(id='grip outside',tool='1.5 mm hex key',access='external-module',external_parts=['module'],
                 requires={'module':'outside','grip':'loose'},sets={'grip':'tight'},geometry_evidence='fixture'),
            dict(id='release grip outside',tool='1.5 mm hex key',access='external-module',external_parts=['module'],
                 requires={'module':'outside','grip':'tight'},sets={'grip':'loose'},geometry_evidence='fixture'),
            dict(id='insert',tool='hand',access='root',requires={'module':'outside','grip':'tight'},
                 sets={'module':'inserted'},geometry_evidence='fixture'),
            dict(id='withdraw',tool='hand',access='root',requires={'module':'inserted'},
                 sets={'module':'outside'},geometry_evidence='fixture'),
            dict(id='lock',tool='2 mm hex key',access='root',requires={'module':'inserted'},
                 sets={'module':'secured'},geometry_evidence='fixture'),
            dict(id='unlock',tool='2 mm hex key',access='root',requires={'module':'secured'},
                 sets={'module':'inserted'},geometry_evidence='fixture')])


def rejects(change, phrase):
    model=fixture(); change(model)
    try: verify(model)
    except Violation as error:
        assert phrase in str(error), str(error)
        print('REJECTED:', error)
    else: raise AssertionError('Broken lifecycle accepted')


result=verify(fixture())
assert result.reachable_states == 4 and result.enabled_transitions == 6
rejects(lambda m:m['parts']['module'].update(initial='inserted'), 'Pre-glue/captive')
rejects(lambda m:m['actions'].pop(), 'cannot return')
rejects(lambda m:m['actions'][4].update(access='side-above-root'), 'Inaccessible action')
rejects(lambda m:m['actions'][4].update(tool='custom fork'), 'Nonstandard tool')
rejects(lambda m:m['actions'][0]['requires'].update(module='inserted'), 'External work on inserted')
rejects(lambda m:m['actions'].pop(4), 'No complete assembly')

def substituted_external(m):
    m['parts']['bench']=dict(initial='outside',final='secured',role='printed')
    m['modules']['bench']=['bench']
    m['actions'][0]['requires'].update(module='inserted',bench='outside')
    m['actions'][0]['external_parts']=['bench']
    del m['actions'][2]['requires']['grip']

rejects(substituted_external, 'External work on inserted')
def invalid_overwritten_guard(m):
    m['actions'].append(dict(id='invalid dead guard',tool='hand',access='root',
        geometry_evidence='fixture',requires={'module':'not-a-location'},sets={'module':'outside'}))
rejects(invalid_overwritten_guard, 'Unknown actor/state')
def unreachable_operation(m):
    m['variables']['unused']=dict(domain=['never','reachable'],initial='reachable',final='reachable',owners=['cup'])
    m['actions'].append(dict(id='dead step',tool='hand',access='root',geometry_evidence='fixture',
        requires={'unused':'never'},sets={'unused':'reachable'}))
rejects(unreachable_operation, 'Unreachable claimed operations')
print(json.dumps(asdict(result),indent=2))
