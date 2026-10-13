import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import QRCode from 'qrcode';
import { useAnnotationLink, startAnnotationPairing, finishAnnotationPairing, disconnectAnnotation } from '../annotation/peer';
import { inkState, dispatchInk, subscribeInk } from '../annotation/store';
export function AnnotationProperties({board}:{board:string}) {
  const connection=useAnnotationLink();
  const [open,setOpen]=useState(false),[answer,setAnswer]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const qr=useRef<HTMLCanvasElement>(null);
  const background=useSyncExternalStore(fn=>subscribeInk(board,fn),()=>inkState(board).document.background);
  useEffect(()=>{
    if(connection.link && qr.current)QRCode.toCanvas(qr.current,connection.link,{width:216,margin:4,errorCorrectionLevel:'L'}).catch(()=>setError('Use Copy link to open the companion.'));
  },[connection.link,open]);
  const local=new URL('companion.html',window.location.href);local.search='?mode=annotation&board='+encodeURIComponent(board);
  if(local.protocol==='file:')local.href='https://solmidollc.github.io/Pianocast/companion.html?mode=annotation&board='+encodeURIComponent(board);
  const start=async()=>{setBusy(true);setError('');try{await startAnnotationPairing(board);}catch(e){setError(e instanceof Error?e.message:'Connection failed.');}finally{setBusy(false);}};
  const finish=async()=>{setBusy(true);setError('');try{await finishAnnotationPairing(answer);}catch(e){setError(e instanceof Error?e.message:'Check the return code.');}finally{setBusy(false);}};
  return <div className="px-4 py-3 space-y-3 text-xs">
    <a href={local.href} target="_blank" rel="noreferrer" className="block text-accent-soft">Open drawing companion ↗</a>
    <button className="w-full rounded border border-white/15 py-2" onClick={()=>setOpen(true)}>Connect tablet or phone</button>
    <label className="flex justify-between items-center">Background<select aria-label="Annotation background" value={background} onChange={e=>dispatchInk(board,{type:'background',value:e.target.value as 'white'|'transparent'})} className="bg-ink-800 rounded px-2 py-1"><option value="transparent">Transparent</option><option value="white">Whiteboard</option></select></label>
    <button className="text-accent-soft" onClick={()=>dispatchInk(board,{type:'clear'})}>Clear annotations</button>
    {connection.board===board && <p className="text-ink-400">{connection.status}</p>}
    {open && <div role="dialog" aria-modal="true" aria-label="Connect annotation device" className="ink-dialog-backdrop" onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}}>
      <section className="ink-dialog"><header><h2>Connect drawing device</h2><button aria-label="Close pairing" onClick={()=>setOpen(false)}>×</button></header>
      {!connection.link || connection.board!==board ? <><p>Connect on the same Wi-Fi. No camera or microphone access needed.</p><button disabled={busy} onClick={start}>{busy?'Preparing…':'Create pairing link'}</button></> :
      connection.status==='Connected' ? <><p>Connected. Your handwriting is live in the Annotation layer.</p><button onClick={()=>{disconnectAnnotation();setAnswer('');}}>Disconnect</button><button onClick={()=>setOpen(false)}>Done</button></> :
      <><p>1. Scan or open this link on your drawing device.</p><canvas ref={qr} aria-label="Annotation pairing QR code"/>
      <button onClick={async()=>{try{await navigator.clipboard.writeText(connection.link);setError('Link copied');}catch{setError('Select and copy the link below.');}}}>Copy link</button>
      <input aria-label="Pairing link" value={connection.link} readOnly/>
      <p>2. Tap Connect there, then paste its return code here.</p>
      <textarea aria-label="Device return code" placeholder="Paste return code" value={answer} onChange={e=>setAnswer(e.target.value)}/>
      <button disabled={busy || !answer.trim()} onClick={finish}>Connect</button><button disabled={busy} onClick={start}>New link</button>
      <p className="ink-muted">If connection fails, use the same Wi-Fi and create a new link. Some networks require a relay, which this first version does not include.</p></>}
      {(error || connection.error) && <p role="status">{error || connection.error}</p>}
      </section>
    </div>}
  </div>;
}
