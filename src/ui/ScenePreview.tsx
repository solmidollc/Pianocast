import { useId } from 'react';
import { UserRound, Hand } from 'lucide-react';
import { KeyboardModule } from '../modules/Keyboard';
import { NotationModule } from '../modules/Notation';
import { cameraName } from '../state/elementNames';
import type { LayoutModule } from '../state/templates';
import type { ModuleInstance } from '../state/store';
export function ScenePreview({modules,width=1920,height=1080,scoreSync=false}:{modules:(LayoutModule|ModuleInstance)[];width?:number;height?:number;scoreSync?:boolean}){
 const id=useId().replace(/:/g,''), scoreH=scoreSync?height*.24:0;
 return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={scoreSync?'Scene preview · uses Score Sync':'Scene layout preview'} className="project-preview">
 <defs>{modules.map((m,i)=><clipPath key={i} id={id+i}><rect x={m.x} y={scoreSync?scoreH:m.y} width={m.width} height={scoreSync?height-scoreH:m.height}/></clipPath>)}</defs>
 <rect width={width} height={height} fill="#0c0d10"/>
 {scoreSync&&<><rect width={width} height={scoreH} fill="#faf9f6"/><foreignObject style={{filter:'invert(1)'}} x={width*.3} y="0" width={width*.4} height={scoreH}><NotationModule staticPreview width={width*.4} height={scoreH} baseHeight={220}/></foreignObject></>}
 {[...modules].sort((a,b)=>('z' in a?a.z:modules.indexOf(a))-('z' in b?b.z:modules.indexOf(b))).filter(m=>m.visible).map(m=>{
 const i=modules.indexOf(m), y=scoreSync?scoreH:m.y,h=scoreSync?height-scoreH:m.height,overhead=m.kind==='overhead'||m.kind==='overheadVisualizer',camera=m.kind==='camera',icon=Math.min(m.width*.28,h*.4);
 return <g key={i} clipPath={`url(#${id+i})`} data-preview-kind={m.kind}>
 <rect x={m.x} y={y} width={m.width} height={h} fill={m.kind==='annotation'?(m.options.background==='white'?'#faf9f6':'transparent'):camera||overhead?'#30323a':'#181921'}/>
 {m.kind==='keyboard'||overhead?<g transform={`translate(${m.x} ${y})`}><g opacity={overhead ? 0.5 : 1}><KeyboardModule staticPreview width={m.width} height={h} rangeLow={typeof m.options.rangeLow==='number'?m.options.rangeLow:21} rangeHigh={typeof m.options.rangeHigh==='number'?m.options.rangeHigh:108}/></g>{overhead&&<><Hand x={m.width*.36-icon/2} y={(h-icon)/2} width={icon} height={icon} stroke="#eeeef2" strokeWidth={1.5}/><Hand x={m.width*.64-icon/2} y={(h-icon)/2} width={icon} height={icon} stroke="#eeeef2" strokeWidth={1.5}/></>}</g>:m.kind==='notation'?<foreignObject x={m.x} y={y} width={m.width} height={h}><NotationModule staticPreview width={m.width} height={h} baseHeight={m.baseHeight} harmonyEnabled={m.options.harmonyEnabled!==false}/></foreignObject>:camera?<><UserRound x={m.x+(m.width-icon)/2} y={y+(h-icon)/2-icon*.12} width={icon} height={icon} stroke="#d4d5dc" strokeWidth={1.2}/><text x={m.x+m.width/2} y={y+h/2+icon*.66} fontSize={36} fill="#d4d5dc" textAnchor="middle">{cameraName(m,modules)}</text></>:m.kind==='harmonic'?<text x={m.x+m.width/2} y={y+h/2} fontSize={36} fill="#a8abb8" textAnchor="middle">Harmony</text>:<text x={m.x+m.width/2} y={y+h/2} dominantBaseline="middle" fontSize={36} fill="#a8abb8" textAnchor="middle">{m.kind==='text'?'Concert information':'Annotation'}</text>}
 </g>;})}</svg>;
}
