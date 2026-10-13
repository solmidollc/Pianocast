import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { drawInk, type InkPoint, type InkTool } from './model';
import { dispatchInk, inkState, requestInk, subscribeInk } from './store';
import { joinAnnotation, useAnnotationLink } from './peer';
import { joinCloudflarePairing, PAIRING_SERVICE_URL } from './cloudflareConnection';

export function DrawingBoard() {
  useEffect(() => { document.title = 'PianoCanva Annotation'; }, []);
  const params=new URLSearchParams(window.location.search);
  const [board,setBoard]=useState(params.get('board') || 'teaching-board');
  const [shortCode,setShortCode]=useState(params.get('room') || '');
  const cloud=!!PAIRING_SERVICE_URL && params.get('local') !== '1' && !new URLSearchParams(window.location.hash.slice(1)).get('offer');
  const remote=cloud || !!new URLSearchParams(window.location.hash.slice(1)).get('offer');
  const offer=new URLSearchParams(window.location.hash.slice(1)).get('offer');
  const {status,error}=useAnnotationLink();
  const [drawing,setDrawing]=useState(false);
  const [answer,setAnswer]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [tool,setTool]=useState<InkTool>('pen'),[color,setColor]=useState('#ffffff'),[size,setSize]=useState(4),[penOnly,setPenOnly]=useState(false);
  const canvas=useRef<HTMLCanvasElement>(null);
  const stroke=useRef<{id:string;pointer:number;offset:number;pending:InkPoint[]} | null>(null);
  const timer=useRef<ReturnType<typeof setTimeout>>();
  const controls=useSyncExternalStore(fn=>subscribeInk(board,fn),()=>{
    const s=inkState(board);return s.past.length+':'+s.future.length+':'+s.document.background+':'+s.document.strokes.length;
  });
  const [past,future,background,count]=controls.split(':');
  useEffect(()=>{
    let frame=0;
    const paint=()=>{frame=0;const ctx=canvas.current?.getContext('2d');if(ctx)drawInk(ctx,inkState(board).document,1600,900);};
    const unsub=subscribeInk(board,()=>{if(!frame)frame=requestAnimationFrame(paint);});
    paint();requestInk(board);
    return()=>{unsub();cancelAnimationFrame(frame);clearTimeout(timer.current);};
  },[board]);
  const flush=()=>{
    clearTimeout(timer.current);timer.current=undefined;
    const s=stroke.current;if(!s?.pending.length)return;
    dispatchInk(board,{type:'points',strokeId:s.id,offset:s.offset,points:s.pending});
    s.offset+=s.pending.length;s.pending=[];
  };
  const point=(e:React.PointerEvent<HTMLCanvasElement>):InkPoint=>{
    const r=e.currentTarget.getBoundingClientRect();
    return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height)),Math.max(0,Math.min(1,e.pressure || .5))];
  };
  const finish=(e:React.PointerEvent<HTMLCanvasElement>)=>{
    if(stroke.current?.pointer!==e.pointerId)return;
    flush();stroke.current=null;setDrawing(false);
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const connect=async()=>{
    setBusy(true);setMessage('');
    try{if(cloud)setBoard(await joinCloudflarePairing(shortCode));else setAnswer(await joinAnnotation(board,offer!));}catch(e){setMessage(e instanceof Error?e.message:'Connection failed.');}
    finally{setBusy(false);}
  };
  const copy=async(text:string)=>{try{await navigator.clipboard.writeText(text);setMessage('Copied');}catch{setMessage('Select and copy the code below.');}};
  return <main className="ink-companion">
    <header className="ink-header"><strong>PianoCanva</strong><span>Annotation</span><span className="ink-status" role="status">{remote ? status : 'Local drawing'}</span></header>
    {remote && status!=='Connected' && <section className="ink-pairing" aria-label="Connect drawing device">
      {cloud ? <><label>Pairing code<input aria-label="8-digit pairing code" inputMode="numeric" autoComplete="off" maxLength={9} placeholder="1234 5678" value={shortCode} onChange={e=>setShortCode(e.target.value.replace(/[^0-9 ]/g,''))}/></label><button disabled={busy || shortCode.replace(/\s/g,'').length!==8} onClick={connect}>{busy?'Connecting…':'Connect'}</button></> : !answer ? <button disabled={busy} onClick={connect}>{busy?'Preparing…':'Connect to PianoCanva'}</button> :
        <><p>Paste this return code into PianoCanva to finish connecting.</p><button onClick={()=>copy(answer)}>Copy return code</button><textarea aria-label="Return code" readOnly value={answer}/></>}
      {(message || error) && <p role="status">{message || error}</p>}
    </section>}
    {status==='Connected' && <p className="ink-connected">Live in your video</p>}
    <div className="ink-toolbar" aria-label="Drawing tools">
      {(['pen','highlighter','eraser'] as const).map(t=><button key={t} aria-pressed={tool===t} onClick={()=>setTool(t)}>{t[0].toUpperCase()+t.slice(1)}</button>)}
      <label>Color<input aria-label="Ink color" type="color" value={color} onChange={e=>setColor(e.target.value)}/></label>
      <label>Size<select aria-label="Stroke size" value={size} onChange={e=>setSize(Number(e.target.value))}><option value={2}>Fine</option><option value={4}>Medium</option><option value={8}>Bold</option></select></label>
      <button disabled={!Number(past) || drawing} onClick={()=>dispatchInk(board,{type:'undo'})}>Undo</button>
      <button disabled={!Number(future) || !!stroke.current} onClick={()=>dispatchInk(board,{type:'redo'})}>Redo</button>
      <button disabled={!Number(count) || !!stroke.current} onClick={()=>dispatchInk(board,{type:'clear'})}>Clear</button>
      <label>Board<select aria-label="Board background" value={background} onChange={e=>{
        const value=e.target.value as 'white'|'transparent';dispatchInk(board,{type:'background',value});setColor(value==='white'?'#17202a':'#ffffff');
      }}><option value="transparent">Transparent</option><option value="white">Whiteboard</option></select></label>
      <label><input type="checkbox" checked={penOnly} onChange={e=>setPenOnly(e.target.checked)}/>Pen only</label>
    </div>
    <div className="ink-workspace"><canvas ref={canvas} width={1600} height={900} aria-label="Drawing surface"
      onPointerDown={e=>{
        if((remote && status!=='Connected') || stroke.current || (penOnly && e.pointerType!=='pen') || e.button!==0)return;
        if(inkState(board).document.strokes.length>=300){setMessage('Board full. Clear it to continue; Undo restores it.');return;}
        e.preventDefault();const id=crypto.randomUUID();e.currentTarget.setPointerCapture(e.pointerId);
        dispatchInk(board,{type:'begin',stroke:{id,tool,color,size,points:[point(e)]}});
        stroke.current={id,pointer:e.pointerId,offset:1,pending:[]};setDrawing(true);
      }}
      onPointerMove={e=>{
        const s=stroke.current;if(!s || s.pointer!==e.pointerId)return;e.preventDefault();
        if(e.buttons===0){finish(e);return;}
        if(s.offset+s.pending.length>=4096){finish(e);return;}
        s.pending.push(point(e));
        if(s.pending.length>=64)flush();else if(!timer.current)timer.current=setTimeout(flush,16);
      }}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    /></div>
    {message && !remote && <p role="status">{message}</p>}
    <footer>Pen, finger, or mouse · Drawings stay in this session</footer>
  </main>;
}
