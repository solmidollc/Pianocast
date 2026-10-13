import { dispatchInk, publishPDF, inkState } from './store';
import { preparePDF,pdfPageInfo,renderPDFPage } from './pdfSource';
export async function uploadBoardPDF(board:string,file:File) {
  const pdf=await preparePDF(file);
  publishPDF(board,{kind:'pdf-file',board,id:pdf.id,name:pdf.name,data:pdf.data});
  await renderPDFPage(board,1);
  dispatchInk(board,{type:'pdf-page',page:{id:pdf.id,name:pdf.name,count:pdf.count,index:1,aspect:pdf.aspect}});
}
export async function changePDFPage(board:string,index:number) {
  const d=inkState(board).document;if(!d.pdf)return;
  const selected=Math.max(1,Math.min(d.pdf.count,index));
  await renderPDFPage(board,selected);
  dispatchInk(board,{type:'pdf-page',page:await pdfPageInfo(board,selected)});
}
