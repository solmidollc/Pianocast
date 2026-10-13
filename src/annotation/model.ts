export type InkTool = 'pen' | 'highlighter' | 'eraser';
export type InkPoint = [number, number, number];
export interface InkStroke { id: string; tool: InkTool; color: string; size: number; points: InkPoint[] }
export interface PDFPage { id:string; name:string; count:number; index:number; aspect:number }
export interface InkDocument { strokes: InkStroke[]; background: 'transparent' | 'white'; width?:number; height?:number; paper?:[number,number]; pdf?:PDFPage; pages?:Record<string,InkStroke[]>; scroll?:number }
export function boardSize(d:InkDocument):[number,number] { return [d.width ?? 1600,d.height ?? 900]; }
export function inkGeometry(d:InkDocument) {
  const [w,h]=boardSize(d);
  if(d.pdf) { const ph=w/d.pdf.aspect;return {w,h,pw:w,ph,scale:1,ox:0,oy:-(d.scroll ?? 0)*Math.max(0,ph-h)}; }
  const [pw,ph]=d.paper ?? [1600,900];const scale=Math.min(w/pw,h/ph);
  return {w,h,pw,ph,scale,ox:(w-pw*scale)/2,oy:(h-ph*scale)/2};
}
export function pointOnPaper(d:InkDocument,x:number,y:number,pressure:number):InkPoint {
  const g=inkGeometry(d);return [Math.max(0,Math.min(1,(x-g.ox)/g.scale/g.pw)),Math.max(0,Math.min(1,(y-g.oy)/g.scale/g.ph)),pressure];
}
export type InkAction =
  | { type: 'begin'; stroke: InkStroke }
  | { type: 'points'; strokeId: string; offset: number; points: InkPoint[] }
  | { type: 'undo' | 'redo' | 'clear' }
  | { type:'dimensions'; width:number; height:number }
  | { type:'pdf-page'; page:PDFPage }
  | { type:'pdf-close' }
  | { type:'scroll'; value:number }
  | { type: 'background'; value: InkDocument['background'] };
export interface InkState { document: InkDocument; past: InkDocument[]; future: InkDocument[]; pageHistory?:Record<string,{past:InkDocument[];future:InkDocument[]}> }
export const emptyInk = (): InkState => ({ document: { strokes: [], background: 'transparent' }, past: [], future: [] });
export function validPoint(p: unknown): p is InkPoint {
  return Array.isArray(p) && p.length === 3 && p.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1);
}
export function validStroke(s: any): s is InkStroke {
  return s && typeof s.id === 'string' && s.id.length <= 80 && ['pen','highlighter','eraser'].includes(s.tool) &&
    /^#[0-9a-f]{6}$/i.test(s.color) && Number.isFinite(s.size) && s.size >= 1 && s.size <= 40 &&
    Array.isArray(s.points) && s.points.length <= 4096 && s.points.every(validPoint);
}
export function validDocument(d: any): d is InkDocument {
  return d && ['transparent','white'].includes(d.background) && Array.isArray(d.strokes) &&
    d.strokes.length <= 300 && d.strokes.every(validStroke) &&
    (d.width===undefined || Number.isFinite(d.width) && d.width>=80 && d.width<=7680) &&
    (d.height===undefined || Number.isFinite(d.height) && d.height>=80 && d.height<=7680) &&
    (d.paper===undefined || Array.isArray(d.paper) && d.paper.length===2 && d.paper.every((v:number)=>Number.isFinite(v)&&v>=80&&v<=7680)) &&
    (!d.pdf || validPDFPage(d.pdf)) && (d.scroll===undefined || Number.isFinite(d.scroll)&&d.scroll>=0&&d.scroll<=1) &&
    (!d.pages || typeof d.pages==='object' && Object.keys(d.pages).length<=200 && Object.values(d.pages).every((s:any)=>Array.isArray(s)&&s.length<=300&&s.every(validStroke)));
}
export function validPDFPage(p:any):p is PDFPage {
  return p && typeof p.id==='string' && p.id.length<=80 && typeof p.name==='string' && p.name.length<=160 &&
  Number.isInteger(p.count)&&p.count>=1&&p.count<=200 && Number.isInteger(p.index)&&p.index>=1&&p.index<=p.count &&
  Number.isFinite(p.aspect)&&p.aspect>.05&&p.aspect<20;
}
export function reduceInk(state: InkState, action: InkAction): InkState {
  const d = state.document;
  const edit = (document: InkDocument): InkState => ({ ...state, document, past: [...state.past.slice(-39), d], future: [] });
  if(action.type==='dimensions') {
    if(!Number.isFinite(action.width)||!Number.isFinite(action.height)||action.width<80||action.height<80||action.width>7680||action.height>7680)return state;
    if(d.width===action.width && d.height===action.height)return state;
    return {...state,document:{...d,width:action.width,height:action.height,paper:d.strokes.length || d.pdf ? d.paper : [action.width,action.height]}};
  }
  if(action.type==='scroll')return Number.isFinite(action.value)&&action.value>=0&&action.value<=1
    ? {...state,document:{...d,scroll:action.value}} : state;
  if(action.type==='pdf-close')return {...emptyInk(),document:{...d,pdf:undefined,pages:undefined,strokes:[],scroll:0}};
  if(action.type==='pdf-page') {
    if(!validPDFPage(action.page))return state;
    const same=d.pdf?.id===action.page.id, pages=same ? {...d.pages,[String(d.pdf!.index)]:d.strokes} : {};
    const pageHistory=same?{...state.pageHistory,[String(d.pdf!.index)]:{past:state.past,future:state.future}}:{};
    const history=pageHistory[String(action.page.index)];
    return {...state,pageHistory,past:history?.past??[],future:history?.future??[],document:{...d,pdf:action.page,pages,strokes:pages[String(action.page.index)] ?? [],scroll:0}};
  }
  if (action.type === 'undo') {
    const prev = state.past.at(-1);
    return prev ? { ...state, document: {...d,strokes:prev.strokes,background:prev.background}, past: state.past.slice(0,-1), future: [d,...state.future].slice(0,40) } : state;
  }
  if (action.type === 'redo') {
    const next = state.future[0];
    return next ? { ...state, document: {...d,strokes:next.strokes,background:next.background}, past: [...state.past,d].slice(-40), future: state.future.slice(1) } : state;
  }
  if (action.type === 'clear') return d.strokes.length ? edit({ ...d, strokes: [] }) : state;
  if (action.type === 'background') return ['transparent','white'].includes(action.value) && action.value !== d.background
    ? edit({ ...d, background: action.value }) : state;
  if (action.type === 'begin') return validStroke(action.stroke) && d.strokes.length < 300 && !d.strokes.some(s => s.id === action.stroke.id)
    ? edit({ ...d, strokes: [...d.strokes,action.stroke] }) : state;
  if (action.type === 'points') {
    if (!Array.isArray(action.points) || action.points.length > 128 || !action.points.every(validPoint)) return state;
    const stroke = d.strokes.find(s => s.id === action.strokeId);
    if (!stroke || stroke.points.length !== action.offset || stroke.points.length + action.points.length > 4096) return state;
    return { ...state, document: { ...d, strokes: d.strokes.map(s => s === stroke ? {...s,points:[...s.points,...action.points]} : s) } };
  }
  return state;
}
export function drawInk(ctx: CanvasRenderingContext2D, document: InkDocument, width: number, height: number) {
  ctx.clearRect(0,0,width,height);
  const g=inkGeometry(document), fit=Math.min(width/g.w,height/g.h);
  ctx.save();ctx.translate((width-g.w*fit)/2,(height-g.h*fit)/2);ctx.scale(fit,fit);
  ctx.beginPath();ctx.rect(0,0,g.w,g.h);ctx.clip();
  ctx.translate(g.ox,g.oy);ctx.scale(g.scale,g.scale);
  for (const stroke of document.strokes) {
    const pts = stroke.points;
    if (!pts.length) continue;
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.globalAlpha = stroke.tool === 'highlighter' ? .32 : 1;
    ctx.strokeStyle = stroke.color; ctx.fillStyle = stroke.color;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const width = stroke.size * (stroke.tool === 'highlighter' ? 4 : stroke.tool === 'eraser' ? 5 : 1);
    ctx.lineWidth = width;
    if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0]*g.pw,pts[0][1]*g.ph,width/2,0,Math.PI*2); ctx.fill(); }
    else {
      ctx.beginPath(); ctx.moveTo(pts[0][0]*g.pw,pts[0][1]*g.ph);
      for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0]*g.pw,pts[i][1]*g.ph);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  if (!document.pdf && document.background === 'white') { ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,g.pw,g.ph); }
  ctx.restore();
}
