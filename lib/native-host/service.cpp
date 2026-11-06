#include "instrument.h"
#include "frame.h"
#include "spsc_queue.h"
#include "performance_light_output.h"
#ifdef NATIVE_ALSA_HOST
#include "alsa_pcm.h"
#include "alsa_run.h"
#endif
#include <algorithm>
#include <array>
#include <cstdlib>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <fstream>
#include <iostream>
#include <random>
#include <thread>
#include <vector>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>
#include <poll.h>
#include <signal.h>
#ifdef __linux__
#include <sys/prctl.h>
#endif
#include <limits>

using namespace native_host;
namespace {
using Bytes = std::vector<uint8_t>;
uint32_t u32(const uint8_t* p) { return uint32_t(p[0]) | uint32_t(p[1])<<8 | uint32_t(p[2])<<16 | uint32_t(p[3])<<24; }
uint16_t u16(const uint8_t* p) { return uint16_t(p[0]) | uint16_t(p[1])<<8; }
double f64(const uint8_t* p) { uint64_t bits=0; for (int i=0;i<8;++i) bits |= uint64_t(p[i])<<(8*i); double v; std::memcpy(&v,&bits,8); return v; }
void put32(Bytes& out,uint32_t n) { for (int i=0;i<4;++i) out.push_back(uint8_t(n>>(8*i))); }
void put64(Bytes& out,uint64_t n) { for (int i=0;i<8;++i) out.push_back(uint8_t(n>>(8*i))); }
void put_double(Bytes& out,double v) { uint64_t bits; std::memcpy(&bits,&v,8); put64(out,bits); }
template<size_t N> void array(Bytes& out,const std::array<double,N>& values) { put32(out,N); for (double v:values) put_double(out,v); }
bool receive(int fd,void* data,size_t size) { auto* p=static_cast<uint8_t*>(data); while(size) { auto n=::recv(fd,p,size,0); if(n<=0)return false; p+=n; size-=size_t(n); } return true; }
bool send_all(int fd,const void* data,size_t size) { auto* p=static_cast<const uint8_t*>(data); while(size) { auto n=::send(fd,p,size,0); if(n<=0)return false; p+=n; size-=size_t(n); } return true; }
bool send_frame(int fd,uint16_t tag,uint32_t sequence,const Bytes& payload) { uint8_t header[16]; encode_header(header,{tag,uint32_t(payload.size()),sequence}); return send_all(fd,header,16)&&send_all(fd,payload.data(),payload.size()); }
struct Observation {
  uint64_t revision=0, run=0;
  std::array<double,PF_FIELDS> state{};
  std::array<double,PF_CHANNELS*PF_CHANNEL_FIELDS> channels{};
  std::array<double,PF_VOICE_PROFILES*PF_VOICE_FIELDS> voices{};
  std::array<double,PF_VOICE_PROFILES*PF_MAX_LIVE_EFFECTS*PF_VOICE_EFFECT_FIELDS> effects{};
  std::array<double,PF_LIVE_FIELDS> live{};
  std::array<double,PF_COMPILED_MAX_TAKES*PF_TAKE_FIELDS> takes{};
  std::array<double,PF_TEMPO_FIELDS> tempo{};
  std::array<double,PF_LIGHT_FIELDS> lights{};
};
struct Request { uint64_t connection=0, order=0; uint32_t sequence=0; uint16_t op=0; std::array<double,6> args{}; Bytes manifest,packet; std::array<uint8_t,32> digest{}; std::array<uint32_t,6> counts{},revisions{}; std::vector<pf_effect_definition> effects; int status=1,code=0; Observation observation; };
void observe(Instrument& instrument,Observation& out,uint64_t revision) {
  out={}; out.revision=revision; auto* e=instrument.engine(); if(!e)return;
  pf_snapshot(e,out.state.data());
  for(int i=0;i<PF_CHANNELS;++i) pf_channel_info(e,i,out.channels.data()+i*PF_CHANNEL_FIELDS);
  for(int i=0;i<PF_VOICE_PROFILES;++i) { pf_voice_info(e,i,out.voices.data()+i*PF_VOICE_FIELDS); for(int j=0;j<PF_MAX_LIVE_EFFECTS;++j) pf_voice_effect_info(e,i,j,out.effects.data()+(i*PF_MAX_LIVE_EFFECTS+j)*PF_VOICE_EFFECT_FIELDS); }
  for(int i=0;i<PF_COMPILED_MAX_TAKES;++i) pf_compiled_take_info(e,i,out.takes.data()+i*PF_TAKE_FIELDS);
  pf_live_info(e,out.live.data());
  pf_tempo_info(e,out.tempo.data());
  pf_light_output(e,out.lights.data());
}
struct Presentation { Bytes manifest; std::array<uint8_t,32> digest{}; };
Bytes snapshot(const Observation& state,const Presentation& presentation) {
  Bytes out; out.reserve(22000+presentation.manifest.size()); put64(out,state.revision); put64(out,state.run); put32(out,uint32_t(presentation.manifest.size())); out.insert(out.end(),presentation.manifest.begin(),presentation.manifest.end()); out.insert(out.end(),presentation.digest.begin(),presentation.digest.end());
  array(out,state.state); array(out,state.channels); array(out,state.voices); array(out,state.effects); array(out,state.live); array(out,state.takes); array(out,state.tempo); array(out,state.lights); return out;
}
int64_t discard(void*,const float*,uint32_t frames) { return frames; }
}
namespace {
bool parse(Request& request,const Bytes& data) {
  if(data.size()<34)return false;
  request.op=u16(data.data()+32);
  const uint8_t* p=data.data()+34; size_t left=data.size()-34;
  if(request.op<=8) {
    const size_t counts[]={0,6,0,2,1,3,1,1,1};
    if(!request.op || left!=counts[request.op]*8)return false;
    for(size_t i=0;i<counts[request.op];++i) { request.args[i]=f64(p+i*8); if(!std::isfinite(request.args[i]) || std::abs(request.args[i])>1000000) return false; }
    auto integer=[](double value) { return std::floor(value)==value; };
    if(request.op==1 && (!integer(request.args[1]) || !integer(request.args[2]) || !integer(request.args[3]) || !integer(request.args[4]) || !integer(request.args[5]))) return false;
    if((request.op==3 || request.op==4 || request.op==5 || request.op==6 || request.op==7) && !integer(request.args[0])) return false;
    if(request.op==5 && !integer(request.args[2]))return false;
    return true;
  }
  if(request.op==11) { if(left!=4)return false; request.args[0]=u32(p); return request.args[0]>=1 && request.args[0]<=1000000; }
  if(request.op!=9 && request.op!=10)return false;
  uint32_t manifest_size=0,packet_size=0;
  if(request.op==9) { if(left<8)return false; manifest_size=u32(p); packet_size=u32(p+4); p+=8; left-=8; if(manifest_size>1024*1024 || packet_size==0)return false; }
  if(left<52)return false;
  uint32_t effect_count=u32(p); p+=4; left-=4;
  if(effect_count>PF_VOICE_PROFILES*PF_MAX_LIVE_EFFECTS)return false;
  uint32_t sum=0;
  for(auto& count:request.counts) { count=u32(p);p+=4;left-=4; if(count>PF_MAX_LIVE_EFFECTS)return false; sum+=count; }
  for(auto& revision:request.revisions) { revision=u32(p);p+=4;left-=4; }
  if(sum!=effect_count)return false;
  if(request.op==9) {
    if(left<32 || uint64_t(manifest_size)+packet_size+uint64_t(effect_count)*40 != left-32)return false;
    std::copy_n(p,32,request.digest.data()); p+=32; left-=32;
    request.manifest.assign(p,p+manifest_size); p+=manifest_size; left-=manifest_size;
    request.packet.assign(p,p+packet_size); p+=packet_size; left-=packet_size;
  } else if(left!=size_t(effect_count)*40)return false;
  request.effects.resize(effect_count);
  for(auto& effect:request.effects) {
    effect={}; effect.type=u32(p); effect.version=u32(p+4);
    double values[4]; for(int i=0;i<4;++i) { values[i]=f64(p+8+i*8); if(!std::isfinite(values[i]))return false; }
    if(effect.type==PF_EFFECT_SLAPBACK) effect.parameters.slapback={values[0],values[1],values[2]};
    else if(effect.type==PF_EFFECT_CHORUS) effect.parameters.chorus={values[0],values[1],values[2],values[3]};
    else return false;
    p+=40;
  }
  return true;
}
}
namespace {
struct Event { uint64_t run=0; std::array<double,PF_EVENT_FIELDS> fields{}; };
struct Shared {
  SpscQueue<Request*,256> commands,results;
  SpscQueue<Request*,1> stops,stop_results;
  SpscQueue<Observation,2> observations;
  SpscQueue<Event,256> events;
  std::atomic<uint64_t> dropped{0};
  std::atomic<bool> done{false}, device_failed{false};
};
void owner(Shared& shared,InstrumentConfig config,uint32_t block,float input_level,bool stepped
#ifdef NATIVE_ALSA_HOST
    , std::unique_ptr<native_alsa::AlsaPcm> device
#endif
) {
  Instrument instrument(config);
#ifdef NATIVE_ALSA_HOST
  AlsaRun alsa_run;
#endif
  std::vector<float> input(block,input_level);
  uint64_t revision=0, run=0; unsigned tick=0;
  auto publish=[&](Observation& obs) { observe(instrument,obs,revision); obs.run=run; };
  auto drain=[&] {
    if(!instrument.engine())return;
    std::array<double,PF_EVENT_FIELDS> data{};
    while(pf_drain_events(instrument.engine(),data.data(),1)) {
      Event event{run,data}; if(!shared.events.push(event))shared.dropped.fetch_add(1,std::memory_order_relaxed);
    }
  };
  auto process=[&](Request* r,bool canceled) {
    int rc=-1;
    if(canceled) { r->status=2; }
    else {
      auto& a=r->args;
      switch(r->op) {
        case 0: rc=0; break;
        case 1:
#ifdef NATIVE_ALSA_HOST
          rc=alsa_run.start(instrument,*device,{a[0],int(a[1]),int(a[2]),int(a[3]),int(a[4]),int(a[5])});
          if(rc==-2) shared.device_failed=true;
#else
          rc=instrument.start({a[0],int(a[1]),int(a[2]),int(a[3]),int(a[4]),int(a[5])})?0:-1;
#endif
          break;
        case 2: instrument.stop();
#ifdef NATIVE_ALSA_HOST
          if(alsa_run.drop(*device)<0) { shared.device_failed=true; break; }
#endif
          rc=0; break;
        case 3: rc=instrument.control(int(a[0]),a[1]);
#ifdef NATIVE_ALSA_HOST
          if(rc==0 && int(a[0])==4 && alsa_run.drop(*device)<0) { shared.device_failed=true; rc=-1; }
#endif
          break;
        case 4: rc=instrument.select(int(a[0])); break;
        case 5: rc=instrument.set_channel(int(a[0]),a[1],int(a[2])); break;
        case 6: rc=instrument.set_automatic(int(a[0])); break;
        case 7: rc=instrument.set_click(int(a[0])); break;
        case 8: rc=instrument.set_click_gain(a[0]); break;
        case 9: {
          Profiles profiles{r->counts,r->revisions,r->effects.data(),uint32_t(r->effects.size())};
          if(instrument.prepare(r->packet.data(),uint32_t(r->packet.size()),profiles)) {
            rc=0;
          }
          break;
        }
        case 11: {
          if(!stepped || instrument.lifecycle()!=Lifecycle::Running)break;
          uint32_t remaining=uint32_t(a[0]); rc=0;
          while(remaining && instrument.lifecycle()==Lifecycle::Running) { auto frames=std::min(remaining,block); if(instrument.render(input.data(),frames)<0 || instrument.write(discard,nullptr)<0) { rc=-1; break; } remaining-=frames; drain(); }
          break;
        }
        case 10: {
          bool valid=instrument.engine()!=nullptr;
          uint32_t offset=0;
          for(uint32_t i=0;valid && i<PF_VOICE_PROFILES;++i) {
            std::array<double,PF_VOICE_FIELDS> info{}; pf_voice_info(instrument.engine(),i,info.data());
            const auto current=uint32_t(info[PF_VOICE_REVISION]);
            if(r->revisions[i]<current || uint64_t(r->revisions[i])>uint64_t(current)+1)valid=false;
            if(valid && r->revisions[i]==current) {
              if(r->counts[i]!=uint32_t(info[PF_VOICE_STAGE_COUNT])) valid=false;
              for(uint32_t j=0;valid && j<r->counts[i];++j) {
                std::array<double,PF_VOICE_EFFECT_FIELDS> applied{};
                pf_voice_effect_info(instrument.engine(),i,j,applied.data());
                const auto& effect=r->effects[offset+j];
                std::array<double,PF_VOICE_EFFECT_FIELDS> requested{};
                requested[0]=effect.type; requested[1]=effect.version;
                if(effect.type==PF_EFFECT_SLAPBACK) {
                  const auto& p=effect.parameters.slapback; requested[2]=p.delay_ms; requested[3]=p.feedback; requested[4]=p.wet;
                } else {
                  const auto& p=effect.parameters.chorus; requested[2]=p.rate_hz; requested[3]=p.depth_ms; requested[4]=p.base_delay_ms; requested[5]=p.wet;
                }
                if(requested!=applied)valid=false;
              }
            }
            offset+=r->counts[i];
          }
          Profiles profiles{r->counts,r->revisions,r->effects.data(),uint32_t(r->effects.size())}; rc=valid && instrument.prepare_profiles(profiles)?0:-1; break;
        }
      }
      if(instrument.engine()) { pf_flush(instrument.engine()); std::array<double,PF_FIELDS> state{}; pf_snapshot(instrument.engine(),state.data()); r->code=int(state[PF_ERROR]); }
      r->status=rc<0?1:0; if(rc>=0 && r->op) { ++revision; if(r->op==1)++run; }
    }
    drain(); publish(r->observation);
  };
  #ifndef NATIVE_ALSA_HOST
  auto next=std::chrono::steady_clock::now();
#endif
  while(!shared.done.load(std::memory_order_relaxed)) {
    Request* stop=nullptr;
    if(shared.stops.pop(stop)) {
      process(stop,false); shared.stop_results.push(stop);
      Request* pending=nullptr;
      while(shared.commands.pop(pending)) { process(pending,pending->order<stop->order); shared.results.push(pending); }
    }
    Request* request=nullptr;
    for(unsigned i=0;i<16 && shared.commands.pop(request);++i) { process(request,false); shared.results.push(request); }
    if(!stepped && (instrument.lifecycle()==Lifecycle::Running || instrument.pending()
#ifdef NATIVE_ALSA_HOST
        || alsa_run.active()
#endif
        )) {
      const auto previous_lifecycle=instrument.lifecycle();
#ifdef NATIVE_ALSA_HOST
      if(instrument.pending()) {
        if(instrument.write([](void* d,const float* p,uint32_t n)->int64_t { return static_cast<native_alsa::AlsaPcm*>(d)->write(p,n); },device.get())<0) shared.device_failed=true;
      } else if(instrument.lifecycle()==Lifecycle::Running) {
        auto frames=device->read(input.data(),block);
        if(frames<0 || (frames>0 && instrument.render(input.data(),uint32_t(frames))<0)) shared.device_failed=true;
      }
      if(!shared.device_failed.load() && alsa_run.complete(instrument,*device)<0) shared.device_failed=true;
      if(shared.device_failed.load()) instrument.stop();
#else
      if(instrument.pending()) instrument.write(discard,nullptr);
      else if(instrument.render(input.data(),block)==0) instrument.write(discard,nullptr);
#endif
      drain();
      if(previous_lifecycle!=instrument.lifecycle()) { ++revision; Observation state; publish(state); shared.observations.push(state); }
    }
    if(++tick==10) { tick=0; if(!stepped && instrument.lifecycle()==Lifecycle::Running) { ++revision; Observation state; publish(state); shared.observations.push(state); } }
#ifdef NATIVE_ALSA_HOST
    if(instrument.lifecycle()!=Lifecycle::Running) std::this_thread::sleep_for(std::chrono::milliseconds(1));
#else
    next+=std::chrono::nanoseconds(int64_t(1000000000.0*block/config.sample_rate));
    std::this_thread::sleep_until(next);
#endif
  }
  instrument.stop();
}
}
namespace {
std::atomic<bool> quit{false};
void signal_stop(int) { quit.store(true,std::memory_order_relaxed); }
void random_bytes(uint8_t* out,size_t n) { std::random_device random; for(size_t i=0;i<n;++i)out[i]=uint8_t(random()); }
bool send_result(int fd,Request* request,const Presentation& presentation,uint64_t& published_revision) {
  Bytes payload; put32(payload,uint32_t(request->status)); put32(payload,uint32_t(request->code)); put64(payload,request->observation.revision);
  if(request->op && !send_frame(fd,4,request->sequence,payload))return false;
  if(request->observation.revision<published_revision)return true;
  published_revision=request->observation.revision;
  return send_frame(fd,5,0,snapshot(request->observation,presentation));
}
void run_connection(int fd,Shared& shared,const std::array<uint8_t,16>& epoch,uint64_t connection,uint64_t& order,Presentation& presentation) {
  std::array<uint8_t,32> identity{}; std::copy(epoch.begin(),epoch.end(),identity.begin()); random_bytes(identity.data()+16,16);
  Bytes hello(identity.begin(),identity.end()); put32(hello,PF_ABI_VERSION); put32(hello,PF_COMPILED_VERSION);
  if(!send_frame(fd,1,0,hello))return;
  uint8_t bytes[16]; FrameHeader header{};
  if(!receive(fd,bytes,16) || !decode_header(bytes,header) || header.tag!=2 || header.sequence || header.length)return;
  auto* bootstrap=new Request; bootstrap->connection=connection; bootstrap->order=++order;
  if(!shared.commands.push(bootstrap)) { delete bootstrap; return; }
  uint32_t highest=0; size_t outstanding=1, pending_bytes=0; bool stop_outstanding=false;
  bool active=true, bootstrapped=false; uint64_t published_revision=0;
  while(active && !quit.load(std::memory_order_relaxed) && !shared.device_failed.load()) {
    Request* result=nullptr;
    while(shared.results.pop(result)) {
      if(result->connection==connection) {
        if(outstanding)--outstanding;
        pending_bytes-=result->packet.size()+result->manifest.size()+result->effects.size()*40;
        if(result->op==9 && result->status==0) { presentation.manifest=std::move(result->manifest); presentation.digest=result->digest; }
        if(result->op==0) bootstrapped=true;
        if(!send_result(fd,result,presentation,published_revision))active=false;
      }
      delete result;
    }
    while(shared.stop_results.pop(result)) {
      if(result->connection==connection) { stop_outstanding=false; if(!send_result(fd,result,presentation,published_revision))active=false; }
      delete result;
    }
    Observation observation;
    while(bootstrapped && shared.observations.pop(observation)) if(observation.revision>=published_revision) { published_revision=observation.revision; if(!send_frame(fd,5,0,snapshot(observation,presentation)))active=false; }
    Event event;
    while(bootstrapped && shared.events.pop(event)) { Bytes payload; put64(payload,event.run); array(payload,event.fields); if(!send_frame(fd,6,0,payload))active=false; }
    auto lost=bootstrapped ? shared.dropped.exchange(0,std::memory_order_relaxed) : 0;
    if(lost) { Bytes payload; put64(payload,lost); if(!send_frame(fd,7,0,payload))active=false; }
    if(!active)break;
    if(!bootstrapped) { std::this_thread::sleep_for(std::chrono::milliseconds(1)); continue; }
    pollfd descriptor{fd,POLLIN,0}; int ready=::poll(&descriptor,1,10);
    if(ready<0 || (ready && !(descriptor.revents&POLLIN)))break;
    if(!ready)continue;
    if(!receive(fd,bytes,16) || !decode_header(bytes,header) || header.tag!=3 || !header.sequence || header.sequence<=highest)break;
    highest=header.sequence;
    Bytes payload(header.length); if(!receive(fd,payload.data(),payload.size()))break;
    if(payload.size()<34 || !std::equal(identity.begin(),identity.end(),payload.begin()))break;
    auto* request=new Request; request->sequence=header.sequence; request->connection=connection; request->order=++order;
    if(!parse(*request,payload)) { delete request; break; }
    bool is_stop=request->op==2 || (request->op==3 && request->args[0]==4);
    size_t request_bytes=request->packet.size()+request->manifest.size()+request->effects.size()*40;
    if(request_bytes>16*1024*1024-pending_bytes || (is_stop && stop_outstanding) || (!is_stop && outstanding>=256) ||
       !(is_stop?shared.stops.push(request):shared.commands.push(request))) {
      Bytes response; put32(response,3); put32(response,0); put64(response,0); active=send_frame(fd,4,request->sequence,response); delete request;
    } else if(is_stop) stop_outstanding=true; else { ++outstanding; pending_bytes+=request_bytes; }
  }
  while(outstanding || stop_outstanding) {
    Request* result=nullptr;
    while(shared.results.pop(result)) { if(result->op==9 && result->status==0) { presentation.manifest=std::move(result->manifest); presentation.digest=result->digest; } if(result->connection==connection && outstanding)--outstanding; delete result; }
    while(shared.stop_results.pop(result)) { if(result->connection==connection)stop_outstanding=false; delete result; }
    if(outstanding || stop_outstanding)std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
}
}
int main(int argc,char** argv) {
  pid_t owner_pid=0;
  if(argc>=3 && std::string(argv[argc-2])=="--owner-pid") {
    char* end=nullptr; auto value=std::strtol(argv[argc-1],&end,10);
    if(end==argv[argc-1] || *end || value<=1 || value>std::numeric_limits<pid_t>::max() || pid_t(value)!=getppid()) {
      std::cerr<<"owner PID must match the actual parent\n"; return 2;
    }
    owner_pid=pid_t(value); argc-=2;
#ifdef __linux__
    if(prctl(PR_SET_PDEATHSIG,SIGKILL)<0 || getppid()!=owner_pid)return 1;
#else
    std::thread([owner_pid] {
      while(getppid()==owner_pid)std::this_thread::sleep_for(std::chrono::milliseconds(100));
      _exit(1);
    }).detach();
#endif
  }

#ifdef NATIVE_ALSA_HOST
  if(argc!=13) { std::cerr<<"usage: native_alsa_host SOCKET SAMPLE_RATE BLOCK_FRAMES MAX_VOICES MAX_SECONDS CAPTURE_DEVICE PLAYBACK_DEVICE CAPTURE_CHANNELS INPUT_CHANNEL PERIOD_FRAMES BUFFER_FRAMES s32|float [--owner-pid PID]\n"; return 2; }
  bool stepped=false;
#else
  if(argc!=7 && !(argc==8 && std::string(argv[7])=="--step")) { std::cerr<<"usage: native_fake_host SOCKET SAMPLE_RATE BLOCK_FRAMES MAX_VOICES MAX_SECONDS INPUT_LEVEL [--step] [--owner-pid PID]\n"; return 2; }
  bool stepped=argc==8;
#endif
  char* end=nullptr;
  double rate=std::strtod(argv[2],&end); if(*end || !std::isfinite(rate) || rate<8000 || rate>192000)return 2;
  unsigned long block=std::strtoul(argv[3],&end,10); if(*end || block<1 || block>16384)return 2;
  long voices=std::strtol(argv[4],&end,10); if(*end || voices<1 || voices>256)return 2;
  double seconds=std::strtod(argv[5],&end); if(*end || !std::isfinite(seconds) || seconds<=0 || seconds>3600)return 2;
#ifdef NATIVE_ALSA_HOST
  if(std::floor(rate)!=rate) return 2;
  auto number=[&](const char* value)->unsigned long { char* e=nullptr; auto n=std::strtoul(value,&e,10); return e==value || *e ? 0 : n; };
  auto channels=number(argv[8]), input=number(argv[9]), period=number(argv[10]), buffer=number(argv[11]);
  std::string format=argv[12];
  if(channels<1 || channels>64 || input>=channels || period<1 || period>16384 || buffer<period || buffer>1048576 || (format!="s32" && format!="float")) return 2;
  native_alsa::Config device_config{argv[6],argv[7],unsigned(rate),unsigned(channels),unsigned(input),unsigned(period),unsigned(buffer),uint32_t(block),format=="s32" ? native_alsa::SampleFormat::S32LE : native_alsa::SampleFormat::FloatLE};
  std::string error; auto device=native_alsa::AlsaPcm::open(device_config,error);
  if(!device) { std::cerr<<"ALSA open failed: "<<error<<"\n"; return 1; }
  double level=0;
#else
  double level=std::strtod(argv[6],&end); if(*end || !std::isfinite(level) || std::abs(level)>1)return 2;
#endif
  std::string path=argv[1]; auto slash=path.find_last_of('/'); if(slash==std::string::npos || slash==0 || path.size()>=sizeof(sockaddr_un::sun_path))return 2;
  struct stat dir{}; auto parent=path.substr(0,slash);
  if(stat(parent.c_str(),&dir)<0 || !S_ISDIR(dir.st_mode) || dir.st_uid!=geteuid() || (dir.st_mode&077)) { std::cerr<<"socket directory must be owned by the caller and private\n"; return 2; }
  int server=socket(AF_UNIX,SOCK_STREAM,0); if(server<0)return 1;
  sockaddr_un addr{}; addr.sun_family=AF_UNIX; std::memcpy(addr.sun_path,path.c_str(),path.size()+1);
  mode_t old=umask(0077); int bound=bind(server,reinterpret_cast<sockaddr*>(&addr),sizeof(addr)); umask(old);
  if(bound<0 || listen(server,1)<0) { close(server); return 1; }
  signal(SIGPIPE,SIG_IGN); signal(SIGINT,signal_stop); signal(SIGTERM,signal_stop);
  Shared shared; InstrumentConfig config{rate,int(voices),seconds,uint32_t(block),true};
  std::thread audio(owner,std::ref(shared),config,uint32_t(block),float(level),stepped
#ifdef NATIVE_ALSA_HOST
    ,std::move(device)
#endif
  );
  std::array<uint8_t,16> epoch{}; random_bytes(epoch.data(),epoch.size()); uint64_t connection=0,order=0; Presentation presentation;
  while(!quit.load(std::memory_order_relaxed) && !shared.device_failed.load()) {
    pollfd poller{server,POLLIN,0}; if(poll(&poller,1,100)<=0)continue;
    int fd=accept(server,nullptr,nullptr); if(fd<0)continue;
    timeval timeout{1,0}; setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&timeout,sizeof(timeout)); setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&timeout,sizeof(timeout));
    run_connection(fd,shared,epoch,++connection,order,presentation); close(fd);
  }
  shared.done.store(true,std::memory_order_relaxed); audio.join(); close(server); unlink(path.c_str());
  if(shared.device_failed.load()) { std::cerr<<"ALSA device error; host stopped\n"; return 1; }
}
