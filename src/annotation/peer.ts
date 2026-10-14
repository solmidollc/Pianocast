import { surfaceCatalog,onSurfaceCatalog,receiveSurfaceCatalog } from './surfaces';
import { boardSize } from './model';
import { lockBoard } from './connectionLock';
import { pdfSourcePacket } from './pdfSource';
import { create } from 'zustand';
import { onInkOutgoing, receiveRemoteInk, syncPacket, inkState } from './store';
export const useAnnotationLink = create<{status:string;error:string;link:string;board:string;code?:string;expires?:number}>()(() => ({status:'Not connected',error:'',link:'',board:'',code:undefined,expires:undefined}));
let peer: RTCPeerConnection | null = null;
let disposeCatalog:(()=>void)|undefined;
let disposeSend: (()=>void) | undefined;
let generation=0;
let pairingCleanup: (()=>void) | undefined;
export function setPairingCleanup(cleanup:()=>void) { pairingCleanup?.(); pairingCleanup=cleanup; }
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
  const authorized=new Set([board]),synced=new Set<string>(),linkedBoards=new Set<string>();
  const catalog=(value=surfaceCatalog())=>{
    send(value);for(const surface of value.surfaces){authorized.add(surface.board);if(surface.kind!=='annotation')linkedBoards.add(surface.board);if(!synced.has(surface.board)){send(syncPacket(surface.board));const pdf=inkState(surface.board).document.pdf&&pdfSourcePacket(surface.board);if(pdf)send(pdf);synced.add(surface.board);}}
  };
  const flush=()=>{while(dc.readyState==='open' && dc.bufferedAmount < 256000 && queue.length) dc.send(queue.shift()!);};
  const send=(packet:unknown)=> {
    const text=JSON.stringify(packet);
    if(text.length > 20_000_000 || queue.length > 5000) { failed=true; useAnnotationLink.setState({status:'Disconnected',error:'Connection is too slow. Reconnect to restore the board.'});dc.close();return; }
    for(let i=0;i<text.length;i+=12000) queue.push(JSON.stringify({part:text.slice(i,i+12000),end:i+12000>=text.length}));
    flush();
  };
  dc.bufferedAmountLowThreshold=64000;dc.onbufferedamountlow=flush;
  dc.onopen=()=>{
    if(peer!==p)return;
    useAnnotationLink.setState({status:'Connected',error:''});
    lockBoard(board,boardSize(inkState(board).document));
    if(host) {send(syncPacket(board));catalog();disposeCatalog?.();disposeCatalog=onSurfaceCatalog(catalog);}
    disposeSend?.(); disposeSend=onInkOutgoing(packet=>{if(authorized.has(packet.board) && dc.readyState==='open') send(packet);});
  };
  dc.onmessage=e=>{
    if(peer!==p)return;
    try {
      if(typeof e.data!=='string' || e.data.length>15000)return;
      const chunk=JSON.parse(e.data);
      if(typeof chunk.part!=='string')return;
      chunks+=chunk.part;
      if(chunks.length>20_000_000){chunks='';return;}
      if(chunk.end){const packet=JSON.parse(chunks);chunks='';if(!host&&packet.kind==='surfaces'){if(receiveSurfaceCatalog(packet)){packet.surfaces.forEach((s:any)=>authorized.add(s.board));}return;}
        if(authorized.has(packet.board)){
          if(host&&packet.kind==='sync')return;
          const linked=linkedBoards.has(packet.board);
          if(host&&linked&&(packet.kind!=='action'||!['begin','points','undo','redo','clear'].includes(packet.action?.type)))return;
          receiveRemoteInk(packet);
        }}
    } catch {chunks='';}
  };
  dc.onclose=()=>{if(peer!==p)return;lockBoard(board,null);disposeCatalog?.();disposeCatalog=undefined;disposeSend?.();disposeSend=undefined;if(!failed)useAnnotationLink.setState({status:'Disconnected',error:'Reconnect to continue drawing live.'});};
  p.onconnectionstatechange=()=>{
    if(peer!==p)return;
    if(['failed','disconnected'].includes(p.connectionState)){lockBoard(board,null);useAnnotationLink.setState({status:'Disconnected',error:'Connection lost. Reconnect on the same Wi-Fi.'});}
  };
}
export function disconnectAnnotation() {
  lockBoard(useAnnotationLink.getState().board,null);
  receiveSurfaceCatalog({kind:'surfaces',scene:'',surfaces:[]});
  pairingCleanup?.();pairingCleanup=undefined;
  generation++;disposeCatalog?.();disposeCatalog=undefined;disposeSend?.();disposeSend=undefined;
  if(peer){peer.onconnectionstatechange=null;peer.close();} peer=null;
  useAnnotationLink.setState({status:'Not connected',error:'',link:'',board:'',code:undefined,expires:undefined});
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
    const url=new URL('companion.html',window.location.href);url.search='?mode=annotation&v=multi-annotations&board='+encodeURIComponent(board);url.hash='offer='+offer;
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

