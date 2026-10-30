"""Validate delivered STEP/STL files using their declared mass integration method.

Adaptive mass prevents default quadrature noise being mistaken for material loss.
This loader proves artifact integrity, not source/STEP material equivalence.
"""
from __future__ import annotations
import hashlib
import math
from pathlib import Path
import numpy as np
import trimesh
from build123d import import_step
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps


def require(condition, message):
    if not condition:raise ValueError(message)


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def adaptive_mass(shape):
    properties=GProp_GProps()
    error=BRepGProp.VolumeProperties_s(shape.wrapped,properties,1e-10,True,False)
    value=properties.Mass()
    require(math.isfinite(value) and value>0 and math.isfinite(error) and 0<=error<=1e-8,
            'Native adaptive closed-solid mass integration failed')
    return float(value),float(error)


class Artifacts:
    def __init__(self):
        self.files={};self.shapes={};self.meshes={};self.measurements={}

    def load(self,record):
        name=record['name']
        for kind in ('step','stl'):
            path=Path(record[kind]);sha=digest(path)
            require(sha==record[kind+'_sha256'],'Changed '+kind+' artifact: '+name)
            self.files[str(path)]=sha
        key=record['step_sha256']
        if key not in self.shapes:
            wrapper=import_step(record['step'])
            require(wrapper.is_valid and len(wrapper.solids())==1,'Expected one valid delivered solid: '+name)
            part=wrapper.solids()[0]
            require(len(wrapper.faces())==len(part.faces()) and len(wrapper.edges())==len(part.edges()),
                    'Delivered wrapper contains non-solid geometry: '+name)
            mass,error=adaptive_mass(part)
            self.shapes[key]=part
            self.measurements[key]=(mass,error,float(part.volume))
        part=self.shapes[key];mass,error,default_mass=self.measurements[key]
        if 'mass_integration' in record:
            require(record['mass_integration']=='native adaptive closed-volume Eps1e-10; original rtol1e-6 unchanged',
                    'Unknown declared mass integration: '+name)
            declared=record['mass_relative_error_estimates']
            require(len(declared)==2 and all(math.isfinite(x) and 0<=x<=1e-8 for x in declared),
                    'Unbounded declared mass integration: '+name)
            require(math.isclose(mass,record['restored_volume_mm3'],rel_tol=1e-6),
                    'Adaptive restored STEP mass disagrees: '+name)
            expected_mass=mass
        else:expected_mass=default_mass
        require(math.isfinite(record['volume_mm3']) and record['volume_mm3']>0
                and math.isclose(expected_mass,record['volume_mm3'],rel_tol=1e-6),
                'Actual mass disagrees with declared integration: '+name)
        mesh_key=record['stl_sha256']
        if mesh_key not in self.meshes:
            mesh=trimesh.load_mesh(record['stl'])
            require(isinstance(mesh,trimesh.Trimesh) and mesh.is_watertight and mesh.is_winding_consistent
                    and np.isfinite(mesh.vertices).all() and math.isfinite(mesh.volume) and mesh.volume>0,
                    'Invalid actual STL: '+name)
            self.meshes[mesh_key]=(float(mesh.volume),mesh.bounds.copy())
        mesh_volume,bounds=self.meshes[mesh_key]
        require(math.isclose(mesh_volume,mass,rel_tol=.005),'Actual STEP/STL masses disagree: '+name)
        bb=part.bounding_box()
        expected=[[bb.min.X,bb.min.Y,bb.min.Z],[bb.max.X,bb.max.Y,bb.max.Z]]
        require(np.allclose(bounds,expected,atol=.05,rtol=0),'Actual STEP/STL bounds disagree: '+name)
        return part

    def unchanged(self):
        for path,sha in self.files.items():
            require(digest(path)==sha,'Artifact changed during verification: '+path)
