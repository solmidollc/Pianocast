import { integrateHarmony } from './harmonyMigration';
import { SCENE_PRESETS } from './scenePresets';
import type { ModuleInstance, ModuleKind } from './store';
export type LayoutModule = Omit<ModuleInstance,'id'|'z'>;
export type Category = 'tutorial'|'performance'|'presentation'|'livestream';
export interface SceneDefinition { id:string; name:string; description:string; build:(w:number,h:number)=>LayoutModule[] }
export interface TemplateDefinition { id:string; name:string; category:Category; description:string; scenes:SceneDefinition[]; supportedComponents:ModuleKind[]; future?:string[] }
const slot=(kind:ModuleKind,x:number,y:number,width:number,height:number,options:Record<string,unknown>={}):LayoutModule=>({kind,x,y,width,height,baseWidth:width,baseHeight:height,visible:true,options});
const resize=(m:LayoutModule,x:number,y:number,width:number,height:number)=>({...m,x,y,width,height,baseWidth:width,baseHeight:height});
const original=(id:string,w:number,h:number)=>SCENE_PRESETS.find(s=>s.id===id)!.build(w,h);
const annotation=(x:number,y:number,w:number,h:number)=>slot('annotation',x,y,w,h,{background:'white'});
function side(classical:boolean,right:boolean,w:number,h:number):LayoutModule[] {
 const source=original('creator',w,h),camera=source.find(m=>m.kind==='camera')!,keyboard=source.find(m=>m.kind==='keyboard')!;
 const margin=16,sideX=camera.x+camera.width+margin,sideW=w-sideX-margin;
 const content=classical?[camera,annotation(sideX,margin,sideW,h-keyboard.height-margin*2),{...original('overhead-creator',w,h).find(m=>m.kind==='overhead')!,y:keyboard.y,height:keyboard.height,baseHeight:keyboard.height}]:[
 camera,keyboard,annotation(sideX,margin,sideW,(h-keyboard.height)*.48),
 resize(source.find(m=>m.kind==='harmonic')!,sideX,(h-keyboard.height)*.50,sideW,110),
 resize(source.find(m=>m.kind==='notation')!,sideX+(sideW-240)/2,(h-keyboard.height)*.50+126,240,Math.max(180,h-keyboard.height-((h-keyboard.height)*.50+142)))];
 return right?content.map(m=>({...m,x:w-m.x-m.width})):content;
}
export const PRO_CREATOR:SceneDefinition={id:'overhead-creator',name:'Pro Creator',description:'Camera, overhead, keyboard, notation and annotations.',build:(w,h)=>{
 const source=original('overhead-creator',w,h),camera=source.find(m=>m.kind==='camera')!;
 const half=(camera.width-16)/2;
 return source.map(m=>m.kind==='camera'?resize(m,m.x,m.y,half,m.height):m).concat(annotation(camera.x+half+16,camera.y,half,camera.height));
}};
const tutorial=(classical:boolean):SceneDefinition[]=>[
 {id:'creator',name:'Stage Left',description:classical?'Camera left, annotations right, physical keyboard below.':'Camera left, annotations and music tools right.',build:(w,h)=>side(classical,false,w,h)},
 {id:'creator-right',name:'Stage Right',description:classical?'Annotations left, camera right, physical keyboard below.':'Music tools left, camera right.',build:(w,h)=>side(classical,true,w,h)},
 {id:'headshot',name:'Spotlight',description:classical?'Main camera above the physical keyboard.':'Main camera above the MIDI keyboard.',build:(w,h)=>original('headshot',w,h).map(m=>classical&&m.kind==='keyboard'?{...original('overhead-creator',w,h).find(o=>o.kind==='overhead')!,x:m.x,y:m.y,width:m.width,height:m.height,baseWidth:m.width,baseHeight:m.height}:m)},PRO_CREATOR];
const presentation=(online:boolean):SceneDefinition=>({id:online?'online-meeting':'in-person',name:online?'Online Meeting':'In-Person',description:online?'Large annotation workspace with a corner camera.':'Large annotation workspace and keyboard.',build:(w,h)=>{
 const k=original('headshot',w,h).find(m=>m.kind==='keyboard')!,cw=w*.24,ch=h*.24;
 const a=annotation(16,16,online?w-cw-48:w-32,h-k.height-32);
 return [a,k,...(online?[resize(original('headshot',w,h).find(m=>m.kind==='camera')!,w-cw-16,16,cw,ch)]:[])];
}});
const all:ModuleKind[]=['camera','overhead','overheadVisualizer','annotation','notation','keyboard','text'];
export const TEMPLATES:TemplateDefinition[]=[
 {id:'classical-tutorial',name:'Classical Tutorial',category:'tutorial',description:'Physical piano footage, sheet music and annotations.',scenes:tutorial(true),supportedComponents:all},
 {id:'jazz-tutorial',name:'Jazz Tutorial',category:'tutorial',description:'Highlighted notes, harmony, notation and annotations.',scenes:tutorial(false),supportedComponents:all},
 {id:'studio-recording',name:'The Interpreter',category:'performance',description:'A wide score strip above the main camera.',scenes:[{id:'studio-recording',name:'The Interpreter',description:'Score above, camera below.',build:(w,h)=>[annotation(16,16,w-32,h*.22-24),resize(original('headshot',w,h).find(m=>m.kind==='camera')!,16,h*.22+8,w-32,h*.78-24)]}],supportedComponents:all,future:['Tap to Sync']},
 {id:'performance-spotlight',name:'Spotlight',category:'performance',description:'Main camera above the overhead piano view.',scenes:[{id:'performance-spotlight',name:'Spotlight',description:'Main camera above, overhead camera below.',build:(w,h)=>[resize(original('headshot',w,h).find(m=>m.kind==='camera')!,16,16,w-32,h*.72-24),resize(original('overhead-creator',w,h).find(m=>m.kind==='overhead')!,16,h*.72+8,w-32,h*.28-24)]}],supportedComponents:all},
 {id:'entertainer',name:'The Entertainer',category:'performance',description:'Two camera angles above an overhead piano view.',scenes:[{id:'entertainer',name:'The Entertainer',description:'Two main angles and an overhead camera.',build:(w,h)=>[ {...resize(original('headshot',w,h).find(m=>m.kind==='camera')!,16,16,(w-48)/2,h*.72-24),name:'Camera 1'}, {...resize(original('headshot',w,h).find(m=>m.kind==='camera')!,w/2+8,16,(w-48)/2,h*.72-24),name:'Camera 2'},resize(original('overhead-creator',w,h).find(m=>m.kind==='overhead')!,16,h*.72+8,w-32,h*.28-24)]}],supportedComponents:all},
 {id:'livestream',name:'Livestream',category:'livestream',description:'Concert camera layouts and information overlays. Live output requires the desktop camera feature.',scenes:[{id:'livestream',name:'Concert',description:'Performance view with demonstration concert information.',build:(w,h)=>[resize(original('headshot',w,h)[0],0,0,w,h),slot('text',32,h-220,w-64,188,{text:'DEMONSTRATION · Piano Recital\nNocturne in E-flat · Frédéric Chopin (1810–1849)\nYour Name · Piano',fontSize:36,color:'#ffffff',backdrop:true})]}],supportedComponents:all,future:['Concert Program Manager']},
 {id:'in-person',name:'In-Person',category:'livestream',description:'An uncluttered workspace for classroom projection.',scenes:[presentation(false)],supportedComponents:all},
 {id:'online-meeting',name:'Online Meeting',category:'livestream',description:'Annotations and keyboard with a small camera view.',scenes:[presentation(true)],supportedComponents:all}
];
export const CATEGORIES:{id:Category;name:string;description:string}[]=[{id:'tutorial',name:'Tutorial',description:'Create engaging music lessons with instructional tools.'},{id:'performance',name:'Performance',description:'Capture and share your musical performances.'},{id:'presentation',name:'Presentation',description:'Bring music instruction and demonstrations to your audience.'}];
export const templateById=(id:string)=>TEMPLATES.find(t=>t.id===id)!;


// Every teaching layout includes a staff with the appropriate analysis default.
for(const template of TEMPLATES)template.scenes=template.scenes.map(scene=>{const build=scene.build;return {...scene,build:(w,h)=>{
 let elements=build(w,h);const mode=template.id==='classical-tutorial'?'roman':'chord';
 if(template.category==='tutorial'&&!elements.some(m=>m.kind==='notation')){
  const camera=elements.find(m=>m.kind==='camera');
  if(scene.id==='headshot'&&camera){const staffW=w*.28;elements=elements.map(m=>m===camera?resize(m,m.x,m.y,m.width-staffW-16,m.height):m);elements.push(slot('notation',w-staffW-16,16,staffW,320,{harmonyMode:mode}));}
  else {const board=elements.find(m=>m.kind==='annotation'),x=board?.x??w*.65,width=board?.width??w*.32;elements.push(slot('notation',x,16,width,320,{harmonyMode:mode}));if(board){board.y+=330;board.height=Math.max(120,board.height-330);board.baseHeight=board.height;}}
 }
 return integrateHarmony(elements,mode).map(m=>m.kind==='notation'?{...m,options:{...m.options,harmonyMode:mode,harmonyEnabled:true}}:m);
}};});
