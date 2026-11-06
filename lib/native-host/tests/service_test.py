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
 table=[0x50464331,5,4,4,120,4,25,25,3,7,4,0,0,1,2,3,0,1,0,2,0,1,2,0,0,0,2,0,3,0,1,3,0,0,1,3,0,4,0,1,4,0,2,0,0,0,-1,3,1,0,0,-1,-1,0,0,0,1,-1,5,1,0,1,0,0,0,0,0,2,-1,4,1,0,-1,1,1,0,1,1,2,-1,3,1,0,2,-1,-1,0,0,0,3,3,6,2,3.25,-1,-1,-1,0,1,1,3,-1,4,1,0,-1,2,2,0,0,0,4,-1,7,0,0,-1,-1,0,0,0,0,1,1,0,1,1,1,1,2,2,1]
 packet=struct.pack('<%sd'%len(table),*table); manifest=b'{}'; setup=struct.pack('<III',len(manifest),len(packet),0)+struct.pack('<6I',*([0]*6))+struct.pack('<6I',*([1]*6))+bytes(32)+manifest+packet
 send(3,1,ident+struct.pack('<H',9)+setup)
 def result(seq):
  while True:
   t,q,b=recv()
   if t==4 and q==seq:
    print('result',seq,struct.unpack('<IiQ',b)); return struct.unpack('<IiQ',b)
 assert result(1)[0]==0
 profiles=struct.pack('<I6I6I',1,1,0,0,0,0,0,2,1,1,1,1,1)+struct.pack('<II4d',1,1,100,.2,.5,0)
 send(3,2,ident+struct.pack('<H',10)+profiles); assert result(2)[0]==0
 stale=struct.pack('<I6I6I',1,1,0,0,0,0,0,2,1,1,1,1,1)+struct.pack('<II4d',1,1,200,.2,.5,0)
 send(3,3,ident+struct.pack('<H',10)+stale); assert result(3)[0]!=0
 send(3,4,ident+struct.pack('<H6d',1,120,1,1,4,0,0)); assert result(4)[0]==0
 send(3,5,ident+struct.pack('<H2d',3,0,0)); assert result(5)[0]==0
 s.close(); time.sleep(.1)
 s=socket.socket(socket.AF_UNIX); s.settimeout(3); s.connect(path); t,q,hello2=recv(); assert hello2[:16]==ident[:16] and hello2[16:32]!=ident[16:32]; send(2,0); t,q,b=recv(); assert t==5 and struct.unpack_from('<Q',b,8)[0]==1 and struct.unpack_from('<I',b,16)[0]==2; offset=20+2+32
 assert struct.unpack_from('<I',b,offset)[0]==28
 phase=struct.unpack_from('<d',b,offset+4)[0]
 assert phase in (1,2), phase
 print('reconnected while transport remained active')
 s.close()
finally:
 host.terminate(); host.wait(timeout=15); p.cleanup()
