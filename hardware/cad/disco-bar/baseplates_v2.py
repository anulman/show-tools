"""Stock-cut adhesive-backed grip pads on retained rigid shoes; joint 1 only."""
from __future__ import annotations
from dataclasses import dataclass
from . import baseplates as previous
from . import full_height as cad


@dataclass(frozen=True)
class PresetBaseplate:
    setting_mm: float
    pieces: tuple
    driver_paths: tuple


def build(reference, setting_mm=.2):
    old = previous.knob_baseplate(reference, setting_mm)
    pieces = []
    for part in old.pieces:
        name, shape = part.name, part.shape
        if part.role == 'body':
            # Shared latch flange and straight pilot keys. These do not move
            # or change the preset shoes during any bar-latch operation.
            flange = cad.cyl(37, 2, (0, 0, -1)) - cad.cyl(30, 4, (0, 0, -1))
            for sign in (-1, 1):
                flange -= cad.box(5, 7.2, 4, (sign * 35.5, 0, -1))
                shape += cad.box(6, 5, 6, (0, sign * 34.5, -5))
            shape += flange
        elif 'retained padded shoe' in name:
            sign = -1 if name.startswith('-1') else 1
            shape = cad.box(27 - (cad.R + 2), 22, 14, (sign * (27 + cad.R + 2) / 2, 0, -13))
            for y in (-12, 12):
                shape += cad.box(3, 2, 10, (sign * 25.5, y, -13))
            shape = shape.translate((-sign * setting_mm, 0, 0))
        elif part.role == 'pad':
            sign = -1 if name.startswith('-1') else 1
            shape = cad.box(2, 16, 8, (sign * (cad.R + 1 - setting_mm), 0, -13))
            name = f'{sign:+d} cut-stock adhesive-backed pad envelope'
        pieces.append(cad.Piece(name, shape, part.role))
    return PresetBaseplate(setting_mm, tuple(pieces), old.driver_paths)


def verify(reference,assembly):
    source_void=cad.cyl(23.5,25.4,(0,0,-12.7))-reference
    cad.assert_empty(source_void-cad.pocket(),'Source socket reconstruction lost volume')
    cad.assert_empty(cad.pocket()-source_void,'Source socket reconstruction enlarged')
    body=assembly.pieces[0].shape
    for region in (cad.cyl(25.5,3,(0,0,-1.5)),cad.cyl(cad.R+.1,1,(0,0,-25.9))):
        cad.assert_empty((reference&region)-body,'Known entry or stop removed')
    lookup={p.name:p.shape for p in assembly.pieces}
    for p in assembly.pieces:
        if not p.shape.is_valid or len(p.shape.solids())!=1 or p.shape.volume<=0:raise ValueError('Invalid stock-pad clamp part')
        if p.role!='pad' or assembly.setting_mm==0:
            cad.assert_empty(p.shape&source_void,'Released socket or rigid knob clearance blocked')
    for path in assembly.driver_paths:
        for p in assembly.pieces:cad.assert_empty(path&p.shape,'Bar-off set-screw access blocked')
    for sign in (-1,1):
        foam=lookup[f'{sign:+d} cut-stock adhesive-backed pad envelope']
        shoe=lookup[f'{sign:+d} retained padded shoe']
        if foam.distance_to(shoe)>1e-5:raise ValueError('Stock pad has no rigid backing seat')
        if cad.volume(foam.translate((sign*.1,0,0))&shoe)<=1e-5:raise ValueError('Pad normal load has no backing reaction')
        if shoe.distance_to(lookup[f'{sign:+d} preset set-screw envelope'])>1e-5:raise ValueError('Set screw does not meet shoe')
        if cad.volume(shoe.translate((-sign*.4,0,0))&body)<=1e-5:raise ValueError('Rigid shoe has no retaining shoulder')
        if cad.volume(lookup[f'{sign:+d} captive nut envelope'].translate((sign*.1,0,0))&body)<=1e-5:raise ValueError('Nut has no positive outward reaction')
        # Replacement access is tested only with the clamp removed from the
        # knob. Adhesive peeling force and actual hand/tool access are untested.
        for inward in (0,5,10):
            moved=foam.translate((-sign*inward,0,0))
            for p in assembly.pieces:
                if p.shape is not foam:cad.assert_empty(moved&p.shape,'Pad replacement radial path blocked')
        for lift in (0,10,20):
            moved=foam.translate((-sign*10,0,lift))
            for p in assembly.pieces:
                if p.shape is not foam:cad.assert_empty(moved&p.shape,'Pad replacement through cup blocked')
    return {'source_void_entry_stop':True,'released_fit':assembly.setting_mm==0,
            'stock_cut_dimensions_mm_PROPOSED':[2,16,8],'adhesive_face':'toward printed rigid shoe; never knob',
            'backing_seat_and_screw_contact':True,'shoe_and_nut_positive_retention':True,
            'replacement_path_with_clamp_off_knob':True,'adhesive_bond_strength_verified':False}
