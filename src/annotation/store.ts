import { pdfSourcePacket,receivePDFSource } from './pdfSource';
import { PAIRING_SERVICE_URL } from './cloudflareConfig';
import { emptyInk, reduceInk, validDocument, type InkAction, type InkState, type InkDocument } from './model';
type PDFPacket = {kind:'pdf-file';board:string;id:string;name:string;data:string};
type Packet = PDFPacket | { kind: 'action'; id: string; board: string; action: InkAction } | { kind: 'sync'; board: string; document: InkDocument };
const instance = crypto.randomUUID();
const boards = new Map<string,InkState>();
const listeners = new Map<string,Set<() => void>>();
const outgoing = new Set<(packet: Packet) => void>();
const seen = new Set<string>();
let persistTimer: ReturnType<typeof setTimeout>;
const STORAGE = 'piano-canva.annotations.v1';
try {
  const saved = JSON.parse(sessionStorage.getItem(STORAGE) || '{}');
  for (const [id,document] of Object.entries(saved)) if (id.length <= 80 && validDocument(document)) boards.set(id,{...emptyInk(),document});
} catch {}
// A paired companion must use the RTC transport, even when opened on this computer.
const pairedCompanion = new URLSearchParams(window.location.search).get('mode') === 'annotation' && (!!new URLSearchParams(window.location.hash.slice(1)).get('offer') || (!!PAIRING_SERVICE_URL && new URLSearchParams(window.location.search).get('local') !== '1'));
const channel = !pairedCompanion && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('piano-canva.annotations') : null;
function notify(board: string) {
  listeners.get(board)?.forEach(fn => fn());
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try { sessionStorage.setItem(STORAGE,JSON.stringify(Object.fromEntries([...boards].map(([id,s])=>[id,s.document])))); } catch {}
  },500);
}
export function inkState(board: string): InkState {
  if (!boards.has(board)) boards.set(board,emptyInk());
  return boards.get(board)!;
}
export function subscribeInk(board: string, fn: () => void) {
  const set = listeners.get(board) ?? new Set<() => void>(); listeners.set(board,set); set.add(fn);
  return () => { set.delete(fn); };
}
export function dispatchInk(board: string, action: InkAction) {
  const packet: Packet = { kind:'action',board,id:crypto.randomUUID(),action };
  receiveInk(packet);
  channel?.postMessage(packet);
  outgoing.forEach(fn=>fn(packet));
}
export function syncPacket(board: string): Packet { return {kind:'sync',board,document:inkState(board).document}; }
export function onInkOutgoing(fn: (packet: Packet) => void) { outgoing.add(fn); return () => { outgoing.delete(fn); }; }
export function receiveInk(raw: unknown): boolean {
  if((raw as any)?.kind==='pdf-file')return receivePDFSource(raw);
  const packet = raw as Packet;
  if (!packet || typeof packet.board !== 'string' || packet.board.length > 80 || !packet.board) return false;
  if (packet.kind === 'sync' && validDocument(packet.document)) {
    boards.set(packet.board,{...emptyInk(),document:packet.document}); notify(packet.board); return true;
  }
  if (packet.kind !== 'action' || typeof packet.id !== 'string' || packet.id.length > 80 || !packet.action || seen.has(packet.id)) return false;
  seen.add(packet.id); if(seen.size > 3000) seen.delete(seen.values().next().value!);
  const old = inkState(packet.board), next = reduceInk(old,packet.action);
  if (next === old) return false;
  boards.set(packet.board,next); notify(packet.board); return true;
}
channel?.addEventListener('message',e => {
  if (e.data?.kind === 'request' && typeof e.data.board === 'string' && boards.has(e.data.board)) {channel.postMessage({...syncPacket(e.data.board),recipient:e.data.source});const pdf=pdfSourcePacket(e.data.board);if(pdf)channel.postMessage({...pdf,recipient:e.data.source});}
  else if(!e.data?.recipient || e.data.recipient === instance) receiveInk(e.data);
});
export function requestInk(board: string) { channel?.postMessage({kind:'request',board,source:instance}); }

export function receiveRemoteInk(packet:unknown) { if(receiveInk(packet)) channel?.postMessage(packet); }

export function publishPDF(board:string,packet:PDFPacket) { if(!receivePDFSource(packet))throw new Error('Could not load this PDF.');channel?.postMessage(packet);outgoing.forEach(fn=>fn(packet)); }
