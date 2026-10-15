import { useId } from 'react';
import { KeyboardModule } from '../modules/Keyboard';
import type { LayoutModule } from '../state/templates';
import type { ModuleInstance } from '../state/store';
export function ScenePreview({modules,width=1920,height=1080}:{modules:(LayoutModule|ModuleInstance)[];width?:number;height?:number}){
 const id=useId().replace(/:/g,'');
 return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Scene layout preview" className="project-preview">
 <defs>{modules.map((m,i)=><clipPath key={i} id={id+i}><rect x={m.x} y={m.y} width={m.width} height={m.height}/></clipPath>)}</defs>
 <rect width={width} height={height} fill="#0c0d10"/>
 {[...modules].sort((a,b)=>('z' in a?a.z:modules.indexOf(a))-('z' in b?b.z:modules.indexOf(b))).filter(m=>m.visible).map(m=>{const i=modules.indexOf(m),camera=m.kind==='camera'||m.kind==='overhead'||m.kind==='overheadVisualizer';return <g key={i} clipPath={`url(#${id+i})`}>
 <rect x={m.x} y={m.y} width={m.width} height={m.height} fill={m.kind==='annotation'?'#faf9f6':camera?'#30323a':'#181921'}/>
 {m.kind==='keyboard'?<g transform={`translate(${m.x} ${m.y})`}><KeyboardModule staticPreview width={m.width} height={m.height} rangeLow={typeof m.options.rangeLow==='number'?m.options.rangeLow:21} rangeHigh={typeof m.options.rangeHigh==='number'?m.options.rangeHigh:108}/></g>:m.kind==='notation'?<>{[0,1].map(staff=>Array.from({length:5},(_,j)=><line key={staff+'-'+j} x1={m.x+12} x2={m.x+m.width-12} y1={m.y+m.height*.30+staff*m.height*.35+j*12} y2={m.y+m.height*.30+staff*m.height*.35+j*12} stroke="#b8bac5" strokeWidth={2}/>))}<text x={m.x+18} y={m.y+m.height*.38} fontSize={70} fill="#d8d9e0">𝄞</text></>:m.kind==='harmonic'?<text x={m.x+m.width/2} y={m.y+m.height/2} fontSize={36} fill="#a8abb8" textAnchor="middle">Harmony</text>:m.kind==='text'?<text x={m.x+24} y={m.y+55} fontSize={34} fill="#e6e6e9">Concert information · demonstration</text>:<><text x={m.x+m.width/2} y={m.y+m.height/2} fontSize={36} fill={camera?'#d4d5dc':'#777984'} textAnchor="middle">{camera?(m.kind==='camera'?'Camera':'Overhead camera'):'Annotations / PDF'}</text>{camera&&<rect x={m.x+16} y={m.y+16} width={m.width-32} height={m.height-32} fill="none" stroke="#535662" strokeWidth={2}/>}</>}
 </g>;})}</svg>;
}

