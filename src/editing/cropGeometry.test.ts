import { expect, it } from 'vitest';
import { adjustCrop } from './cropGeometry';
it('moves a crop without resizing it and keeps it within the page',()=>{
 const crop={x:.1,y:.2,width:.7,height:.15};
 expect(adjustCrop(crop,'move',.9,-.9)).toEqual({x:.30000000000000004,y:0,width:.7,height:.15});
});
it('adjusts opposing sides without moving the anchored corner or inverting the crop',()=>{
 const crop={x:.1,y:.2,width:.7,height:.15};
 const grown=adjustCrop(crop,'nw',-.2,-.3);expect(grown.x).toBe(0);expect(grown.y).toBe(0);expect(grown.width).toBeCloseTo(.8);expect(grown.height).toBeCloseTo(.35);
 const bounded=adjustCrop(crop,'se',-2,-2);expect(bounded.width).toBeCloseTo(.02);expect(bounded.height).toBeCloseTo(.01);
});
