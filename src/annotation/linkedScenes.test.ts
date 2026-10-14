import { beforeAll,afterEach,describe,it,expect,vi } from 'vitest';
import { useApp,type ModuleInstance } from '../state/store';
import { lockBoard } from './connectionLock';
import { annotationBoard } from './surfaces';
let library:typeof import('../state/sceneLibrary'),linked:typeof import('./linked'),ink:typeof import('./store');
const module=(kind:ModuleInstance['kind'],id:string):ModuleInstance=>({id,kind,x:0,y:0,width:960,height:540,baseWidth:960,baseHeight:540,z:1,visible:true,options:{}});
beforeAll(async()=>{
 vi.stubGlobal('window',{location:{search:'',hash:''},addEventListener:vi.fn()});vi.stubGlobal('sessionStorage',{getItem:()=>null,setItem:vi.fn()});vi.stubGlobal('localStorage',{removeItem:vi.fn()});vi.stubGlobal('BroadcastChannel',undefined);vi.stubGlobal('cancelAnimationFrame',vi.fn());
 library=await import('../state/sceneLibrary');linked=await import('./linked');ink=await import('./store');
});
afterEach(()=>lockBoard('paired',null));
function setup(){
 useApp.setState({transitionSeconds:0});
 library.loadSceneWorkspace(['left','right'].map(id=>({id,name:id,shortcut:'',background:{type:'solid' as const,color:'#000000'},modules:[module('notation',id+'-staff'),module('notation',id+'-extra'),module('keyboard',id+'-keys')]})),'left');
}
describe('shared annotation scene lifecycle',()=>{
 it('links matching roles across scenes while keeping additional staff surfaces independent',()=>{
  setup();linked.enableModuleAnnotation('left-staff');const first=annotationBoard(useApp.getState().modules[0]);expect(first).toBeTruthy();
  linked.enableModuleAnnotation('left-extra');const second=annotationBoard(useApp.getState().modules[1]);expect(second).toBeTruthy();expect(second).not.toBe(first);
  const right=library.useScenes.getState().scenes[1];expect(annotationBoard(right.modules![0])).toBe(first);expect(annotationBoard(right.modules![1])).toBe(second);
 });
 it('preserves separate ink and allows scene switching while layout mutations are locked',()=>{
  setup();linked.enableModuleAnnotation('left-staff');linked.enableModuleAnnotation('left-keys');const [staff,,keys]=useApp.getState().modules,staffBoard=annotationBoard(staff)!,keyBoard=annotationBoard(keys)!;
  ink.dispatchInk(staffBoard,{type:'begin',stroke:{id:'stroke',tool:'pen',color:'#ff0000',size:4,points:[[.2,.3,.5]]}});expect(ink.inkState(keyBoard).document.strokes).toEqual([]);
  lockBoard('paired',[960,540]);library.useScenes.getState().createBlank('blocked');expect(library.useScenes.getState().scenes).toHaveLength(2);
  library.useScenes.getState().switchScene('right');expect(library.useScenes.getState().activeId).toBe('right');expect(annotationBoard(useApp.getState().modules[0])).toBe(staffBoard);expect(ink.inkState(staffBoard).document.strokes).toHaveLength(1);
 });
 it('clones projects with new board IDs while preserving sharing between their scenes',()=>{
  setup();linked.enableModuleAnnotation('left-staff');const source=library.useScenes.getState().scenes,map=new Map<string,string>();const copies=source.map(s=>library.copyScene(s,s.name,map));
  const old=annotationBoard(source[0].modules![0]),one=annotationBoard(copies[0].modules![0]),two=annotationBoard(copies[1].modules![0]);expect(one).not.toBe(old);expect(one).toBe(two);
 });
});
