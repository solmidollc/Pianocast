type Source = {id:string;name:string;data:string;document:Promise<any>;error?:string};
const sources=new Map<string,Source>(), listeners=new Map<string,Set<()=>void>>();
const cache=new Map<string,HTMLCanvasElement>();
export const MAX_PDF_BYTES=10*1024*1024;
function notify(board:string){listeners.get(board)?.forEach(fn=>fn());}
export function subscribePDF(board:string,fn:()=>void){const set=listeners.get(board)??new Set();listeners.set(board,set);set.add(fn);return()=>{set.delete(fn);};}
export function pdfSourcePacket(board:string) {const s=sources.get(board);return s?{kind:'pdf-file' as const,board,id:s.id,name:s.name,data:s.data}:null;}
export function receivePDFSource(raw:any):boolean {
  if(raw?.kind!=='pdf-file' || typeof raw.board!=='string' || raw.board.length>80 || typeof raw.id!=='string' || raw.id.length>80 ||
     typeof raw.name!=='string' || raw.name.length>160 || typeof raw.data!=='string' || raw.data.length>Math.ceil(MAX_PDF_BYTES*4/3)+4 ||
     !/^[A-Za-z0-9+/]*={0,2}$/.test(raw.data))return false;
  if(sources.get(raw.board)?.id===raw.id)return true;
  const bytes=Uint8Array.from(atob(raw.data),c=>c.charCodeAt(0));
  if(bytes.length>MAX_PDF_BYTES || new TextDecoder().decode(bytes.slice(0,1024)).indexOf('%PDF-')<0)return false;
  const previous=sources.get(raw.board);previous?.document.then(d=>d.loadingTask.destroy()).catch(()=>{});
  for(const key of cache.keys())if(key.startsWith(raw.board+':'))cache.delete(key);
  const document=loadDocument(bytes);
  const source:Source={id:raw.id,name:raw.name,data:raw.data,document};sources.set(raw.board,source);
  document.then(()=>notify(raw.board)).catch(e=>{source.error=e instanceof Error?e.message:'Could not read PDF';notify(raw.board);});
  notify(raw.board);return true;
}
async function loadDocument(data:Uint8Array) {
  const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker=await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url');
  pdf.GlobalWorkerOptions.workerSrc=worker.default;
  const assets=new URL('pdfjs/',window.location.href).href;
  const doc=await pdf.getDocument({data,cMapUrl:assets+'cmaps/',cMapPacked:true,standardFontDataUrl:assets+'standard_fonts/',wasmUrl:assets+'wasm/'}).promise;
  if(doc.numPages>200){await doc.loadingTask.destroy();throw new Error('Please use a PDF with 200 pages or fewer.');}
  return doc;
}
export async function preparePDF(file:File) {
  if(file.size>MAX_PDF_BYTES)throw new Error('Choose a PDF smaller than 10 MB.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(new TextDecoder().decode(bytes.slice(0,1024)).indexOf('%PDF-')<0)throw new Error('Choose a PDF file.');
  let binary='';for(let i=0;i<bytes.length;i+=16000)binary+=String.fromCharCode(...bytes.subarray(i,i+16000));
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const id=Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');
  const data=btoa(binary),document=await loadDocument(bytes);
  const page=await document.getPage(1),viewport=page.getViewport({scale:1});
  const result={id,name:file.name.slice(0,160),data,count:document.numPages,aspect:viewport.width/viewport.height};
  await document.loadingTask.destroy();return result;
}
export async function pdfPageInfo(board:string,index:number) {
  const source=sources.get(board);if(!source)throw new Error('Upload the PDF again after refreshing this page.');
  const doc=await source.document,page=await doc.getPage(index),v=page.getViewport({scale:1});
  return {id:source.id,name:source.name,count:doc.numPages,index,aspect:v.width/v.height};
}
export async function renderPDFPage(board:string,index:number):Promise<HTMLCanvasElement> {
  const source=sources.get(board);if(!source)throw new Error('PDF is still arriving. Reconnect if necessary.');
  const key=board+':'+source.id+':'+index;
  if(cache.has(key))return cache.get(key)!;
  const doc=await source.document,page=await doc.getPage(index),base=page.getViewport({scale:1});
  const resolution=Math.min(2048/base.width,4096/base.height),viewport=page.getViewport({scale:resolution});
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  await page.render({canvas,canvasContext:canvas.getContext('2d')!,viewport}).promise;
  if(cache.size>=6)cache.delete(cache.keys().next().value!);
  cache.set(key,canvas);return canvas;
}
