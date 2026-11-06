"""Exhaustive finite-state check of a CAD-bound post-glue service protocol.

This proves the supplied transition system, not resin strength or the fidelity of
CAD motion evidence. Geometry checkers must independently produce/bind that evidence.
No third-party model checker or runtime dependency is needed.
"""
from __future__ import annotations
from collections import deque
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path


class Violation(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise Violation(message)


TOOLS = {'1.5 mm hex key', '2 mm hex key', '2.5 mm hex key', '3 mm hex key',
         '4 mm hex key', 'Phillips screwdriver', 'flat screwdriver',
         'standard long-nose pliers', 'hand'}
LOCATIONS = {'outside', 'inserted', 'secured'}
MAX_STATES = 100_000


@dataclass(frozen=True)
class Result:
    reachable_states: int
    enabled_transitions: int
    assembly_trace: tuple[str, ...]
    removal_trace: tuple[str, ...]
    model_sha256: str


def verify(model):
    """Enumerate every reachable state; require every state can return to bare bar.

    'bar_glued' is an immutable environment condition, never an actor or action.
    All independent actions can interleave wherever their explicit guards permit.
    Each action is an indivisible, independently geometry-checked motion.
    """
    require(model.get('schema') == 1, 'Unsupported lifecycle model')
    require(model.get('bar_already_glued') is True, 'Initial bar must already be glued')
    require(model.get('above_root_exterior_access') is False, 'Exterior above root is inaccessible')
    parts = model['parts']
    require(isinstance(parts, dict) and bool(parts), 'Missing removable part inventory')
    require('bar' not in parts and 'glue' not in parts, 'Bonded bar is immutable environment')
    modules = model['modules']
    require(isinstance(modules, dict) and bool(modules), 'Missing module ownership')
    members = [n for group in modules.values() for n in group]
    require(len(members) == len(set(members)) and set(members) == set(parts),
            'Module ownership must partition exact part inventory')
    require(all(group for group in modules.values()), 'Empty module ownership')
    variables = model.get('variables', {})
    require(not (set(parts) & set(variables)), 'Duplicate part/state variable')
    require('bar_glued' not in variables, 'Glue state cannot be changed')
    domains = {n: LOCATIONS for n in parts}
    for name, variable in variables.items():
        require(variable['domain'] and len(variable['domain']) == len(set(variable['domain'])), 'Invalid state domain')
        require(variable['initial'] in variable['domain'] and variable['final'] in variable['domain'], 'State outside domain')
        require(variable.get('owners') and set(variable['owners']) <= set(modules), 'Missing state ownership: '+name)
        domains[name] = set(variable['domain'])
    names = tuple(sorted(domains))
    for name, part in parts.items():
        require(part['initial'] == 'outside', 'Pre-glue/captive installed part: '+name)
        require(part['final'] in {'inserted', 'secured'}, 'Missing assembled state: '+name)
        require(part['role'] in {'printed', 'hardware', 'pad', 'knob'}, 'Unknown part role: '+name)
    initial = tuple(parts[n]['initial'] if n in parts else variables[n]['initial'] for n in names)
    final = tuple(parts[n]['final'] if n in parts else variables[n]['final'] for n in names)
    actions = model['actions']
    require(actions and len({a['id'] for a in actions}) == len(actions), 'Missing/duplicate action')
    for a in actions:
        require(a.get('tool') in TOOLS, 'Nonstandard tool: '+a['id'])
        require(a.get('access') in {'root', 'external-module'}, 'Inaccessible action: '+a['id'])
        require(a.get('geometry_evidence'), 'No CAD motion evidence: '+a['id'])
        require(a['requires'] and a['sets'], 'Unbounded/no-op action: '+a['id'])
        require(all(n in domains and v in domains[n] for mapping in (a['requires'], a['sets']) for n,v in mapping.items()),
                'Unknown actor/state: '+a['id'])
        require(all(n in a['requires'] for n in a['sets']), 'Effects must guard prior values: '+a['id'])
        require(any(a['requires'][n] != v for n,v in a['sets'].items()), 'No-op action: '+a['id'])
        if a['access'] == 'external-module':
            require(all(n not in parts or v == 'outside' for n,v in a['sets'].items()),
                    'External work cannot insert or secure parts inside ball: '+a['id'])
            owned = set()
            for name in a['sets']:
                if name in parts:
                    owned.update(group for group, actors in modules.items() if name in actors)
                else:
                    owned.update(variables[name]['owners'])
            affected = {n for group in owned for n in modules[group]}
            require(affected and all(a['requires'].get(n) == 'outside' for n in affected),
                    'External work on inserted component: '+a['id'])
            if 'external_parts' in a:
                require(set(a['external_parts']) == affected, 'External actor subset differs from owned module: '+a['id'])
    reached = {initial: None}
    queue = deque([initial])
    edges = {}
    reverse = {}
    count = 0
    enabled_actions = set()
    while queue:
        state = queue.popleft()
        values = dict(zip(names, state))
        edges[state] = []
        for a in actions:
            if not all(values[n] == v for n,v in a['requires'].items()):
                continue
            after = values | a['sets']
            target = tuple(after[n] for n in names)
            edges[state].append((target, a['id']))
            reverse.setdefault(target, []).append((state, a['id']))
            count += 1
            enabled_actions.add(a['id'])
            if target not in reached:
                reached[target] = (state, a['id'])
                require(len(reached) <= MAX_STATES, 'State bound exceeded; no proof produced')
                queue.append(target)
    require(final in reached, 'No complete assembly path from bare glued bar')
    require(enabled_actions == {a['id'] for a in actions}, 'Unreachable claimed operations: '+str(sorted({a['id'] for a in actions}-enabled_actions)))
    # Backward reachability from the bare-bar state is stronger than one happy removal path.
    can_remove = {initial: None}
    queue = deque([initial])
    while queue:
        state = queue.popleft()
        for previous, action in reverse.get(state, []):
            if previous not in can_remove:
                can_remove[previous] = (state, action)
                queue.append(previous)
    trapped = set(reached) - set(can_remove)
    if trapped:
        state = sorted(trapped)[0]
        raise Violation('Reachable state cannot return to bare glued bar: '+str(dict(zip(names,state))))
    def path_to(state):
        trace=[]
        while reached[state] is not None:
            state, action = reached[state]
            trace.append(action)
        return tuple(reversed(trace))
    trace=[]; state=final
    while state != initial:
        state, action = can_remove[state]
        trace.append(action)
    return Result(len(reached), count, path_to(final), tuple(trace),
                  hashlib.sha256(json.dumps(model,sort_keys=True,separators=(',',':')).encode()).hexdigest())


def verify_inventory(model, source_inventory):
    """Bind actor and module ownership to independently reconstructed CAD inventory.

    source_inventory is produced by the admitted generator/checker, not copied
    from a supplied protocol. The bonded bar and stationary base are excluded.
    """
    require(isinstance(source_inventory, dict) and source_inventory, 'Missing source inventory')
    require(set(model['parts']) == set(source_inventory), 'Protocol omits or invents CAD components')
    expected_modules = {}
    for name, record in source_inventory.items():
        require(model['parts'][name]['role'] == record['role'], 'Protocol component role differs: '+name)
        require(record.get('module'), 'Source component lacks owned module: '+name)
        expected_modules.setdefault(record['module'], set()).add(name)
    supplied = {n:set(members) for n,members in model['modules'].items()}
    require(supplied == expected_modules, 'Protocol changes CAD module ownership')
    return verify(model)


def verify_evidence(model, root):
    """Verify motion evidence names and file digests; no receipt bool can replace a file.

    The referenced evidence is an auditable checker result, not itself a theorem
    about arbitrary CAD. Call the geometry checker before signing publication.
    """
    root = Path(root).resolve()
    evidence = model['evidence']
    require({a['geometry_evidence'] for a in model['actions']} <= set(evidence), 'Missing motion evidence')
    for key, record in evidence.items():
        path = (root / record['path']).resolve()
        require(path.is_relative_to(root), 'Evidence escapes frozen bundle: '+key)
        require(path.is_file(), 'Missing evidence file: '+key)
        require(hashlib.sha256(path.read_bytes()).hexdigest() == record['sha256'], 'Changed evidence: '+key)
    return verify(model)
