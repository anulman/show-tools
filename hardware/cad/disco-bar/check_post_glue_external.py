"""Native continuous outside-module grip assembly and complete tool envelopes."""
from __future__ import annotations
import argparse,hashlib,importlib,json,math,sys
from pathlib import Path
from build123d import Axis,Compound,Polygon,extrude,import_step
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
m=importlib.import_module('disco-bar.post_glue_couplings');c=m.c
p=importlib.import_module('disco-bar.check_couplings')
g=importlib.import_module('disco-bar.check_grip_access')
a=m.channels


def mass(shape):return a.channel_material_volume(shape)
def common(left,right):return mass(a.channel_boolean(a.BRepAlgoAPI_Common,left.wrapped,right.wrapped))
def missing(part,bound):return mass(a.channel_boolean(a.BRepAlgoAPI_Cut,part.wrapped,bound.wrapped))
def empty(left,right,label):
    amount=common(left,right)
    if amount>1e-5:raise ValueError(label+': '+str(amount))
    return amount

def contains(part,bound,label):
    amount=missing(part,bound)
    if amount>1e-5:raise ValueError(label+': '+str(amount))
    return amount


def hull(points):
    points=sorted(set(points))
    def cross(o,a,b):return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lower=[];upper=[]
    for point in points:
        while len(lower)>=2 and cross(lower[-2],lower[-1],point)<=0:lower.pop()
        lower.append(point)
    for point in reversed(points):
        while len(upper)>=2 and cross(upper[-2],upper[-1],point)<=0:upper.pop()
        upper.append(point)
    return lower[:-1]+upper[:-1]


def radial_nut_sweep(angle):
    radius=5.5/math.sqrt(3)
    points=[(center+radius*math.cos(i*math.pi/3),radius*math.sin(i*math.pi/3)) for center in (31.,38.) for i in range(6)]
    return m.old.radial(extrude(Polygon(*hull(points),align=None),amount=2.4).translate((0,0,3.7)),angle)


def key3(angle,phase=35.,head_shift=0.):
    return m.lock_key(angle,head_shift).rotate(m.Axis((*m.old.xy(38.,angle),0),(0,0,1)),phase)


def key3_sweeps(angle,head_shift=0.):
    point=m.old.xy(38.,angle)
    operation=c.cyl(2.,126.,(*point,68.2))+c.cyl(22.,4.,(*point,129.2))
    entry=c.hexagon(3/math.sqrt(3),103.,(*point,56.7)).rotate(Axis((*point,0),(0,0,1)),35.)
    entry+=c.cyl(2.,223.,(*point,119.7))+c.cyl(22.,104.,(*point,179.2))
    return {phase:shape.translate((0,0,head_shift)) for phase,shape in dict(entry=entry,operation=operation,withdrawal=entry).items()}


def drive4_sweeps(start=225.,end=260.):
    from build123d import Axis
    # Long4key stem sweep; handle is below every module part.
    operation=m.sector(35.5,41.5,5.5,145.5,start,end)
    for angle in (start,end):operation+=c.cyl(3.,140.,(*m.old.xy(38.5,angle),75.5))
    operation+=m.old.ring(10.,67.,140.5,145.5)
    entry=m.sector(35.5,41.5,5.5,240.,start,end)
    for angle in (start,end):entry+=c.cyl(3.,234.5,(*m.old.xy(38.5,angle),122.75))
    entry+=m.old.ring(10.,67.,140.5,240.)
    return dict(entry=entry,operation=operation,withdrawal=entry)


def run(source,output):
    output.mkdir(parents=True,exist_ok=True);(output/'receipt.json').unlink(missing_ok=True)
    raw=source.read_bytes();report=json.loads(raw);inputs={str(source.resolve()):hashlib.sha256(raw).hexdigest()}
    sources={Path(f).resolve():hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in (__file__,m.__file__,g.__file__,p.__file__,a.__file__,c.__file__)}
    def load(record):
        for kind in ('step','stl'):
            file=Path(record[kind]);sha=hashlib.sha256(file.read_bytes()).hexdigest()
            if sha!=record[kind+'_sha256']:raise ValueError('Artifact changed')
            inputs[str(file.resolve())]=sha
        shape=import_step(record['step'])
        if not shape.is_valid or len(shape.solids())!=1:raise ValueError('Invalid actual part')
        return shape.solids()[0]
    bar=load(report['environment']);parts={q['name']:load(q) for q in report['stages']['inserted']['components']}
    cup=parts['removable padded knob cup'];records=[]
    def evidence(name,actors,sweeps,static,method):
        exported=[]
        for label,shape in sweeps:
            if not shape.is_valid or len(shape.solids())!=1:raise ValueError('Invalid envelope '+name)
            for obstacle_name,obstacle in static.items():empty(shape,obstacle,name+' blocked '+obstacle_name)
            exterior=shape.translate((0,0,50))
            if exterior.bounding_box().min.Z<0:raise ValueError('External motion reaches glued bar')
            empty(exterior,bar,name+' reaches immutable glued bar')
            exported.append(p.export_piece(c.Piece(label,exterior,'temporary continuous motion bound'),output/'sweeps'))
        records.append(dict(id=name,moving_parts=actors,access='external-module',cup_translation_source_mm=[0,0,50],method=method,sweeps=exported,native_common_mass_with_fixed_parts_mm3=0.))
    for sign in (-1,1):
        shoe=parts[f'{sign:+d} retained padded shoe'];pad=parts[f'{sign:+d} cut-stock adhesive-backed pad envelope']
        main=c.box(27-(c.R+2),22,14,(sign*((27+c.R+2)/2-.2),0,-13))
        tabs=[c.box(3,2,10,(sign*25.3,y,-13)) for y in (-12,12)]
        template=main+tabs[0]+tabs[1]
        contains(shoe,template,'Shoe differs from box decomposition');contains(template,shoe,'Shoe decomposition added material')
        pad_template=c.box(2,16,8,(sign*(c.R+.8),0,-13))
        contains(pad,pad_template,'Pad differs');contains(pad_template,pad,'Pad template differs')
        pad_bond=c.box(7.,16.,8.,(sign*(c.R+.8-2.5),0,-13))
        evidence(f'{sign:+d} pad attachment and peel reverse',[f'{sign:+d} cut-stock adhesive-backed pad envelope'],[(f'{sign:+d} pad complete normal approach',pad_bond)],{'shoe':shoe,'cup':cup},'Exact box swept 5mm normal to actual shoe pad face; physical adhesive strength and peel behavior not claimed.')
        radial=c.box(27-(c.R+2)+10,22,14,(sign*((27+c.R+2)/2-.2-5),0,-13))
        for y in (-12,12):radial+=c.box(13,2,10,(sign*20.3,y,-13))
        radial+=c.box(12,16,8,(sign*(c.R+.8-5),0,-13))
        contains(shoe,radial,'Final shoe outside radial sweep');contains(pad,radial,'Final pad outside radial sweep')
        inner_shoe=shoe.translate((-sign*10,0,0));inner_pad=pad.translate((-sign*10,0,0))
        cylinder=c.cyl(21.5,14,(0,0,-13))
        contains(inner_shoe,cylinder,'Shoe cannot enter bore');contains(inner_pad,cylinder,'Pad cannot enter bore')
        axial=c.cyl(21.5,70,(0,0,15))
        actors=[f'{sign:+d} retained padded shoe',f'{sign:+d} cut-stock adhesive-backed pad envelope']
        evidence(f'{sign:+d} shoe axial entry and reverse',actors,[(f'{sign:+d} shoe axial continuous bound',axial)],{'cup':cup},'Radial containing cylinder remains inside original bore for complete axial translation; reverse identical.')
        evidence(f'{sign:+d} shoe radial seating and reverse',actors,[(f'{sign:+d} shoe radial continuous bound',radial)],{'cup':cup},'Exact union of Minkowski sums of independently matched shoe/pad boxes with the 10 mm radial segment; reverse identical.')
        nut_bound=c.hexagon(5.5/math.sqrt(3),6.4,(sign*27.1,0,-13),'x')
        contains(parts[f'{sign:+d} captive nut envelope'],nut_bound,'Grip nut outside swept prism')
        evidence(f'{sign:+d} grip nut entry and reverse',[f'{sign:+d} captive nut envelope'],[(f'{sign:+d} grip nut continuous bound',nut_bound)],{'cup':cup},'Hexagonal nut outer prism extended by exact 4 mm axial insertion distance; bore omission is conservative.')
        screw_name=f'{sign:+d} preset set-screw envelope'
        screw_bound=c.cyl(1.5,16.,(sign*34.8,0,-13),'x')
        contains(parts[screw_name],screw_bound,'Grip grub outside thread-on path')
        evidence(screw_name+' external thread-on and reverse',[screw_name],[(screw_name+' complete screw bound',screw_bound)],{name:part for name,part in parts.items() if name not in {screw_name,f'{sign:+d} captive nut envelope'}},'Full rotating grub circumcylinder and 10mm radial approach; only matching standard threaded nut excluded.')
        op=g.sweep(sign)
        for name,part in parts.items():
            if name!=screw_name:empty(op,part,'Complete grip key operating bound blocked '+name)
        empty(g.key(sign),parts[screw_name],'Nominal AF1.5 socket engagement blocked')
        for phase,shape in [('entry',g.sweep(sign,True)),('operation',op),('withdrawal',g.sweep(sign,True))]:
            # The working steel pair rotates together; exact nominal hex fit checked above.
            evidence(f'{sign:+d} grip key '+phase,[screw_name],[(f'{sign:+d} grip key full '+phase,shape)],{name:s for name,s in parts.items() if name!=screw_name},'Full catalog L-key body and continuous cylindrical handle/axial bounds; intended purchased socket pair separately matched.')
    for name,part in parts.items():
        if not name.startswith('external cover M3 nut '):continue
        angle=float(name.rsplit(' ',1)[1]);bound=radial_nut_sweep(angle)
        if report['concept']=='post-glue C':bound=bound.translate((0,0,-.5))
        contains(part,bound,'Cover nut outside radial hull')
        evidence('cover nut '+str(angle)+' entry and reverse',[name],[('cover nut '+str(angle)+' exact radial hull',bound)],{'cup':cup} if report['concept']!='post-glue C' else {n:q for n,q in parts.items() if n.startswith('removable collar half')},'Exact convex hull of translated hex vertices extruded through actual 2.4 mm nut height. Actual host checked; C loaded collar stop included.')
    # These operations precede cover installation; absent actors are explicit.
    prints={name:shape for name,shape in parts.items() if name in {'removable padded knob cup','removable collar half A','removable collar half B'}}
    delta=-.5 if report['concept']=='post-glue C' else 0.
    for name,part in parts.items():
        if name.startswith('threaded M4 full nut '):
            angle=float(name.rsplit(' ',1)[1]);point=m.old.xy(38.,angle)
            high=part.bounding_box().max.Z
            if report['concept']=='post-glue C':
                radius=7/math.sqrt(3)
                vertices=[(center+radius*math.cos(i*math.pi/3),radius*math.sin(i*math.pi/3)) for center in (38.,48.) for i in range(6)]
                bound=m.old.radial(extrude(Polygon(*hull(vertices),align=None),amount=3.2).translate((0,0,high-3.2)),angle)
                method='C full hex nut slides radially into external collar before M4 screw insertion; matching screw is absent. Exact convex translated hex hull; cup upper race is never crossed.'
            else:
                bound=c.cyl(7/math.sqrt(3),high+15.6,(*point,(high-15.6)/2))
                method='Complete rotating hex nut enclosed by circumcircle over axial thread-on path; only matching screw-thread contact licensed. Cover absent.'
            contains(part,bound,'M4 nut outside assembly sweep')
            evidence(name+' external thread-on and reverse',[name],[(name+' full nut continuous bound',bound)],prints,method)
        if name.startswith('axial M4x12 socket screw '):
            angle=float(name.rsplit(' ',1)[1]);point=m.old.xy(38.,angle)
            bound=c.cyl(2.,116.,(*point,49.+delta))+c.cyl(3.5,104.,(*point,55.+delta))
            contains(part,bound,'M4 bolt outside axial entry')
            evidence(name+' external axial entry and reverse',[name],[(name+' full bolt continuous bound',bound)],prints,'Exact shaft/head circumcylinders swept 100mm axially; installed cover absent; A/B nut threads on afterwards, C nut enters radially first.')
    cover_name='external axial screw capture cover';cover=parts[cover_name]
    bottom=sorted([face for face in cover.faces() if abs(face.normal_at().Z)>1-1e-8],key=lambda face:face.center().Z)[0]
    cover_bound=extrude(bottom,amount=102.,dir=(0,0,1))
    contains(cover,cover_bound,'Cover not uniform axial plate')
    cover_static={name:shape for name,shape in parts.items() if name!=cover_name and not name.startswith('external cover M3x8 screw')}
    evidence('capture cover axial installation and reverse',[cover_name],[('complete cover axial sweep',cover_bound)],cover_static,'Actual bottom face extruded through full plate thickness and 100mm translation; containment verified on actual STEP. Cover screws absent.')
    for name,part in parts.items():
        if not name.startswith('external cover M3x8 screw '):continue
        angle=float(name.rsplit(' ',1)[1]);point=m.old.xy(38.,angle)
        bound=c.cyl(1.5,109.65,(*point,56.325+delta))+c.cyl(2.85,101.65,(*point,60.325+delta))
        contains(part,bound,'M3 bolt outside axial entry')
        static={n:q for n,q in parts.items() if n!=name and n!='external cover M3 nut '+str(angle)}
        evidence(name+' axial installation and reverse',[name],[(name+' complete axial sweep',bound)],static,'Actual head and shank circumcylinders plus 100mm axial segment; only matching standard thread pair excluded.')
    for name,target in parts.items():
        if not name.startswith('external cover M3x8 screw '):continue
        angle=float(name.rsplit(' ',1)[1]);point=m.old.xy(38.,angle)
        tool=c.hexagon(2/math.sqrt(3),2.,(*point,11.+delta))
        tool+=c.cyl(1.5,98.,(*point,61.+delta))+c.cyl(1.5,16.,(point[0]+8,point[1],108.5+delta),'x')
        empty(tool,target,'AF2 external cover socket mismatch')
        working=c.cyl(1.5,100.,(*point,60.+delta))+c.cyl(18.,3.,(*point,108.5+delta))
        entering=c.hexagon(2/math.sqrt(3),102.,(*point,61.+delta))+c.cyl(1.5,198.,(*point,111.+delta))+c.cyl(18.,103.,(*point,158.5+delta))
        static={n:q for n,q in parts.items() if n!=name}
        for phase,bound in [('entry',entering),('operation',working),('withdrawal',entering)]:
            evidence(name+' full AF2 tool '+phase,[name],[(name+' AF2 complete '+phase,bound)],static,'Wera950L05021605001: AF2 long100mm short16mm; full revolving handle, exact nominal socket fit, and complete axial approach. https://www.wera.de/fileadmin/pdf/catalog/EN-Compact-Catalogue-2025.pdf')
    if report['concept']=='post-glue C':
        for angle in (() if not any(n.startswith('external collar M2') for n in parts) else (90.,270.)):
            nut_name='external collar M2 nut '+str(angle)
            nut_bound=m.old.radial(c.hexagon(4/math.sqrt(3),17.3,(38.5,-10.15,-8.),'y'),angle)
            contains(parts[nut_name],nut_bound,'M2 nut outside load prism')
            evidence(nut_name+' external axial entry and reverse',[nut_name],[(nut_name+' complete hex prism sweep',nut_bound)],prints,'Exact full hex outer prism translated from tangent coordinate -18 to -2.3; loaded collar stop included.')
            screw_name='external collar M2x8 screw '+str(angle)
            screw_bound=m.old.radial(c.cyl(1.,110.,(38.5,50.,-8.),'y')+c.cyl(1.9,102.,(38.5,54.,-8.),'y'),angle)
            contains(parts[screw_name],screw_bound,'M2 screw outside load bound')
            evidence(screw_name+' external entry and reverse',[screw_name],[(screw_name+' complete screw sweep',screw_bound)],prints,'Complete ordinary M2 cap screw head/shank with 100mm tangent approach; matching nut added externally.')
            key=c.hexagon(1.5/math.sqrt(3),2.,(38.5,5.,-8.),'y')+c.cyl(1.,88.,(38.5,50.,-8.),'y')+c.cyl(1.,14.,(38.5,93.,-15.))
            key=m.old.radial(key,angle)
            empty(key,parts[screw_name],'M2 nominal AF1.5 socket mismatch')
            operating=c.cyl(1.,90.,(38.5,49.,-8.),'y')+c.cyl(15.,2.,(38.5,93.,-8.),'y')
            entering=c.hexagon(1.5/math.sqrt(3),12.,(38.5,10.,-8.),'y')+c.cyl(1.,98.,(38.5,55.,-8.),'y')+c.cyl(15.,12.,(38.5,98.,-8.),'y')
            for phase,bound in [('entry',entering),('operation',operating),('withdrawal',entering)]:
                bound=m.old.radial(bound,angle)
                evidence(screw_name+' full AF1.5 tool '+phase,[screw_name],[(screw_name+' AF1.5 complete '+phase,bound)],{n:q for n,q in parts.items() if n!=screw_name},'Full Wera950L05021600001 AF1.5 90x14mm ordinary key, continuous handle/axial bounds; actual nominal socket fit checked separately.')
        half_bound=m.old.ring(33.5,80.,-9.5,-6.1)+m.old.ring(37.,80.,-6.1,1.)+m.old.ring(33.5,80.,1.,11.5)+m.old.ring(36.,80.,-9.75,-9.5)
        for name,part in parts.items():
            if not name.startswith('removable collar half '):continue
            contains(part,half_bound,'C half does not fit radial/height decomposition')
            box=part.bounding_box()
            if name.endswith('A') and box.max.X>1e-6:raise ValueError('C negative half crosses radial-separation plane')
            if name.endswith('B') and box.min.X< -1e-6:raise ValueError('C positive half crosses radial-separation plane')
            evidence(name+' external radial assembly and reverse',[name],[(name+' all-translation radial bound',half_bound)],{'fixed cup':cup},'Actual STEP half contained in disjoint R/Z bands. X<=0 half translates towardnegativeX and X>=0 half towardpositiveX; every point radius monotonically increases. 35mm separation stays withinR80. Bound clears both fixed race lips and fixed cup; mating half absent until zero-gap seam closure.')

    operations=[]
    head_shift=-.7 if report['concept']=='post-glue C' else -.2
    locked={q['name']:load(q) for q in report['stages']['locked']['components']}
    for name in parts:
        if not name.startswith('axial M4x12 socket screw'):continue
        angle=float(name.rsplit(' ',1)[1])+35.
        components={}
        target=locked[name]
        empty(key3(angle,head_shift=head_shift),target,'Nominal AF3 key/socket mismatch')
        pressed=key3(angle,head_shift=head_shift).translate((0,0,-.05))
        contact=a.channel_boolean(a.BRepAlgoAPI_Common,pressed.wrapped,target.wrapped)
        if mass(contact)<=1e-5:raise ValueError('3mmkey does not bottom on actual socket floor')
        contact_parts=Compound(contact).solids()
        floor_contact=[p.export_piece(c.Piece(name+' socket floor overtravel witness '+str(i),solid,'contact witness only; not print geometry'),output/'contact-witnesses') for i,solid in enumerate(contact_parts)]
        bounds=key3_sweeps(angle,head_shift)
        for phase,shape in bounds.items():
            for obstacle,solid in locked.items():
                if obstacle!=name:empty(shape,solid,'Full3mmkey '+phase+' blocked '+obstacle)
            empty(shape,bar,'Full3mmkey reaches bar')
        for phase,shape in bounds.items():components[phase]=[p.export_piece(c.Piece(name+' full '+phase,shape,'cup-fixed SOURCE tool bound'),output/'root-tools')]
        operations.append(dict(id=name+' clamp and reverse',tool_name='3 mm hex key',tool_part='Wera 950 L 05021615001',AF_mm=3,socket_floor_contact_witnesses=floor_contact,axis_source=dict(point=[*m.old.xy(38.,angle),5.2+head_shift],direction=[0,0,-1]),coordinate_frame='cup-fixed source; pose at nominal base gap, NOT lifted bar mouth',bar_mouth_z_rule='nominal gap plus stage cup shift',phases=components,base_and_bar_tool_checks_pending=True))
    drive_start=260. if report['concept']=='post-glue C' else 225.
    drive=m.old.xy(38.5,drive_start)
    drive_tool=c.hexagon(4/math.sqrt(3),6.5,(*drive,8.75))
    drive_tool+=c.cyl(3.,133.5,(*drive,78.75))+c.cyl(2.5,25.,(drive[0]+12.5,drive[1],143.),'x')
    drive_entry=c.hexagon(4/math.sqrt(3),106.5,(*drive,58.75))
    drive_entry+=c.cyl(3.,233.5,(*drive,128.75))+c.cyl(28.,105.,(*drive,193.))
    drive_tool=drive_tool.translate((0,0,delta));drive_entry=drive_entry.translate((0,0,delta))
    for obstacle,solid in parts.items():
        empty(drive_tool,solid,'Full4mmkey nominal fit blocked '+obstacle)
        empty(drive_entry,solid,'Full4mmkey axial approach blocked '+obstacle)
    empty(drive_entry,bar,'Full4mmkey axial approach blocked bar')
    if report['concept']=='post-glue C':
        final_drive=drive_tool.rotate(Axis.Z,35.)
        for name in locked:
            if name.startswith('axial M4x12 socket screw '):
                angle=float(name.rsplit(' ',1)[1])+35.
                for phase,shape in key3_sweeps(angle,head_shift).items():empty(shape,final_drive,'C full3/4key transfer clash '+phase)
    if report['concept']=='post-glue C':
        for obstacle,solid in parts.items():
            if obstacle.startswith('removable collar') or obstacle.startswith('external') or obstacle.startswith('axial M4') or obstacle.startswith('threaded M4'):continue
            if solid.bounding_box().max.Z>=drive_tool.bounding_box().min.Z:raise ValueError('Fixed C cup can enter 4mm drive height during turn')
    components={phase:[p.export_piece(c.Piece('4 mm cup drive full '+phase,shape.translate((0,0,delta)),'cup-fixed SOURCE tool bound'),output/'root-tools')] for phase,shape in drive4_sweeps(drive_start,drive_start+35.).items()}
    operations.append(dict(id='35 degree drive and reverse',tool_name='4 mm hex key',tool_part='Wera 950 L 05021620001',AF_mm=4,coordinate_frame='cup-fixed source; pose at nominal gap',phases=components,base_and_bar_tool_checks_pending=True))
    for file,sha in {**inputs,**sources}.items():
        if hashlib.sha256(Path(file).read_bytes()).hexdigest()!=sha:raise ValueError('Input changed during proof')
    result=dict(schema=1,scope='CONTINUOUS EXTERNAL GRIP/SERVICE BOUNDS AND ROOT TOOL BOUNDS ONLY',source_receipt_sha256=inputs[str(source.resolve())],source_receipt=str(source.resolve()),input_files=inputs,
        evidence=records,root_tool_operations=operations,complete_external_module_assembly_verified=False,complete_lifecycle_verified=False,base_tool_checks_verified=False,
        pending=['C independent race-stop transitions','Base tool integration','Lifecycle and rotation connectivity'],
        source_code_sha256={f.name:sha for f,sha in sources.items()})
    (output/'receipt.json').write_text(json.dumps(result,indent=2)+'\n');print('CONTINUOUS GRIP AND TOOL BOUNDS PASS',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();run(args.source,args.output)
