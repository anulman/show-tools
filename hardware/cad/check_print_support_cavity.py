"""Read-only native support-centerline guard for the exact sealed bar cavity."""
import argparse,json,hashlib,math,re,zipfile,xml.etree.ElementTree as ET,sys,io
from pathlib import Path
from collections import Counter
from copy import deepcopy
import numpy as np,trimesh
from scipy.spatial import cKDTree
from build123d import Box,Compound,import_step,Shape
from OCP.BRepTools import BRepTools
from OCP.TopTools import TopTools_FormatVersion
from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS_Compound
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge
from OCP.BRepClass3d import BRepClass3d_SolidClassifier
from OCP.TopAbs import TopAbs_IN,TopAbs_ON
from OCP.gp import gp_Pnt,gp_Dir,gp_Ax2,gp_Circ
sys.path.insert(0,str(Path(__file__).resolve().parent))
f=__import__('importlib').import_module('disco-bar.integral_exposed_grip');a=f.a

def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def require(v,msg):
 if not v:raise ValueError(msg)
def fingerprint(shape):
 stream=io.BytesIO();BRepTools.Write_s(shape.wrapped,stream,False,False,TopTools_FormatVersion.TopTools_FormatVersion_VERSION_3)
 return hashlib.sha256(stream.getvalue()).hexdigest()
def cloud_error(x,y):return max(float(cKDTree(x).query(y)[0].max()),float(cKDTree(y).query(x)[0].max()))
def transform(text):
 v=[float(x) for x in text.split()] if text else [1,0,0,0,1,0,0,0,1,0,0,0]
 require(len(v)==12,'Invalid3mf transform');R=np.array(v[:9]).reshape(3,3).T;t=np.array(v[9:]);require(np.allclose(R,np.eye(3),atol=1e-9),'3mfaddsrotation/scale afterpreparedmesh; explicit handlingrequired');return t

def mf_vertices(path):
 with zipfile.ZipFile(path) as z:
  def walk(name,objectid=None,t=None):
   doc=ET.fromstring(z.read(name));ns={'m':doc.tag.split('}')[0][1:]};require(doc.attrib.get('unit','millimeter')=='millimeter','3mfunitschanged')
   if objectid is None:
    build=doc.findall('m:build/m:item',ns);require(len(build)==1,'3mfhasmultiplebuilditems')
    return walk(name,build[0].attrib['objectid'],transform(build[0].attrib.get('transform')))
   obj=next(o for o in doc.findall('m:resources/m:object',ns) if o.attrib['id']==objectid)
   vv=obj.findall('m:mesh/m:vertices/m:vertex',ns)
   if vv:return np.array([[float(v.attrib[k]) for k in ('x','y','z')] for v in vv])+t
   cc=obj.findall('m:components/m:component',ns);require(len(cc)==1,'3mfmultiplecomponents')
   c=cc[0];p=next((v for k,v in c.attrib.items() if k.endswith('}path')),name).lstrip('/')
   return walk(p,c.attrib['objectid'],t+transform(c.attrib.get('transform')))
  return walk('3D/3dmodel.model')

def parse(path):
 pos=np.zeros(3);epos=0.;relative=False;erel=False;feature='Custom';width=.5;height=.2;rows=[];features=Counter();linecount=0
 for lineno,line in enumerate(path.open(),1):
  if line.startswith('; FEATURE:'):feature=line.split(':',1)[1].strip()
  if line.startswith('; LINE_WIDTH:'):width=float(line.split(':',1)[1])
  if line.startswith('; LAYER_HEIGHT:'):height=float(line.split(':',1)[1])
  text=line.split(';',1)[0].strip()
  if not text:continue
  match=re.match(r'([GMT]\d+(?:\.\d+)?)',text)
  if not match:continue
  cmd=match[1];v={k:float(n) for k,n in re.findall(r'([XYZEFIJKR])\s*([-+]?(?:\d*\.\d+|\d+\.?\d*))',text[len(cmd):])}
  if cmd=='G20':raise ValueError('Inch Gcode unsupported')
  if cmd=='G90':relative=False
  if cmd=='G91':relative=True
  if cmd=='M82':erel=False
  if cmd=='M83':erel=True
  if cmd=='G92':
   require(not(set(v)&set('XYZ')),'G92XYZrequirescoordinateoriginhandling')
   if 'E'in v:epos=v['E']
  if cmd not in ('G0','G1','G2','G3'):continue
  target=pos.copy()
  for i,k in enumerate('XYZ'):
   if k in v:target[i]=pos[i]+v[k] if relative else v[k]
  de=(v.get('E',0.) if erel else v.get('E',epos)-epos)
  if 'E'in v:epos=epos+v['E'] if erel else v['E']
  if de>0 and (np.linalg.norm(target-pos)>1e-7 or cmd in ('G2','G3')):
   features[feature]+=1
   row=dict(line=lineno,cmd=cmd,start=pos.copy(),end=target.copy(),feature=feature,width=width,height=height)
   if cmd in ('G2','G3'):
    row['center']=pos[:2]+np.array([v.get('I',0),v.get('J',0)]);row['R_given']=v.get('R');row['planez']=pos[2]
   rows.append(row)
  pos=target
 return rows,features

def edge_of(row,inverse):
 p,q=row['start'],row['end']
 if row['cmd'] in ('G0','G1'):return BRepBuilderAPI_MakeEdge(gp_Pnt(*inverse(p)),gp_Pnt(*inverse(q))).Edge()
 require(row['R_given'] is None,'R-format arcunsupported');require(abs(p[2]-q[2])<1e-6,'Helical support/bridge arcunsupported')
 center=row['center'];r=float(np.linalg.norm(p[:2]-center));require(r>1e-7,'Zero arc radius')
 require(abs(np.linalg.norm(q[:2]-center)-r)<.02,'Arc endpoint radius mismatch')
 # Build directly in the source plane using inverse-rotated circle axes.
 o=inverse(np.r_[center,p[2]]);normal=inverse(np.r_[center,p[2]+1])-o;xdir=inverse(np.r_[center+[1,0],p[2]])-o
 circ=gp_Circ(gp_Ax2(gp_Pnt(*o),gp_Dir(*normal),gp_Dir(*xdir)),r)
 start=math.atan2(*(p[:2]-center)[::-1]);end=math.atan2(*(q[:2]-center)[::-1])
 delta=((end-start) if row['cmd']=='G3' else(start-end))%(2*math.pi)
 if delta<1e-9:return BRepBuilderAPI_MakeEdge(circ).Edge()
 return BRepBuilderAPI_MakeEdge(circ,start,start+delta).Edge() if row['cmd']=='G3' else BRepBuilderAPI_MakeEdge(circ,end,end+delta).Edge()

def main(q):
 require(not q.output.exists(),'Usefresh guardoutput');q.output.mkdir(parents=True)
 concept=json.loads(q.concept.read_text());record=concept['components'][0]
 require(digest(record['step'])==record['step_sha256'] and digest(record['stl'])==record['stl_sha256'],'Changed sourcebar')
 body=import_step(record['step']).solids()[0]
 bb=body.bounding_box()
 require(bb.min.X>-60 and bb.max.X<60 and bb.min.Y>-60 and bb.max.Y<60 and bb.min.Z>-112 and bb.max.Z<28,'Baroutsideclosed-air extraction envelope')
 air=Compound(a.channel_boolean(a.BRepAlgoAPI_Cut,Box(120,120,140).translate((0,0,-42)).wrapped,deepcopy(body).wrapped))
 enclosed=[s for s in air.solids() if s.bounding_box().min.X>-59.99 and s.bounding_box().max.X<59.99]
 require(len(enclosed)==1,'Expectedoneclosedcavity');cavity=enclosed[0];bounds=cavity.bounding_box();lo=np.array([bounds.min.X,bounds.min.Y,bounds.min.Z]);hi=np.array([bounds.max.X,bounds.max.Y,bounds.max.Z])
 raw=trimesh.load_mesh(record['stl']);prepared=trimesh.load_mesh(q.prepared)
 angle=math.radians(q.rotation_x);R=np.array([[1,0,0],[0,math.cos(angle),-math.sin(angle)],[0,math.sin(angle),math.cos(angle)]])
 rotated=raw.vertices@R.T;tprep=prepared.bounds.mean(0)-(np.max(rotated,0)+np.min(rotated,0))/2
 e1=cloud_error(rotated+tprep,prepared.vertices);require(e1<.001,'Prepared mesh differs from specified source rotation')
 mf=mf_vertices(q.three_mf);tplate=(np.max(mf,0)+np.min(mf,0))/2-prepared.bounds.mean(0)
 e2=cloud_error(prepared.vertices+tplate,mf);require(e2<.001,'3mfworldmesh differs from prepared mesh+plate translation')
 result=json.loads(q.result.read_text());objects=result['sliced_plates'][0]['objects'];require(len(objects)==1,'Resultcontainsmultipleobjects');b=objects[0]['bbox']
 require(np.allclose(np.min(mf,0),[b['x'],b['y'],b['z']],atol=.001),'Result/3mf lowerbbox differs')
 require(np.allclose(np.ptp(mf,0),[b['width'],b['depth'],b['height']],atol=.001),'Result/3mf dimensions differ')
 t=tprep+tplate
 offset_lines=[l.split('=',1)[1].strip() for l in q.gcode.read_text().splitlines() if l.startswith('; extruder_offset =')]
 require(len(offset_lines)==1 and len(offset_lines[0].split(','))==1,'Needexactsingle-extruderoffset')
 offset=np.r_[[float(x) for x in offset_lines[0].split('x')],0.]
 require(offset.shape==(3,),'Invalidextruderoffset')
 inverse=lambda p:R.T@(np.array(p)+offset-t)
 rows,features=parse(q.gcode);support=[r for r in rows if r['feature'].startswith('Support')]
 bridges=[r for r in rows if r['feature']=='Bridge'];floating=[r for r in rows if r['feature']=='Floating vertical shell']
 classifier=BRepClass3d_SolidClassifier(cavity.wrapped)
 def state(p):classifier.Perform(gp_Pnt(*p),1e-7);return classifier.State()
 control=BRepBuilderAPI_MakeEdge(gp_Pnt(-40,0,-60),gp_Pnt(40,0,-60)).Edge()
 test=Shape.cast(a.channel_boolean(a.BRepAlgoAPI_Common,control,deepcopy(cavity).wrapped));control_length=sum(e.length for e in test.edges());require(control_length>79.99,'Nativecavitypositivecontrolfailed')
 wall=BRepClass3d_SolidClassifier(body.wrapped);outer=[r for r in rows if r['feature']=='Outer wall'];insidewalls=0
 for r in outer[::max(1,len(outer)//100)][:100]:
  wall.Perform(gp_Pnt(*inverse((r['start']+r['end'])/2)),1e-7);insidewalls+=wall.State()==TopAbs_IN
 print('FRAME_DEBUG',insidewalls,'T',t.tolist(),'mesherrors',e1,e2,'firstwalls',[(r['line'],inverse((r['start']+r['end'])/2).tolist()) for r in outer[:3]],flush=True)
 require(insidewalls>=90,'Gcodewall/nativebody framepositivecontrolfailed')
 candidates=[]
 for r in support:
  pp=np.array([inverse(r['start']),inverse(r['end'])])
  if r['cmd'] in ('G0','G1') and (np.any(np.max(pp,0)<lo) or np.any(np.min(pp,0)>hi)):continue
  candidates.append(r)
 print('FRAME_PASS rotation',q.rotation_x,'support',len(support),'native_candidates',len(candidates),'wallsIN',insidewalls,flush=True)
 interior=boundary=0.;witnesses=[];common_count=0
 processed=0
 for batch_offset in range(0,len(candidates),500):
  group=candidates[batch_offset:batch_offset+500];compound=TopoDS_Compound();builder=BRep_Builder();builder.MakeCompound(compound)
  for r in group:builder.Add(compound,edge_of(r,inverse))
  common=Shape.cast(a.channel_boolean(a.BRepAlgoAPI_Common,compound,deepcopy(cavity).wrapped))
  require(not common.faces() and not common.solids(),'Commoncenterline resultcontainsfaces/solids')
  for edge in common.edges():
   length=edge.length;require(math.isfinite(length) and length>=0,'Invalid native edge length');p=edge.position_at(.5);st=state((p.X,p.Y,p.Z))
   if st==TopAbs_IN:interior+=length
   elif st==TopAbs_ON:boundary+=length
   else:raise ValueError('Native commonedgeclassifiedoutside')
   common_count+=1
   if len(witnesses)<5 and st==TopAbs_IN:witnesses.append(dict(source_midpoint_mm=[p.X,p.Y,p.Z],native_inside_edge_length_mm=length))
  processed=batch_offset+len(group)
  print('NATIVE_BATCH',processed,'inside_union_length',interior,flush=True)
  if q.stop_after_witness and interior>1e-6:break
 def stroke(r):
  return float(np.linalg.norm(r['end']-r['start'])) if r['cmd'] in ('G0','G1') else Shape.cast(edge_of(r,lambda x:np.array(x))).length
 longest=max(bridges,key=stroke) if bridges else None
 status='TRAPPED_SUPPORT_CENTERLINES' if interior>1e-6 else('CAVITY_BOUNDARY_CONTACT' if boundary>1e-6 else'NO_SUPPORT_CENTERLINE_IN_CLOSED_CAVITY')
 pins={str(p.resolve()):digest(p) for p in (q.concept,q.prepared,q.three_mf,q.result,q.gcode,Path(__file__),Path(record['step']),Path(record['stl']))}
 fresh=import_step(record['step']).solids()[0];require(body.is_valid and fingerprint(body)==fingerprint(fresh),'Actual bar subject mutated during cavity checks')
 report=dict(actual_bar_subject_reimport_unchanged=True,schema=1,status=status,checker_sources={str(Path(m.__file__).resolve()):digest(m.__file__) for m in (f,a,f.c)},source_input_files=pins,rotation_x_deg=q.rotation_x,source_to_print_rotation=R.tolist(),source_to_print_translation_mm=t.tolist(),gcode_to_material_extruder_offset_mm=offset.tolist(),prepared_frame_max_vertex_error_mm=e1,three_mf_frame_max_vertex_error_mm=e2,wall_frame_positive_samples_inside=insidewalls,closed_air_source_bounds_mm=[lo.tolist(),hi.tolist()],closed_air_volume_mm3=cavity.volume,native_positive_control_length_mm=control_length,support_extrusion_move_count=len(support),native_candidate_move_count=len(candidates),native_processed_move_count=processed,all_native_candidates_processed=processed==len(candidates),native_common_edge_count=common_count,native_strict_inside_common_edge_union_length_mm=interior,native_boundary_contact_common_edge_union_length_mm=boundary,witnesses=witnesses,feature_counts=features,bridge_stroke_count=len(bridges),maximum_bridge_coded_stroke_mm=stroke(longest) if longest else 0.,maximum_bridge_stroke_line=longest['line'] if longest else None,floating_vertical_shell_stroke_count=len(floating),maximum_floating_vertical_shell_stroke_mm=max(map(stroke,floating),default=0.),limits=['GcodeXYZ support centerline guard, not a swept deposited bead-volume proof','Bridge-coded stroke is not independently measured unsupported span','Noactualprinter/material/strength or manufacturing approval'],manufacturing_approved=False)
 (q.output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(status,interior,boundary,flush=True)
 if status!='NO_SUPPORT_CENTERLINE_IN_CLOSED_CAVITY':raise SystemExit(2)

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__)
 for name in ('concept','prepared','three-mf','result','gcode','output'):p.add_argument('--'+name,type=Path,required=True)
 p.add_argument('--rotation-x',type=float,required=True);p.add_argument('--stop-after-witness',action='store_true');main(p.parse_args())
