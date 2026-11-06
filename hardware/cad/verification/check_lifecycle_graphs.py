"""Independent transitive-closure oracle over all 64 directed three-state graphs."""
from itertools import permutations
from post_glue_lifecycle import verify, Violation

nodes=('outside','inserted','secured')
edges=list(permutations(range(3),2))
passed=0
for mask in range(1<<len(edges)):
    chosen=[(i,j) for k,(i,j) in enumerate(edges) if mask & (1<<k)]
    closure=[[i==j or (i,j) in chosen for j in range(3)] for i in range(3)]
    for k in range(3):
        for i in range(3):
            for j in range(3):
                closure[i][j] |= closure[i][k] and closure[k][j]
    expected=bool(chosen) and closure[0][2] and all(not closure[0][i] or closure[i][0] for i in range(3)) \
             and all(closure[0][i] for i,j in chosen)
    model=dict(schema=1,bar_already_glued=True,above_root_exterior_access=False,
               parts={'module':dict(initial='outside',final='secured',role='printed')},
               modules={'cup':['module']},actions=[dict(id=f'{i}->{j}',tool='hand',access='root',
                   requires={'module':nodes[i]},sets={'module':nodes[j]},geometry_evidence='fixture')
                   for i,j in chosen])
    try: verify(model)
    except Violation: actual=False
    else: actual=True
    assert actual==expected, (mask,chosen,expected,actual)
    passed+=1
print(f'PASS: all {passed} graph fixtures agree with independent transitive-closure oracle; not a CAD design proof')
