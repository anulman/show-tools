"""Exercise fail-closed kernel boundaries without running geometry exports."""
import importlib
from pathlib import Path
import sys
from build123d import Box
from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS_Shape, TopoDS_Shell, TopoDS_Solid
from OCP.BRepCheck import BRepCheck_Analyzer
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
a=importlib.import_module('disco-bar.debond_checks')


class CompletedNull:
    def SetArguments(self,_):pass
    def SetTools(self,_):pass
    def SetNonDestructive(self,_):pass
    def SetFuzzyValue(self,_):pass
    def Build(self):pass
    def IsDone(self):return True
    def Shape(self):return TopoDS_Shape()


class FailedOperation(CompletedNull):
    def IsDone(self):return False
    def Shape(self):raise AssertionError('Failed operation result must not be queried')


class Properties:
    def __init__(self,value):self.value=value
    def Mass(self):return self.value


def reject(action, expected):
    try:action()
    except ValueError as error:
        if expected not in str(error):raise
    else:raise AssertionError('Invalid kernel boundary accepted: '+expected)


def run():
    left=Box(1,1,1).wrapped;right=Box(1,1,1).translate((10,0,0)).wrapped
    empty=a.channel_boolean(a.BRepAlgoAPI_Common,left,right)
    assert not empty.IsNull() and BRepCheck_Analyzer(empty).IsValid()
    assert a.channel_material_volume(empty)==0
    reject(lambda:a.channel_boolean(a.BRepAlgoAPI_Common,None,right),'Missing channel Boolean input')
    reject(lambda:a.channel_boolean(a.BRepAlgoAPI_Common,left,TopoDS_Shape()),'Null channel Boolean input')
    reject(lambda:a.channel_boolean(FailedOperation,left,right),'kernel failure')
    reject(lambda:a.channel_boolean(CompletedNull,left,right),'Null channel Boolean result')
    builder=BRep_Builder();shell=TopoDS_Shell();builder.MakeShell(shell)
    for face in Box(1,1,1).faces()[:5]:builder.Add(shell,face.wrapped)
    solid=TopoDS_Solid();builder.MakeSolid(solid);builder.Add(solid,shell)
    assert not solid.IsNull() and not BRepCheck_Analyzer(solid).IsValid()
    class InvalidResult(CompletedNull):
        def Shape(self):return solid
    reject(lambda:a.channel_boolean(InvalidResult,left,right),'Invalid channel Boolean result')
    reject(lambda:a.channel_material_volume(None),'Missing channel volume shape')
    reject(lambda:a.channel_material_volume(solid),'Invalid channel volume shape')
    for value in (float('nan'),float('inf'),-float('inf'),-1.):
        reject(lambda:a.checked_channel_mass(Properties(value)),'Invalid channel material mass')
    assert a.checked_channel_mass(Properties(0.))==0
    print('PASS failed/None/null/invalid/nonfinite boundaries rejected; completed valid nonnull empty remains zero')


if __name__=='__main__':run()
