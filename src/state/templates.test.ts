import { describe,it,expect } from 'vitest';
import { TEMPLATES,templateById,PRO_CREATOR } from './templates';
describe('project template layouts',()=>{
 it('provides six distinct usable templates with valid canvas geometry',()=>{
  expect(new Set(TEMPLATES.map(t=>t.id)).size).toBe(6);
  for(const template of TEMPLATES)for(const scene of template.scenes){
   const modules=scene.build(1920,1080);expect(modules.length).toBeGreaterThan(0);
   for(const module of modules){expect(module.width).toBeGreaterThan(0);expect(module.height).toBeGreaterThan(0);expect(module.x).toBeGreaterThanOrEqual(0);expect(module.y).toBeGreaterThanOrEqual(0);expect(module.x+module.width).toBeLessThanOrEqual(1920);expect(module.y+module.height).toBeLessThanOrEqual(1080);}
  }
 });
 it('classical side scenes use physical keyboard and annotations instead of MIDI analysis',()=>{
  for(const scene of templateById('classical-tutorial').scenes.slice(0,3)){
   const kinds=scene.build(1920,1080).map(m=>m.kind);expect(kinds).toContain('overhead');expect(kinds).not.toContain('keyboard');expect(kinds).not.toContain('notation');expect(kinds).not.toContain('harmonic');
   if(scene.id!=='headshot')expect(kinds).toContain('annotation');
  }
 });
 it('jazz side scenes have annotation and harmony above notation without overlap',()=>{
  for(const scene of templateById('jazz-tutorial').scenes.slice(0,2)){
   const modules=scene.build(1920,1080),harmonic=modules.find(m=>m.kind==='harmonic')!,notation=modules.find(m=>m.kind==='notation')!,ink=modules.find(m=>m.kind==='annotation')!,keyboard=modules.find(m=>m.kind==='keyboard')!;
   expect(harmonic.y+harmonic.height).toBeLessThan(notation.y);expect(ink.y+ink.height).toBeLessThan(harmonic.y);expect(notation.y+notation.height).toBeLessThan(keyboard.y);expect(notation.x).toBeGreaterThanOrEqual(harmonic.x);
  }
 });
 it('shares one Pro Creator definition for classical and jazz',()=>{
  expect(templateById('classical-tutorial').scenes[3]).toBe(PRO_CREATOR);expect(templateById('jazz-tutorial').scenes[3]).toBe(PRO_CREATOR);expect(PRO_CREATOR.build(1920,1080).some(m=>m.kind==='annotation')).toBe(true);
 });
 it('keeps performance scenes separate and future tools explicit',()=>{
  for(const t of TEMPLATES.filter(t=>t.category==='performance')){expect(t.scenes).toHaveLength(1);expect(['creator','headshot','creator-right']).not.toContain(t.scenes[0].id);expect(t.future?.length).toBeGreaterThan(0);}
  expect(templateById('studio-recording').scenes[0].build(1920,1080).some(m=>m.kind==='annotation')).toBe(true);
 });
 it('presentation makes annotation dominant with no default in-person camera',()=>{
  const inPerson=templateById('in-person').scenes[0].build(1920,1080),online=templateById('online-meeting').scenes[0].build(1920,1080);
  expect(inPerson.map(m=>m.kind)).toEqual(['annotation','keyboard']);expect(online.map(m=>m.kind)).toEqual(['annotation','keyboard','camera']);
  for(const modules of [inPerson,online]){const ink=modules[0],keyboard=modules[1];expect(ink.y+ink.height).toBeLessThan(keyboard.y);expect(ink.width*ink.height).toBeGreaterThan(1920*1080*.5);}
 });
 it('builds independent scene option objects for customization',()=>{
  const scene=templateById('classical-tutorial').scenes[0],one=scene.build(1920,1080),two=scene.build(1920,1080);one[0].options.deviceId='test';expect(two[0].options.deviceId).toBeNull();
 });
});
