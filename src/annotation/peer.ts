import { create } from 'zustand';
import { onInkOutgoing, receiveRemoteInk, syncPacket } from './store';
export const useAnnotationLink = create<{status:string;error:string;link:string;board:string}>()(() => ({status:'Not connected',error:'',link:'',board:''}));
let peer: RTCPeerConnection | null = null;
let disposeSend: (()=>void) | undefined;
let generation=0;
// First version pairs devices on the same LAN without a hosted service.
const config: RTCConfiguration = { iceServers: [] };
export async function packDescription(description: RTCSessionDescriptionInit): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(description));
  const compressed = typeof CompressionStream !== 'undefined';
  const bytes = compressed ? new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()) : data;
  return (compressed ? '1' : '0') + btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
export async function unpackDescription(code:string): Promise<RTCSessionDescriptionInit> {
  if(code.length > 50000) throw new Error('Invalid pairing code.');
  const binary = atob(code.trim().slice(1).replaceAll('-','+').replaceAll('_','/'));
  let bytes = Uint8Array.from(binary,c=>c.charCodeAt(0));
  if(code[0] === '1') bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const data=JSON.parse(new TextDecoder().decode(bytes));
  if(!['offer','answer'].includes(data.type) || typeof data.sdp !== 'string' || data.sdp.length > 50000) throw new Error('Invalid pairing code.');
  return data;
}
async function gather(p:RTCPeerConnection) {
  if(p.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{p.removeEventListener('icegatheringstatechange',changed);reject(new Error('Could not prepare connection. Retry on the same Wi-Fi.'));},12000);
    const changed=()=>{if(p.iceGatheringState==='complete'){clearTimeout(timer);p.removeEventListener('icegatheringstatechange',changed);resolve();}};
    p.addEventListener('icegatheringstatechange',changed); changed();
  });
}
function wire(p:RTCPeerConnection,dc:RTCDataChannel,board:string,host:boolean) {
  const queue:string[]=[]; let chunks=''; let failed=false;
  const flush=()=>{while(dc.readyState==='open' && dc.bufferedAmount < 256000 && queue.length) dc.send(queue.shift()!);};
  const send=(packet:unknown)=> {
    const text=JSON.stringify(packet);
    if(text.length > 4_000_000 || queue.length > 1000) { failed=true; useAnnotationLink.setState({status:'Disconnected',error:'Connection is too slow. Reconnect to restore the board.'});dc.close();return; }
    for(let i=0;i<text.length;i+=12000) queue.push(JSON.stringify({part:text.slice(i,i+12000),end:i+12000>=text.length}));
    flush();
  };
  dc.bufferedAmountLowThreshold=64000;dc.onbufferedamountlow=flush;
  dc.onopen=()=>{
    if(peer!==p)return;
    useAnnotationLink.setState({status:'Connected',error:''});
    if(host) send(syncPacket(board));
    disposeSend?.(); disposeSend=onInkOutgoing(packet=>{if(packet.board===board && dc.readyState==='open') send(packet);});
  };
  dc.onmessage=e=>{
    if(peer!==p)return;
    try {
      if(typeof e.data!=='string' || e.data.length>15000)return;
      const chunk=JSON.parse(e.data);
      if(typeof chunk.part!=='string')return;
      chunks+=chunk.part;
      if(chunks.length>4_000_000){chunks='';return;}
      if(chunk.end){const packet=JSON.parse(chunks);chunks='';if(packet.board===board) receiveRemoteInk(packet);}
    } catch {chunks='';}
  };
  dc.onclose=()=>{if(peer!==p)return;disposeSend?.();disposeSend=undefined;if(!failed)useAnnotationLink.setState({status:'Disconnected',error:'Reconnect to continue drawing live.'});};
  p.onconnectionstatechange=()=>{
    if(peer!==p)return;
    if(['failed','disconnected'].includes(p.connectionState))useAnnotationLink.setState({status:'Disconnected',error:'Connection lost. Reconnect on the same Wi-Fi.'});
  };
}
export function disconnectAnnotation() {
  generation++;disposeSend?.();disposeSend=undefined;
  if(peer){peer.onconnectionstatechange=null;peer.close();} peer=null;
  useAnnotationLink.setState({status:'Not connected',error:'',link:'',board:''});
}
export async function startAnnotationPairing(board:string):Promise<string> {
  disconnectAnnotation();const gen=generation;
  const p=new RTCPeerConnection(config);peer=p;
  useAnnotationLink.setState({status:'Preparing connection',board,error:''});
  wire(p,p.createDataChannel('piano-canva-ink'),board,true);
  try {
    await p.setLocalDescription(await p.createOffer());await gather(p);
    if(gen!==generation)throw new Error('Pairing cancelled.');
    const offer=await packDescription(p.localDescription!);
    const url=new URL('companion.html',window.location.href);url.search='?mode=annotation&board='+encodeURIComponent(board);url.hash='offer='+offer;
    if(url.protocol==='file:'){url.href='https://solmidollc.github.io/Pianocast/companion.html?mode=annotation&board='+encodeURIComponent(board)+'#offer='+offer;}
    useAnnotationLink.setState({status:'Waiting for return code',link:url.href});
    return url.href;
  } catch(e){if(gen===generation)useAnnotationLink.setState({status:'Not connected',error:e instanceof Error?e.message:'Pairing failed.'});throw e;}
}
export async function finishAnnotationPairing(code:string) {
  if(!peer)throw new Error('Start a new connection first.');
  const answer=await unpackDescription(code);if(answer.type!=='answer')throw new Error('Paste the return code from the drawing device.');
  await peer.setRemoteDescription(answer);useAnnotationLink.setState({status:'Connecting',error:''});
}
export async function joinAnnotation(board:string,offer:string):Promise<string> {
  disconnectAnnotation();const p=new RTCPeerConnection(config);peer=p;
  useAnnotationLink.setState({status:'Connecting',board,error:''});
  p.ondatachannel=e=>wire(p,e.channel,board,false);
  const description=await unpackDescription(offer);if(description.type!=='offer')throw new Error('Invalid connection link.');
  await p.setRemoteDescription(description);await p.setLocalDescription(await p.createAnswer());await gather(p);
  useAnnotationLink.setState({status:'Waiting for desktop'});
  return packDescription(p.localDescription!);
}
