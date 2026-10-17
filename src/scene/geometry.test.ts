import { expect,it } from 'vitest';
import { applySnap,computeNextRect } from './geometry';
import type { ModuleInstance } from '../state/store';
const rect=(patch:Partial<ModuleInstance>={}):ModuleInstance=>({id:'one',kind:'camera',x:100,y:100,width:400,height:225,baseWidth:400,baseHeight:225,z:1,visible:true,options:{},...patch});
it('snaps moved edges to another element without changing content size',()=>{
 const origin=rect(),other=rect({id:'two',x:800,y:400});
 const result=applySnap('move',origin,{x:397,y:101},1920,1080,8,[other]);
 expect(result.patch.x).toBe(400);expect(result.patch.width).toBe(400);expect(result.vLines).toContain(800);
});
it('matches another element’s width when resizing and preserves corner proportions',()=>{
 const origin=rect(),other=rect({id:'two',x:1200,y:600,width:600,height:300});
 expect(applySnap('e',origin,{width:596},1920,1080,8,[other]).patch.width).toBe(600);
 const next=computeNextRect('se',origin,180,100,'camera');const result=applySnap('se',origin,next,1920,1080,30,[other]);
 expect(result.patch.width!/result.patch.height!).toBeCloseTo(16/9);
});
it('keeps the opposite corner anchored while uniformly resizing',()=>{
 const origin=rect();const next=computeNextRect('nw',origin,-100,-70,'camera');
 expect(next.x!+next.width!).toBeCloseTo(origin.x+origin.width);expect(next.y!+next.height!).toBeCloseTo(origin.y+origin.height);expect(next.width!/next.height!).toBeCloseTo(16/9);
});

it('keeps the opposite edge fixed when a side or corner reaches minimum size',()=>{
 const origin=rect();for(const handle of ['nw','w','n'] as const){const result=computeNextRect(handle,origin,2000,2000,'keyboard');if(handle.includes('w'))expect(result.x!+result.width!).toBe(origin.x+origin.width);if(handle.includes('n'))expect(result.y!+result.height!).toBe(origin.y+origin.height);}
});
