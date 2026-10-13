export type InkTool = 'pen' | 'highlighter' | 'eraser';
export type InkPoint = [number, number, number];
export interface InkStroke { id: string; tool: InkTool; color: string; size: number; points: InkPoint[] }
export interface InkDocument { strokes: InkStroke[]; background: 'transparent' | 'white' }
export type InkAction =
  | { type: 'begin'; stroke: InkStroke }
  | { type: 'points'; strokeId: string; offset: number; points: InkPoint[] }
  | { type: 'undo' | 'redo' | 'clear' }
  | { type: 'background'; value: InkDocument['background'] };
export interface InkState { document: InkDocument; past: InkDocument[]; future: InkDocument[] }
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
    d.strokes.length <= 300 && d.strokes.every(validStroke);
}
export function reduceInk(state: InkState, action: InkAction): InkState {
  const d = state.document;
  const edit = (document: InkDocument): InkState => ({ document, past: [...state.past.slice(-39), d], future: [] });
  if (action.type === 'undo') {
    const prev = state.past.at(-1);
    return prev ? { document: prev, past: state.past.slice(0,-1), future: [d,...state.future].slice(0,40) } : state;
  }
  if (action.type === 'redo') {
    const next = state.future[0];
    return next ? { document: next, past: [...state.past,d].slice(-40), future: state.future.slice(1) } : state;
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
  const scale = Math.min(width / 1600,height / 900);
  const ox = (width - 1600 * scale)/2, oy = (height - 900 * scale)/2;
  ctx.save(); ctx.translate(ox,oy); ctx.scale(scale,scale);
  ctx.beginPath(); ctx.rect(0,0,1600,900); ctx.clip();
  for (const stroke of document.strokes) {
    const pts = stroke.points;
    if (!pts.length) continue;
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.globalAlpha = stroke.tool === 'highlighter' ? .32 : 1;
    ctx.strokeStyle = stroke.color; ctx.fillStyle = stroke.color;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const width = stroke.size * (stroke.tool === 'highlighter' ? 4 : stroke.tool === 'eraser' ? 5 : 1);
    ctx.lineWidth = width;
    if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0]*1600,pts[0][1]*900,width/2,0,Math.PI*2); ctx.fill(); }
    else {
      ctx.beginPath(); ctx.moveTo(pts[0][0]*1600,pts[0][1]*900);
      for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0]*1600,pts[i][1]*900);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  if (document.background === 'white') { ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,1600,900); }
  ctx.restore();
}
