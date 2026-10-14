import { useEffect,useRef,useState,useSyncExternalStore } from 'react';
import QRCode from 'qrcode';
import { useAnnotationLink,startAnnotationPairing,finishAnnotationPairing,disconnectAnnotation } from '../annotation/peer';
import { createCloudflarePairing,PAIRING_SERVICE_URL } from '../annotation/cloudflareConnection';
import { inkState,dispatchInk,subscribeInk } from '../annotation/store';
import { useBoardLocked } from '../annotation/connectionLock';
import { uploadBoardPDF,changePDFPage } from '../annotation/pdfActions';
export function AnnotationProperties({board,linked=false}:{board:string;linked?:boolean}) {
  const connection=useAnnotationLink(),locked=useBoardLocked(board);
  const [manual,setManual]=useState(false),[open,setOpen]=useState(false),[answer,setAnswer]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const cloud=!!PAIRING_SERVICE_URL&&!manual,qr=useRef<HTMLCanvasElement>(null),file=useRef<HTMLInputElement>(null);
  const doc=useSyncExternalStore(fn=>subscribeInk(board,fn),()=>inkState(board).document);
  useEffect(()=>{
    if(connection.link&&qr.current)QRCode.toCanvas(qr.current,connection.link,{width:216,margin:4,errorCorrectionLevel:'L'}).catch(()=>setError('Copy the link to connect.'));
  },[connection.link,open,manual,busy]);
  const local=new URL('companion.html',window.location.href);local.search='?mode=annotation&local=1&v=multi-annotations&board='+encodeURIComponent(board);
  if(local.protocol==='file:')local.href='https://solmidollc.github.io/Pianocast/companion.html?mode=annotation&local=1&board='+encodeURIComponent(board);
  const start=async(longCode=false)=>{
    if(busy)return;setBusy(true);setError('');setManual(longCode);
    try{if(PAIRING_SERVICE_URL&&!longCode)await createCloudflarePairing(board);else await startAnnotationPairing(board);}
    catch(e){useAnnotationLink.setState({link:'',code:undefined});setError(e instanceof Error?e.message:'Connection failed.');}
    finally{setBusy(false);}
  };
  const showPairing=()=>{
    setOpen(true);setManual(false);
    const usable=connection.status==='Connected'||connection.board===board&&connection.code&&connection.expires!>Date.now();
    if(!usable)void start();
  };
  const upload=async(selected:File)=>{
    setBusy(true);setError('');
    try{await uploadBoardPDF(board,selected);}catch(e){setError(e instanceof Error?e.message:'Could not open PDF.');}
    finally{setBusy(false);if(file.current)file.current.value='';}
  };
  const page=async(index:number)=>{
    setBusy(true);setError('');
    try{await changePDFPage(board,index);}catch(e){setError(e instanceof Error?e.message:'Could not open page.');}finally{setBusy(false);}
  };
  return <div className="px-4 py-3 space-y-3 text-xs">
    <a href={local.href} target="_blank" rel="noreferrer" className="block text-accent-soft">Open drawing companion ↗</a>
    <button className="w-full rounded border border-white/15 py-2" onClick={showPairing}>Connect tablet or phone</button>
    <button hidden={linked} disabled={busy||linked} className="w-full rounded border border-white/15 py-2" onClick={()=>file.current?.click()}>{busy?'Loading…':'Upload PDF'}</button>
    <input ref={file} type="file" accept="application/pdf,.pdf" hidden aria-label="Upload annotation PDF" onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f);}}/>
    {!linked&&(doc.pdf ? <div className="space-y-2"><p className="truncate" title={doc.pdf.name}>{doc.pdf.name}</p>
      <div className="flex justify-between items-center"><button aria-label="Previous PDF page" disabled={busy||doc.pdf.index===1} onClick={()=>void page(doc.pdf!.index-1)}>‹</button><span>{doc.pdf.index} / {doc.pdf.count}</span><button aria-label="Next PDF page" disabled={busy||doc.pdf.index===doc.pdf.count} onClick={()=>void page(doc.pdf!.index+1)}>›</button></div>
      <button className="text-accent-soft" onClick={()=>dispatchInk(board,{type:'pdf-close'})}>Blank canvas</button>
    </div> : <label className="flex justify-between items-center">Background<select aria-label="Annotation background" value={doc.background} onChange={e=>dispatchInk(board,{type:'background',value:e.target.value as 'white'|'transparent'})} className="bg-ink-800 rounded px-2 py-1"><option value="transparent">Transparent</option><option value="white">Whiteboard</option></select></label>)}
    <button className="text-accent-soft" onClick={()=>dispatchInk(board,{type:'clear'})}>Clear ink</button>
    {connection.status==='Connected' && <p className="text-ink-400">Disconnect to edit the layout.</p>}
    {!open&&error&&<p role="status">{error}</p>}
    {open&&<div role="dialog" aria-modal="true" aria-label="Connect annotation device" className="ink-dialog-backdrop" onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}}>
      <section className="ink-dialog"><header><h2>Connect drawing device</h2><button aria-label="Close pairing" onClick={()=>setOpen(false)}>×</button></header>
      {connection.status==='Connected' ? <><p>Connected</p><button onClick={()=>{disconnectAnnotation();setAnswer('');}}>Disconnect</button><button onClick={()=>setOpen(false)}>Done</button></> :
      busy ? <p role="status">Preparing connection…</p> :
      connection.link&&connection.board===board ? <>
        {cloud&&connection.code ? <><div className="ink-short-code" aria-label="Pairing code">{connection.code.slice(0,4)} {connection.code.slice(4)}</div><p className="ink-muted ink-center">Scan or enter the code · Valid for 10 minutes</p></> : <p>Open this link on your device.</p>}
        <canvas ref={qr} aria-label="Annotation pairing QR code"/>
        <div className="ink-pair-actions"><button onClick={()=>navigator.clipboard.writeText(connection.link).catch(()=>setError('Copy the link from the field below.'))}>Copy link</button><button onClick={()=>void start(manual)}>{cloud?'New code':'New link'}</button></div>
        {manual&&<><input aria-label="Pairing link" value={connection.link} readOnly/><textarea aria-label="Device return code" placeholder="Paste return code" value={answer} onChange={e=>setAnswer(e.target.value)}/><button disabled={!answer.trim()} onClick={async()=>{try{await finishAnnotationPairing(answer);}catch(e){setError(e instanceof Error?e.message:'Check the return code.');}}}>Connect</button></>}
      </> : <button onClick={()=>void start(manual)}>Retry connection</button>}
      {(error||connection.error)&&<p role="status">{error||connection.error}</p>}
      {PAIRING_SERVICE_URL&&connection.status!=='Connected'&&!busy&&<button className="ink-pair-alternative" onClick={()=>void start(!manual)}>{manual?'Use short code':'Use long code instead'}</button>}
      </section>
    </div>}
  </div>;
}

