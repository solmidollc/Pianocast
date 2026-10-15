import type { SavedScene } from './sceneLibrary';
import type { InkDocument } from '../annotation/model';
/** Board identity belongs to an annotation name within one project. */
export function linkNamedAnnotations(scenes:SavedScene[],document:(board:string)=>InkDocument|undefined=()=>undefined):SavedScene[]{
 const groups=new Map<string,{board:string;score:number}>();
 for(const scene of scenes)for(const m of scene.modules??[]){if(m.kind!=='annotation')continue;const name=(m.name?.trim()||'Annotation').toLocaleLowerCase(),board=String(m.options.boardId??m.id),d=document(board),score=d?.pdf?3:d?.strokes.length?2:d?.background==='white'?1:0;
  if(!groups.has(name)||score>groups.get(name)!.score)groups.set(name,{board,score});
 }
 return scenes.map(scene=>{let changed=false;const modules=scene.modules?.map(m=>{if(m.kind!=='annotation')return m;const board=groups.get((m.name?.trim()||'Annotation').toLocaleLowerCase())!.board;if(board===String(m.options.boardId??m.id))return m;changed=true;return {...m,options:{...m.options,boardId:board}};})??null;return changed?{...scene,modules}:scene;});
}
