"""Exact connectivity check for a locked rotor's rotational constraints.

A joint graph is a necessary kinematic condition, not proof of its actual contact
geometry or torque capacity. Bind each edge to independent geometric evidence.
"""
from post_glue_lifecycle import Violation, require


def verify(nodes, joints):
    require(nodes.get('bar') == 'rotor' and nodes.get('cup') == 'rotor'
            and nodes.get('knob') == 'rotor' and nodes.get('box') == 'stationary',
            'Missing required rotor/base nodes')
    require(set(nodes.values()) <= {'rotor','stationary'}, 'Unknown kinematic role')
    graph={n:set() for n in nodes}
    ids=set()
    for joint in joints:
        require(joint['id'] not in ids, 'Duplicate kinematic joint')
        ids.add(joint['id'])
        first,second=joint['actors']
        require(first in nodes and second in nodes and first!=second, 'Unknown kinematic actor')
        require(joint.get('geometry_evidence'), 'Kinematic joint lacks geometric evidence')
        kind=joint['kind']
        require(kind in {'positive-drive','pad-grip','unlimited-bearing'}, 'Unsupported kinematic joint')
        if kind=='unlimited-bearing':
            require(joint.get('angular_limit_degrees') is None, 'Bearing imposes a rotation limit')
            continue
        require(joint.get('angular_limit_degrees') is None, 'External angular stop is forbidden')
        if kind=='pad-grip':
            require(set((first,second))=={'cup','knob'}, 'Unproven friction substituted for positive drive')
            require(joint.get('physical_slip_resistance_verified') is False,
                    'CAD cannot certify real pad friction/load capacity')
        graph[first].add(second);graph[second].add(first)
    connected={'bar'};todo=['bar']
    while todo:
        n=todo.pop()
        for other in graph[n]-connected:connected.add(other);todo.append(other)
    require({n for n,role in nodes.items() if role=='rotor'} <= connected,
            'Rotor can freewheel without driving knob: '+str(sorted(set(nodes)-connected)))
    require(not any(nodes[n]=='stationary' for n in connected),
            'Rotor is constrained to stationary base')
    return dict(rotor_connected_components=sorted(connected),fixed_to_box=False,
                real_pad_grip_capacity_verified=False,
                scope='Necessary rotational connectivity of supplied geometry-bound graph; actual joint geometry and all-angle clearance separate')
