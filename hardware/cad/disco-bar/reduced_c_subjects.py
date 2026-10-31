"""Exact non-mesh BREP fingerprints detect temporary in-memory subject mutation."""
import hashlib,io
from build123d import import_step
from OCP.BRepTools import BRepTools
from OCP.TopTools import TopTools_FormatVersion


def fingerprint(shape):
    stream=io.BytesIO()
    BRepTools.Write_s(shape.wrapped,stream,False,False,TopTools_FormatVersion.TopTools_FormatVersion_VERSION_3)
    return hashlib.sha256(stream.getvalue()).hexdigest()


def unchanged(subjects,records):
    for record in records:
        current=subjects[record['name']];fresh=import_step(record['step'])
        if not current.is_valid or len(current.solids())!=1 or not fresh.is_valid or len(fresh.solids())!=1:raise ValueError('Actual subject invalid after proof: '+record['name'])
        fresh=fresh.solids()[0]
        if fingerprint(current)!=fingerprint(fresh):raise ValueError('Actual subject mutated by temporary geometry: '+record['name'])
    return True
