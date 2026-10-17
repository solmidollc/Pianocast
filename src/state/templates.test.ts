import { describe,it,expect } from 'vitest';
import { TEMPLATES,templateById,PRO_CREATOR,PLAYER_PIANO } from './templates';
describe('project template layouts',()=>{
 it('provides distinct usable templates with valid canvas geometry',()=>{
  expect(new Set(TEMPLATES.map(t=>t.id)).size).toBe(TEMPLATES.length);
  for(const template of TEMPLATES)for(const scene of template.scenes){
   const modules=scene.build(1920,1080);expect(modules.length).toBeGreaterThan(0);
   for(const module of modules){expect(module.width).toBeGreaterThan(0);expect(module.height).toBeGreaterThan(0);expect(module.x).toBeGreaterThanOrEqual(0);expect(module.y).toBeGreaterThanOrEqual(0);expect(module.x+module.width).toBeLessThanOrEqual(1920);expect(module.y+module.height).toBeLessThanOrEqual(1080);}
  }
 });
 it('classical side scenes use physical keyboard and annotations instead of MIDI analysis',()=>{
  for(const scene of templateById('classical-tutorial').scenes.slice(0,2)){
   const kinds=scene.build(1920,1080).map(m=>m.kind);expect(kinds).toContain('overhead');expect(kinds).not.toContain('keyboard');expect(kinds).not.toContain('notation');expect(kinds).not.toContain('harmonic');
   if(scene.id!=='headshot')expect(kinds).toContain('annotation');
  }
 });
 it('Theory Mode keeps annotation and integrated chord notation above the keyboard without overlap',()=>{
  for(const scene of templateById('jazz-tutorial').scenes.slice(0,2)){
   const modules=scene.build(1920,1080),notation=modules.find(m=>m.kind==='notation')!,ink=modules.find(m=>m.kind==='annotation')!,keyboard=modules.find(m=>m.kind==='keyboard')!;
   expect(modules.some(m=>m.kind==='harmonic')).toBe(false);expect(notation.options.harmonyMode).toBe('chord');expect(ink.y+ink.height).toBeLessThanOrEqual(notation.y);expect(notation.y+notation.height).toBeLessThanOrEqual(keyboard.y);expect(notation.x).toBe(ink.x);
  }
 });
 it('uses annotation-only Player Piano for compatible acoustic instruments and Pro Creator for Theory Mode',()=>{
  expect(templateById('classical-tutorial').scenes.map(s=>s.id)).toContain(PLAYER_PIANO.id);expect(templateById('jazz-tutorial').scenes.map(s=>s.id)).toContain(PRO_CREATOR.id);
  expect(PLAYER_PIANO.restriction).toContain('Disklavier');expect(PLAYER_PIANO.restriction).toContain('Spirio');
  const kinds=PLAYER_PIANO.build(1920,1080).map(m=>m.kind);expect(kinds).toContain('annotation');expect(kinds).not.toContain('notation');expect(kinds).not.toContain('harmonic');
 });
 it('keeps performance scenes separate and shares Score Sync for Interpreter recordings',()=>{
  for(const t of TEMPLATES.filter(t=>t.category==='performance')){expect(t.scenes).toHaveLength(1);expect(['creator','headshot','creator-right']).not.toContain(t.scenes[0].id);}
  const scene=templateById('studio-recording').scenes[0];expect(scene.scoreSync).toBe(true);expect(scene.build(1920,1080).map(m=>m.kind)).toEqual(['camera']);
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
