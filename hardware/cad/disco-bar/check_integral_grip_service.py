"""Intrinsic8actor service on actual integral body; fixed-flange/box remain separate."""
import argparse,importlib,json,sys,math
from copy import deepcopy
from pathlib import Path
from build123d import Axis,Compound,import_step
sys.path.insert(0,str(Path(__file__).resolve().parents[1]));f=importlib.import_module('disco-bar.integral_exposed_grip');c=f.c;a=f.a;u=f.u
v=importlib.import_module('disco-bar.check_post_glue_candidates')


def run(concept,output):
    if output.exists():raise ValueError('Use a fresh intrinsic-service namespace')
    output.mkdir(parents=True);data=json.loads(concept.read_text());E=data['exploratory_parameters']['exposure_below_original_root_mm'];z=E-13.
    pins={str(concept.resolve()):f.digest(concept)}
    for p,sha in data['source_files'].items():
        if f.digest(p)!=sha:raise ValueError('Concept source changed: '+p)
        pins[p]=sha
    for module in (sys.modules[__name__],f,c,a,u,v):pins[str(Path(module.__file__).resolve())]=f.digest(module.__file__)
    parts={}
    for r in data['components']:
        for k in ('step','stl'):
            if f.digest(r[k])!=r[k+'_sha256']:raise ValueError('Changed intrinsic actual file')
            pins[r[k]]=r[k+'_sha256']
        s=import_step(r['step'])
        if not s.is_valid or len(s.solids())!=1:raise ValueError('Invalid intrinsic solid')
        parts[r['name']]=s.solids()[0]
    body=parts[data['components'][0]['name']];records=[];contacts={}
    def mass(kind,x,y):return a.channel_material_volume(a.channel_boolean(kind,deepcopy(x).wrapped,deepcopy(y).wrapped))
    def empty(x,y,label,kind=a.BRepAlgoAPI_Common):
        q=mass(kind,x,y)
        if q>1e-5:raise ValueError(label+': '+str(q))
        return q
    def positive(x,y,label):
        q=mass(a.BRepAlgoAPI_Common,x,y)
        if q<=1e-5:raise ValueError('Missing '+label)
        return q
    def evidence(name,bound,obstacles,below_opening=True):
        for n,s in obstacles.items():empty(bound,s,name+' blocked '+n)
        if below_opening and bound.bounding_box().min.Z<0:raise ValueError('Intrinsic side bound reaches above opening')
        files=[v.export_piece(c.Piece(name+' '+str(i),deepcopy(s),'continuous intrinsic service bound'),output/'bounds') for i,s in enumerate(bound.solids())]
        records.append(dict(id=name,components=files,native_obstacle_common_mm3=0.))
    released=dict(parts)
    for s in ('-1','+1'):
        sign=int(s)
        for suffix in ('retained padded shoe','cut-stock adhesive-backed pad envelope','preset set-screw envelope'):released[s+' '+suffix]=parts[s+' '+suffix].translate((sign*.2,0,0))
    nominal=c.cyl(c.R,125.4,(0,0,E+37.3))
    evidence('released whole module knob entry and reverse',nominal,{n:p for n,p in released.items() if 'pad envelope' not in n},below_opening=False)
    for s in ('-1','+1'):
        sign=int(s);shoe=released[s+' retained padded shoe'];pad=released[s+' cut-stock adhesive-backed pad envelope'];nut=parts[s+' captive nut envelope'];screw=released[s+' preset set-screw envelope']
        contacts[s+' pad backing and nominal bond seat']=dict(normal_push_mm3=positive(pad.translate((sign*.01,0,0)),shoe,'pad rigid backing'))
        axial=c.cyl(18.,46.4,(0,0,z+20.));empty(nut.translate((-sign*14,0,0)),axial,'Nut inward origin outside axial feed',a.BRepAlgoAPI_Cut)
        evidence(s+' nut axial feed',axial,{'integral body':body})
        radial=c.hexagon(3.2,16.4,(sign*22.1,0,z),'x');empty(nut,radial,'Nut outside radial feed',a.BRepAlgoAPI_Cut)
        evidence(s+' nut radial feed and retained reactions',radial,{'integral body':body})
        contacts[s+' nut capture']=dict(outward_roof_mm3=positive(nut.translate((sign*.01,0,0)),body,'nut outward roof'),gravity_floor_mm3=positive(nut.translate((0,0,.5)),body,'nut gravity floor'),anti_turn_mm3=positive(nut.rotate(Axis((sign*29.1,0,z),(1,0,0)),15.),body,'nut anti turn'),inward_shoe_mm3=positive(nut.translate((-sign*1.,0,0)),shoe,'nut inward shoe reaction'))
        bound=c.cyl(21.5,64.,(0,0,z+25.))
        for p in (shoe,pad):empty(p.translate((-sign*10,0,0)),bound,'Inward shoe/pad outside axial feed',a.BRepAlgoAPI_Cut)
        evidence(s+' released shoe and pad axial feed',bound,{'integral body':body})
        radial=c.box(27-(c.R+2)+10,22,14,(sign*((27+c.R+2)/2-5),0,z))
        for y in (-12,12):radial+=c.box(13,2,10,(sign*20.5,y,z))
        radial+=c.box(12,16,8,(sign*(c.R+1-5),0,z))
        for p in (shoe,pad):empty(p,radial,'Released shoe/pad outside radial seat',a.BRepAlgoAPI_Cut)
        evidence(s+' released shoe and pad radial seat',radial,{'integral body':body})
        bound=c.cyl(1.5,66.,(sign*60.,0,z),'x');empty(screw,bound,'Released screw outside axial feed',a.BRepAlgoAPI_Cut)
        evidence(s+' screw radial feed',bound,{'integral body':body,'shoe':shoe,'pad':pad})
        # Exact box sums of the two matched planar shoe forms over preset0.2.
        move=c.box(27-(c.R+2)+.2,22,14,(sign*((27+c.R+2)/2-.1),0,z))
        for y in (-12,12):move+=c.box(3.2,2,10,(sign*25.4,y,z))
        move+=c.box(2.2,16,8,(sign*(c.R+.9),0,z))
        move+=c.cyl(1.5,6.2,(sign*29.9,0,z),'x')
        for suffix in ('retained padded shoe','cut-stock adhesive-backed pad envelope','preset set-screw envelope'):
            for p in (parts[s+' '+suffix],released[s+' '+suffix]):empty(p,move,'Actual grip actor outside preset stroke',a.BRepAlgoAPI_Cut)
        evidence(s+' released to preset0p2 stroke',move,{'integral body':body})
        stem=c.cyl(1.3,201.2,(sign*132.4,0,z),'x');handle=c.cyl(22.,104.2,(sign*182.4,0,z),'x')&c.box(110.,50.,25.,(sign*182.4,0,z+11.2));tool=stem+handle
        evidence(s+' whole side key',tool,{'integral body':body,'shoe':shoe,'pad':pad,'nut':nut})
    records.extend([dict(id=n,contacts=q) for n,q in contacts.items() if n.endswith('pad backing and nominal bond seat')]);records.append(dict(id='both pads and screw reaction chain',contacts=contacts))
    u.unchanged(parts,data['components'])
    for p,sha in pins.items():
        if f.digest(p)!=sha:raise ValueError('Intrinsic service input changed')
    report=dict(schema=1,scope='INTRINSIC_INTEGRAL8ACTOR_SERVICE_ONLY',source_concept_sha256=f.digest(concept),input_files=pins,evidence=records,contacts=contacts,actual_subjects_reimport_unchanged=True,all_actor_paths_continuous=True,released_to_preset_stroke_mm=.2,M3_pitch_mm=.5,nominal_screw_setting_turns=.4,tool_dimensions_nominal_mm=[100.,20.],actual_stock_hex_engagement_verified=False,source_to_world_nominal=dict(rotate_x_deg=180.,translate_z_mm=E+2.38125),operator_approx_fixed_flange_thickness_mm=2.38125,no_visible_gap_above_flange=True,base_alignment_verified=False,physical_fit_verified=False,manufacturing_approved=False)
    (output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print('INTEGRAL8ACTOR INTRINSIC SERVICE PASS',flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for n in ('concept','output'):p.add_argument('--'+n,type=Path,required=True)
    q=p.parse_args();run(q.concept,q.output)
