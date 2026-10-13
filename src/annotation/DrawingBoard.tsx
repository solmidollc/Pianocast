import { useEffect,useRef,useState,useSyncExternalStore } from 'react';
import { boardSize,inkGeometry,pointOnPaper,type InkPoint,type InkTool } from './model';
import { dispatchInk,inkState,requestInk,subscribeInk } from './store';
import { joinAnnotation,useAnnotationLink } from './peer';
import { joinCloudflarePairing,PAIRING_SERVICE_URL } from './cloudflareConnection';
import { useInkCanvas } from './useInkCanvas';
import { uploadBoardPDF,changePDFPage } from './pdfActions';

export function DrawingBoard() {
  const params=new URLSearchParams(window.location.search);
  const [board,setBoard]=useState(params.get('board')||'teaching-board'),[code,setCode]=useState(params.get('room')||'');
  const offer=new URLSearchParams(window.location.hash.slice(1)).get('offer');
  const cloud=!!PAIRING_SERVICE_URL && params.get('local')!=='1' && !offer, remote=cloud||!!offer;
  const {status,error}=useAnnotationLink();
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[answer,setAnswer]=useState('');
  const [tool,setTool]=useState<InkTool|'scroll'>('pen'),[color,setColor]=useState('#ffffff'),[size,setSize]=useState(4),[penOnly,setPenOnly]=useState(false);
  const [drawing,setDrawing]=useState(false),[full,setFull]=useState(false),[cssWidth,setCSSWidth]=useState(900);
  const state=useSyncExternalStore(fn=>subscribeInk(board,fn),()=>inkState(board));
  const doc=state.document,[w,h]=boardSize(doc),geometry=inkGeometry(doc);
  const canvas=useInkCanvas(board,w,h),viewport=useRef<HTMLDivElement>(null),root=useRef<HTMLElement>(null),file=useRef<HTMLInputElement>(null);
  const active=useRef<{id:string;pointer:number;offset:number;pending:InkPoint[]}|null>(null),timer=useRef<ReturnType<typeof setTimeout>>();
  const attempted=useRef('');
  const ready=!remote || status==='Connected';
  useEffect(()=>{document.title='PianoCanva Annotation';},[]);
  useEffect(()=>{if(doc.pdf)setColor('#17202a');},[doc.pdf?.id]);
  useEffect(()=>{requestInk(board);return()=>{clearTimeout(timer.current);};},[board]);
  const connect=async()=>{
    if(busy)return;setBusy(true);setMessage('');
    try{if(cloud)setBoard(await joinCloudflarePairing(code));else setAnswer(await joinAnnotation(board,offer!));}
    catch(e){setMessage(e instanceof Error?e.message:'Connection failed.');}
    finally{setBusy(false);}
  };
  useEffect(()=>{
    const value=code.replace(/\s/g,'');
    if(cloud && value.length===8 && attempted.current!==value && !busy && status!=='Connected') {
      attempted.current=value;void connect();
    }
  },[code,cloud,busy,status]);
  useEffect(()=>{
    if(!ready||!viewport.current)return;
    const element=viewport.current,observer=new ResizeObserver(()=>setCSSWidth(element.clientWidth));
    observer.observe(element);setCSSWidth(element.clientWidth);return()=>observer.disconnect();
  },[ready,full,board,w,h]);
  useEffect(()=>{
    const el=viewport.current;if(!el||!doc.pdf)return;
    const target=(doc.scroll??0)*(el.scrollHeight-el.clientHeight);
    if(Math.abs(el.scrollTop-target)>1)el.scrollTop=target;
  },[doc.scroll,doc.pdf?.index,cssWidth,w,h]);
  const flush=()=>{
    clearTimeout(timer.current);timer.current=undefined;
    const s=active.current;if(!s?.pending.length)return;
    dispatchInk(board,{type:'points',strokeId:s.id,offset:s.offset,points:s.pending});s.offset+=s.pending.length;s.pending=[];
  };
  const point=(e:React.PointerEvent<HTMLCanvasElement>):InkPoint=>{
    const r=e.currentTarget.getBoundingClientRect();
    return pointOnPaper(inkState(board).document,(e.clientX-r.left)/r.width*w,(e.clientY-r.top)/r.height*h,Math.max(0,Math.min(1,e.pressure||.5)));
  };
  const finish=(e:React.PointerEvent<HTMLCanvasElement>)=>{
    if(active.current?.pointer!==e.pointerId)return;flush();active.current=null;setDrawing(false);
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const upload=async(selected:File)=>{
    setBusy(true);setMessage('');
    try{await uploadBoardPDF(board,selected);setColor('#17202a');}catch(e){setMessage(e instanceof Error?e.message:'Could not read PDF.');}
    finally{setBusy(false);if(file.current)file.current.value='';}
  };
  const page=async(index:number)=>{
    setBusy(true);setMessage('');
    try{await changePDFPage(board,index);}catch(e){setMessage(e instanceof Error?e.message:'Could not open page.');}finally{setBusy(false);}
  };
  const fullscreen=()=>{
    if(!full){setFull(true);void root.current?.requestFullscreen?.().catch(()=>{});}
    else{setFull(false);if(document.fullscreenElement)void document.exitFullscreen();}
  };
  useEffect(()=>{
    const changed=()=>{if(!document.fullscreenElement)setFull(false);};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setFull(false);};
    document.addEventListener('fullscreenchange',changed);window.addEventListener('keydown',key);
    return()=>{document.removeEventListener('fullscreenchange',changed);window.removeEventListener('keydown',key);};
  },[]);
  if(!ready)return <main className="ink-connect-screen">
    <section aria-label="Connect drawing device">
      {cloud ? <><label htmlFor="ink-pair-code">Pairing code</label><input id="ink-pair-code" aria-label="8-digit pairing code" inputMode="numeric" autoComplete="off" autoFocus maxLength={9}
        placeholder="1234 5678" value={code} disabled={busy} onChange={e=>{attempted.current='';setMessage('');setCode(e.target.value.replace(/[^0-9 ]/g,''));}}/>
        <p role="status">{busy?'Connecting…':message||error||'Enter the code from PianoCanva'}</p>
        {(message||error) && <button onClick={()=>{attempted.current='';void connect();}}>Retry</button>}</> :
      !answer ? <button disabled={busy} onClick={connect}>{busy?'Connecting…':'Connect to PianoCanva'}</button> :
      <><p>Return code</p><button onClick={()=>navigator.clipboard.writeText(answer).catch(()=>setMessage('Select and copy the code below.'))}>Copy return code</button><textarea aria-label="Return code" readOnly value={answer}/></>}
    </section>
  </main>;
  const viewH=cssWidth*h/w,contentH=doc.pdf?Math.max(viewH,cssWidth/doc.pdf.aspect):viewH;
  return <main ref={root} className={'ink-companion ink-board'+(full?' ink-immersive':'')}>
    {!full && <header className="ink-header"><strong>PianoCanva</strong><span className="ink-status">{remote?'Connected':'Annotation'}</span></header>}
    <div className="ink-toolbar" aria-label="Drawing tools">
      {(['pen','highlighter','eraser','scroll'] as const).map(t=><button key={t} aria-pressed={tool===t} onClick={()=>setTool(t)}>{t[0].toUpperCase()+t.slice(1)}</button>)}
      <label title="Ink color"><input aria-label="Ink color" type="color" value={color} onChange={e=>setColor(e.target.value)}/></label>
      <select aria-label="Stroke size" value={size} onChange={e=>setSize(Number(e.target.value))}><option value={2}>Fine</option><option value={4}>Medium</option><option value={8}>Bold</option></select>
      <button disabled={!state.past.length||drawing} onClick={()=>dispatchInk(board,{type:'undo'})}>Undo</button>
      <button disabled={!state.future.length||drawing} onClick={()=>dispatchInk(board,{type:'redo'})}>Redo</button>
      <button disabled={!doc.strokes.length||drawing} onClick={()=>dispatchInk(board,{type:'clear'})}>Clear ink</button>
      <button disabled={busy||drawing} onClick={()=>file.current?.click()}>{busy?'Loading…':'Upload PDF'}</button>
      <input ref={file} type="file" accept="application/pdf,.pdf" hidden aria-label="Upload PDF file" onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f);}}/>
      {doc.pdf ? <>
        <button aria-label="Previous page" disabled={busy||drawing||doc.pdf.index===1} onClick={()=>void page(doc.pdf!.index-1)}>‹</button>
        <span className="ink-page-number">{doc.pdf.index} / {doc.pdf.count}</span>
        <button aria-label="Next page" disabled={busy||drawing||doc.pdf.index===doc.pdf.count} onClick={()=>void page(doc.pdf!.index+1)}>›</button>
        <button disabled={drawing} onClick={()=>dispatchInk(board,{type:'pdf-close'})}>Blank canvas</button>
      </> : <select aria-label="Board background" value={doc.background} onChange={e=>{const value=e.target.value as 'white'|'transparent';dispatchInk(board,{type:'background',value});setColor(value==='white'?'#17202a':'#ffffff');}}><option value="transparent">Transparent</option><option value="white">Whiteboard</option></select>}
      <label><input type="checkbox" checked={penOnly} onChange={e=>setPenOnly(e.target.checked)}/>Pen only</label>
      <button aria-label={full?'Exit full screen':'Full screen drawing'} title={full?'Exit full screen':'Full screen'} onClick={fullscreen}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg></button>
    </div>
    {message && <p className="ink-board-message" role="status">{message}</p>}
    <div className="ink-workspace">
      <div ref={viewport} className="ink-viewport" style={{aspectRatio:w+'/'+h,width:'min(100%, calc((100dvh - '+(full?100:170)+'px) * '+w/h+'))'}}
        onScroll={e=>{
          const el=e.currentTarget,max=el.scrollHeight-el.clientHeight;
          if(!doc.pdf||max<=0)return;
          if(active.current){el.scrollTop=(doc.scroll??0)*max;return;}
          const value=Math.max(0,Math.min(1,el.scrollTop/max));if(Math.abs(value-(inkState(board).document.scroll??0))>.0001)dispatchInk(board,{type:'scroll',value});
        }}>
        <div style={{height:contentH,position:'relative'}}>
          <canvas ref={canvas} width={w} height={h} aria-label="Drawing surface" style={{position:'sticky',top:0,width:'100%',height:viewH,display:'block',touchAction:tool==='scroll'?'pan-y':'none',cursor:tool==='scroll'?'grab':'crosshair'}}
            onPointerDown={e=>{
              if(tool==='scroll'||active.current||busy||(penOnly&&e.pointerType!=='pen')||e.button!==0)return;
              if(doc.strokes.length>=300){setMessage('Clear ink to continue drawing.');return;}
              e.preventDefault();const id=crypto.randomUUID();e.currentTarget.setPointerCapture(e.pointerId);
              dispatchInk(board,{type:'begin',stroke:{id,tool,color,size,points:[point(e)]}});
              active.current={id,pointer:e.pointerId,offset:1,pending:[]};setDrawing(true);
            }}
            onPointerMove={e=>{
              const s=active.current;if(!s||s.pointer!==e.pointerId)return;e.preventDefault();
              if(e.buttons===0||s.offset+s.pending.length>=4096){finish(e);return;}
              s.pending.push(point(e));if(s.pending.length>=64)flush();else if(!timer.current)timer.current=setTimeout(flush,16);
            }}
            onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}/>
        </div>
      </div>
    </div>
    {!full && <footer>{doc.pdf?.name||'Blank canvas'}</footer>}
  </main>;
}
