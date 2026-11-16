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
 routing=inputs(snapshot()); assert routing[1:4]==(1,5000000,2) and routing[4:10]==(3,5000000,0,3,0,0) and not any(routing[10:])
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
