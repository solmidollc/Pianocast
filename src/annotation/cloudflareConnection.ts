import { PAIRING_SERVICE_URL } from './cloudflareConfig';
import { startAnnotationPairing, finishAnnotationPairing, joinAnnotation, useAnnotationLink, setPairingCleanup } from './peer';
export { PAIRING_SERVICE_URL };
const service = () => {
  if(!PAIRING_SERVICE_URL) throw new Error('Cloudflare pairing has not been configured yet.');
  return PAIRING_SERVICE_URL.replace(/\/$/,'');
};
async function api(path:string,body?:unknown,token?:string) {
  const response=await fetch(service()+path,{
    method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    body:JSON.stringify(body ?? {}),signal:AbortSignal.timeout(15000)
  });
  let data:any;try{data=await response.json();}catch{throw new Error('Pairing service unavailable. Try again.');}
  if(!response.ok)throw new Error(data.error || 'Pairing service unavailable.');
  return data;
}
export async function createCloudflarePairing(board:string) {
  const manual=await startAnnotationPairing(board);
  const offer=new URLSearchParams(new URL(manual).hash.slice(1)).get('offer');
  const room=await api('/rooms',{board,offer});
  if(!/^\d{8}$/.test(room.code) || typeof room.hostToken!=='string')throw new Error('Invalid pairing response.');
  const socketURL=new URL(service()+'/rooms/'+room.code+'/socket');
  socketURL.protocol='wss:';socketURL.searchParams.set('token',room.hostToken);
  const socket=new WebSocket(socketURL.href);
  const link=new URL(manual);link.hash='';link.searchParams.set('room',room.code);
  let answered=false,stopped=false;
  const remove=()=>{void fetch(service()+'/rooms/'+room.code,{method:'DELETE',headers:{Authorization:'Bearer '+room.hostToken}}).catch(()=>{});};
  const expire=setTimeout(()=>{
    if(useAnnotationLink.getState().status!=='Connected')useAnnotationLink.setState({status:'Code expired',error:'Create a new code to connect.'});
    socket.close();remove();
  },Math.max(0,room.expires-Date.now()));
  setPairingCleanup(()=>{stopped=true;clearTimeout(expire);socket.close();remove();});
  socket.onmessage=async event=>{
    if(stopped || answered)return;
    try {
      const message=JSON.parse(event.data);
      if(message.type!=='answer' || typeof message.answer!=='string')return;
      answered=true;await finishAnnotationPairing(message.answer);
      clearTimeout(expire);socket.close();remove();
    } catch(e) {useAnnotationLink.setState({status:'Not connected',error:e instanceof Error?e.message:'Connection failed. Create a new code.'});}
  };
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.close();reject(new Error('Could not reach Cloudflare. Try again.'));},15000);
    socket.onopen=()=>{clearTimeout(timer);resolve();};
    socket.onerror=()=>{clearTimeout(timer);reject(new Error('Could not reach Cloudflare. Try again.'));};
    socket.onclose=()=>{clearTimeout(timer);if(!answered && !stopped){useAnnotationLink.setState({status:'Pairing interrupted',error:'Create a new code to reconnect.'});reject(new Error('Pairing connection closed.'));}};
  });
  useAnnotationLink.setState({status:'Waiting for device',code:room.code,expires:room.expires,link:link.href});
}
export async function joinCloudflarePairing(input:string):Promise<string> {
  try {
  const code=input.replace(/[\s-]/g,'');
  if(!/^\d{8}$/.test(code))throw new Error('Enter the 8-digit code shown in PianoCanva.');
  useAnnotationLink.setState({status:'Connecting',error:''});
  const room=await api('/rooms/'+code+'/join');
  if(typeof room.board!=='string' || typeof room.offer!=='string' || typeof room.guestToken!=='string')throw new Error('Invalid pairing response.');
  const answer=await joinAnnotation(room.board,room.offer);
  await api('/rooms/'+code+'/answer',{answer},room.guestToken);
  useAnnotationLink.setState({code,...(useAnnotationLink.getState().status === 'Connected' ? {} : {status:'Connecting'})});
  return room.board;
  } catch(error) {
    useAnnotationLink.setState({status:'Not connected',error:error instanceof Error ? error.message : 'Connection failed. Create a new code.'});
    throw error;
  }
}
