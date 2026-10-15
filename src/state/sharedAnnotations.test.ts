import {describe,it,expect} from 'vitest';
import {linkNamedAnnotations} from './sharedAnnotations';
import type {SavedScene} from './sceneLibrary';
import type {InkDocument} from '../annotation/model';
const scene=(id:string,name='Annotation'):SavedScene=>({id,name:id,shortcut:'',background:{type:'solid',color:'#000'},modules:[{id,kind:'annotation',name,x:0,y:0,width:600,height:400,baseWidth:600,baseHeight:400,z:1,visible:true,options:{boardId:id}}]});
describe('named annotation sharing',()=>{
 it('shares same-named elements without changing scene geometry or separate names',()=>{const input=[scene('left'),scene('right',' annotation '),scene('other','Score')],linked=linkNamedAnnotations(input);expect(linked[1].modules![0].options.boardId).toBe('left');expect(linked[2].modules![0].options.boardId).toBe('other');expect(input[1].modules![0].options.boardId).toBe('right');expect(linkNamedAnnotations(linked)).toEqual(linked);});
 it('selects an existing PDF instead of an empty board during migration',()=>{const docs:Record<string,InkDocument>={pdf:{background:'transparent',strokes:[],pdf:{id:'score',name:'Score.pdf',count:4,index:2,aspect:.7},scroll:.4}};const linked=linkNamedAnnotations([scene('empty'),scene('pdf')],id=>docs[id]);expect(linked.every(s=>s.modules![0].options.boardId==='pdf')).toBe(true);expect(docs.pdf.pdf!.index).toBe(2);expect(docs.pdf.scroll).toBe(.4);});
 it('keeps project board identities isolated',()=>{expect(linkNamedAnnotations([scene('project-one')])[0].modules![0].options.boardId).toBe('project-one');expect(linkNamedAnnotations([scene('project-two')])[0].modules![0].options.boardId).toBe('project-two');});
});
