"""Admission contract for reduced C; combined base admission remains mandatory.

Config schema1: variant='reduced-cover-B', candidate and protocol path/sha256
pins, proofs mapping external/root/race/preservation/contacts/module/tools to
path/sha256 pins. load returns candidate/model/inventory/lifecycle/model_sha256,
parsed proofs and rotation_graph. It never certifies base compatibility itself.
"""
from pathlib import Path


def load(config_path:Path):
    """Validate exact actual-file proofs, independent17 actors and fresh finite model."""
    raise NotImplementedError('Reduced C proof and protocol binding is not complete')
