import os, socket, struct, subprocess, sys, tempfile, time
p=tempfile.TemporaryDirectory(); path=p.name+'/sock'; host=subprocess.Popen([sys.argv[1],path,'8000','127','32','30','.25'])
try:
 for _ in range(100):
  if os.path.exists(path): break
  time.sleep(.01)
 s=socket.socket(socket.AF_UNIX); s.settimeout(3); s.connect(path)
 def getn(n):
  b=b''
  while len(b)<n:
   x=s.recv(n-len(b)); assert x; b+=x
  return b
 def recv():
  m,v,t,l,q=struct.unpack('<IHHII',getn(16)); assert (m,v)==(0x31544853,1); return t,q,getn(l)
 def send(t,q,b=b''): s.sendall(struct.pack('<IHHII',0x31544853,1,t,len(b),q)+b)
 tag,seq,hello=recv(); assert tag==1; ident=hello[:32]; send(2,0)
 t,q,b=recv(); assert t==5 and struct.unpack_from('<I',b,16)[0]==0
 table=[0x50464331,6,4,4,120,4,25,25,3,7,4,0,0,1,2,3,0,1,0,2,0,1,2,0,0,0,2,0,3,0,1,3,0,0,1,3,0,4,0,1,4,0,2,0,0,0,-1,3,1,0,0,-1,-1,0,0,0,1,-1,5,1,0,1,0,0,0,0,0,2,-1,4,1,0,-1,1,1,0,1,1,2,-1,3,1,0,2,-1,-1,0,0,0,3,3,6,2,3.25,-1,-1,-1,0,1,1,3,-1,4,1,0,-1,2,2,0,0,0,4,-1,7,0,0,-1,-1,0,0,0,0,1,1,0,1,1,1,1,2,2,1]
 cue_begin=16+int(table[8])*9; cue_end=cue_begin+int(table[9])*11
 expanded=table[:cue_begin]; expanded[1]=7
 for index in range(cue_begin,cue_end,11): expanded+=table[index:index+11]+[0,0,0,-1,0]
 table=expanded+table[cue_end:]+[0x50464931,1,1,2,0]
 packet=struct.pack('<%sd'%len(table),*table); manifest=b'{}'; setup=struct.pack('<III',len(manifest),len(packet),0)+struct.pack('<6I',*([0]*6))+struct.pack('<6I',*([1]*6))+bytes(32)+manifest+packet
 send(3,1,ident+struct.pack('<H',9)+setup)
 def result(seq):
  while True:
   t,q,b=recv()
   if t==4 and q==seq:
    print('result',seq,struct.unpack('<IiQ',b)); return struct.unpack('<IiQ',b)
 def snapshot():
  while True:
   t,q,b=recv()
   if t==5: return b
 def inputs(b):
  offset=20+struct.unpack_from('<I',b,16)[0]+32
  arrays=[]
  while offset<len(b):
   length=struct.unpack_from('<I',b,offset)[0]; offset+=4
   arrays.append(struct.unpack_from('<%sd'%length,b,offset)); offset+=length*8
  assert len(arrays)==10 and len(arrays[-1])==196
  return arrays[-1]
 assert result(1)[0]==0
 generation=inputs(snapshot())[0]; assert generation>=1
 profiles=struct.pack('<I6I6I',1,1,0,0,0,0,0,2,1,1,1,1,1)+struct.pack('<II4d',1,1,100,.2,.5,0)
 send(3,2,ident+struct.pack('<H',10)+profiles); assert result(2)[0]==0
 stale=struct.pack('<I6I6I',1,1,0,0,0,0,0,2,1,1,1,1,1)+struct.pack('<II4d',1,1,200,.2,.5,0)
 send(3,3,ident+struct.pack('<H',10)+stale); assert result(3)[0]!=0
 send(3,4,ident+struct.pack('<H6d',1,120,1,1,4,0,0)); assert result(4)[0]==0
 send(3,5,ident+struct.pack('<H2d',3,0,0)); assert result(5)[0]==0
 send(3,6,ident+struct.pack('<H6d',14,3,5000000,generation,0,3,0)); assert result(6)[0]==0
 routing=inputs(snapshot()); assert routing[1:4]==(1,5000000,2 | (1 << 5)) and routing[4:10]==(3,5000000,0,3,0,0) and not any(routing[10:])
 send(3,7,ident+struct.pack('<H6d',16,3,5000000,generation,100,0,1)); assert result(7)[0]==0
 assert inputs(snapshot())[9]==100
 send(3,8,ident+struct.pack('<H6d',16,3,5000000,generation,100,0,1)); assert result(8)[0]!=0
 send(3,9,ident+struct.pack('<H2d',17,3,4999999)); assert result(9)[0]!=0
 assert inputs(snapshot())[1]==1
 s.close(); time.sleep(.1)
 s=socket.socket(socket.AF_UNIX); s.settimeout(3); s.connect(path); t,q,hello2=recv(); assert hello2[:16]==ident[:16] and hello2[16:32]!=ident[16:32]; send(2,0); t,q,b=recv(); assert t==5 and struct.unpack_from('<Q',b,8)[0]==1 and struct.unpack_from('<I',b,16)[0]==2; offset=20+2+32
 assert struct.unpack_from('<I',b,offset)[0]==28
 phase=struct.unpack_from('<d',b,offset+4)[0]
 assert phase in (1,2), phase
 routing=inputs(b); assert routing[0]==generation and routing[1]==0 and routing[2]==5000000 and not any(routing[4:])
 print('reconnected while transport remained active')
 ident=hello2[:32]
 send(3,1,ident+struct.pack('<H',2)); assert result(1)[0]==0
 send(3,2,ident+struct.pack('<H',9)+setup); assert result(2)[0]==0
 replacement=inputs(snapshot()); assert replacement[0]==generation+1 and replacement[2]==5000000
 send(3,3,ident+struct.pack('<H6d',14,3,5000001,replacement[0],0,3,0)); assert result(3)[0]==0
 before=inputs(snapshot()); assert before[1]==1
 broken=bytearray(setup); broken[94:102]=struct.pack('<d',0)
 send(3,4,ident+struct.pack('<H',9)+broken); assert result(4)[0]!=0
 after=inputs(snapshot()); assert after==before
 send(3,5,ident+struct.pack('<H6d',16,3,5000001,generation,1,0,1)); assert result(5)[0]!=0
 send(3,6,ident+struct.pack('<H6d',1,120,1,1,4,0,0)); assert result(6)[0]==0
 send(3,7,ident+struct.pack('<H6d',16,3,5000001,replacement[0],200,1,1)); assert result(7)[0]==0
 stopped=snapshot(); offset=20+struct.unpack_from('<I',stopped,16)[0]+32
 assert struct.unpack_from('<d',stopped,offset+4)[0]==0
 print('identified inputs retain watermarks, reject stale ownership, and preserve failed preparation')
 s.close()
finally:
 host.terminate(); host.wait(timeout=15); p.cleanup()

def fragmented_input_priority(invalidation, panic, saturated=False):
 with tempfile.TemporaryDirectory(prefix='native-input-priority-') as directory:
  socket_path=directory+'/sock'
  process=subprocess.Popen([sys.argv[1],socket_path,'8000','4000','32','30','.25','--step'],stdout=subprocess.DEVNULL)
  client=socket.socket(socket.AF_UNIX); client.settimeout(15)
  try:
   for _ in range(200):
    if os.path.exists(socket_path): break
    time.sleep(.01)
   client.connect(socket_path)
   def read_exact(length):
    data=b''
    while len(data)<length:
     chunk=client.recv(length-len(data)); assert chunk; data+=chunk
    return data
   def receive_frame():
    magic,version,tag,length,sequence=struct.unpack('<IHHII',read_exact(16))
    assert (magic,version)==(0x31544853,1)
    return tag,sequence,read_exact(length)
   def frame(tag,sequence,payload=b''):
    return struct.pack('<IHHII',0x31544853,1,tag,len(payload),sequence)+payload
   tag,sequence,hello=receive_frame(); assert tag==1
   identity=hello[:32]; client.sendall(frame(2,0))
   def result(sequence):
    while True:
     tag,observed,payload=receive_frame()
     if tag==4 and observed==sequence: return struct.unpack('<IiQ',payload)[0]
   def state():
    while True:
     tag,sequence,payload=receive_frame()
     if tag==5: return payload
   def command(sequence,operation,values=(),raw=None):
    return frame(3,sequence,identity+struct.pack('<H',operation)+(struct.pack('<%sd'%len(values),*values) if raw is None else raw))
   state()
   client.sendall(command(1,9,raw=setup)); assert result(1)==0
   generation=inputs(state())[0]
   client.sendall(command(2,14,[3,5000000,generation,0,3,0])); assert result(2)==0
   assert inputs(state())[1]==1
   first=3
   if invalidation in ('held','replay'):
    client.sendall(command(3,16,[3,5000000,generation,1,1,1])); assert result(3)==0
    assert inputs(state())[8]==2
    first=4
    if invalidation=='replay':
     client.sendall(command(4,16,[3,5000000,generation,2,1,0])); assert result(4)==0
     assert inputs(state())[9]==2
     first=5
   count=256 if saturated else 17
   packets=[]
   if invalidation=='revoke': packets.append(command(first,17,[3,5000000]))
   elif invalidation=='prepare': packets.append(command(first,9,raw=setup))
   for sequence in range(first+len(packets),first+count-1): packets.append(command(sequence,7,[0]))
   start=first+count-1
   packets.append(command(start,1,[120,1,1,4,0,0]))
   observation=start+1
   candidate=command(observation,16,[3,5000000,generation,2 if invalidation=='held' else 1,1 if panic else 0,1])
   # Keep the IO copy at the admitted lease while the owner consumes revocation/preparation.
   client.sendall(b''.join(packets)+candidate[:-1]); time.sleep(.65); client.sendall(candidate[-1:])
   outcomes={}
   while len(outcomes)<count+1:
    tag,sequence,payload=receive_frame()
    if tag==4 and first<=sequence<=observation: outcomes[sequence]=struct.unpack('<IiQ',payload)[0]
   client.sendall(command(observation+1,7,[0])); assert result(observation+1)==0
   latest=state()
   run=struct.unpack_from('<Q',latest,8)[0]
   canceled=sum(value==2 for value in outcomes.values())
   evidence=(invalidation,panic,saturated,outcomes[start],outcomes[observation],run,canceled)
   if invalidation in ('revoke','prepare'):
    assert outcomes[first]==0, evidence
    assert outcomes[start]==0 and run==1+(invalidation=='prepare') and canceled==0, evidence
    assert outcomes[observation]==(3 if saturated and not panic else 1), evidence
   elif invalidation in ('held','replay'):
    assert outcomes[start]==0 and run==1 and canceled==0, evidence
    assert outcomes[observation]==(0 if invalidation=='held' else 1), evidence
   else:
    assert panic and outcomes[observation]==0 and outcomes[start]==2 and run==0 and canceled>0, evidence
   print('fragmented priority',evidence)
  finally:
   client.close(); process.terminate(); process.wait(timeout=15)

for invalidation in ('revoke','prepare'):
 for panic in (False,True): fragmented_input_priority(invalidation,panic)
for panic in (False,True): fragmented_input_priority('revoke',panic,True)
fragmented_input_priority(None,True,True)
fragmented_input_priority('held',True)
fragmented_input_priority('replay',True)
