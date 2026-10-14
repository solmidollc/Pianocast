import { describe,it,expect,afterEach } from 'vitest';
import { annotationBoard,validSurfaceCatalog,receiveSurfaceCatalog,useSurfaceCatalog } from './surfaces';
import { lockBoard,editsLocked } from './connectionLock';
import { useApp,type ModuleInstance } from '../state/store';
const module=(kind:ModuleInstance['kind'],options:ModuleInstance['options']={}):ModuleInstance=>({id:kind,kind,x:0,y:0,width:960,height:540,baseWidth:960,baseHeight:540,z:1,visible:true,options});
afterEach(()=>lockBoard('test',null));
describe('linked teaching surfaces',()=>{
 it('resolves regular and linked boards without confusing module ids',()=>{
  expect(annotationBoard(module('annotation'))).toBe('annotation');expect(annotationBoard(module('annotation',{boardId:'whiteboard'}))).toBe('whiteboard');expect(annotationBoard(module('notation',{annotationBoardId:'staff'}))).toBe('staff');expect(annotationBoard(module('keyboard'))).toBeUndefined();expect(annotationBoard(module('camera',{annotationBoardId:'wrong'}))).toBeUndefined();
 });
 it('accepts frozen SVG references and rejects invalid or remote references',()=>{
  const catalog={kind:'surfaces',scene:'Stage Left',surfaces:[{board:'staff',label:'Staff',kind:'notation',width:240,height:320,reference:'data:image/svg+xml;charset=utf-8,%3Csvg/%3E'}]};
  expect(validSurfaceCatalog(catalog)).toBe(true);expect(validSurfaceCatalog({...catalog,surfaces:[{...catalog.surfaces[0],reference:'https://example.org/track'}]})).toBe(false);expect(validSurfaceCatalog({...catalog,surfaces:[catalog.surfaces[0],catalog.surfaces[0]]})).toBe(false);
 });
 it('replaces the visible surface list on scene changes including empty scenes',()=>{
  receiveSurfaceCatalog({kind:'surfaces',scene:'Lesson',surfaces:[{board:'staff',label:'Staff',kind:'notation',width:240,height:320}]});
  expect(useSurfaceCatalog.getState().surfaces[0].board).toBe('staff');receiveSurfaceCatalog({kind:'surfaces',scene:'Camera only',surfaces:[]});expect(useSurfaceCatalog.getState().surfaces).toEqual([]);
 });
 it('locks actual mutation paths while paired, then releases them on disconnect',()=>{
  useApp.setState({modules:[module('keyboard')],key:{tonic:'C',mode:'major'}});const before=useApp.getState();lockBoard('test',[960,540]);expect(editsLocked()).toBe(true);
  before.updateModule('keyboard',{x:100,options:{range:[48,72]}});before.removeModule('keyboard');before.toggleVisible('keyboard');before.addModule('camera');before.reorderLayers(['keyboard']);before.setKey({tonic:'G',mode:'major'});before.setBackground({type:'solid',color:'#ffffff'});
  expect(useApp.getState().modules).toEqual(before.modules);expect(useApp.getState().key.tonic).toBe('C');expect(useApp.getState().background).toEqual(before.background);
  lockBoard('test',null);before.updateModule('keyboard',{x:100});expect(useApp.getState().modules[0].x).toBe(100);
 });
});
