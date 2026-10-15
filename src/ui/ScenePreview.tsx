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
 <rect x={m.x} y={m.y} width={m.width} height={m.height} fill={m.kind==='annotation'?(m.options.background==='white'?'#faf9f6':'transparent'):camera?'#30323a':'#181921'}/>
 {m.kind==='keyboard'?<g transform={`translate(${m.x} ${m.y})`}><KeyboardModule staticPreview width={m.width} height={m.height} rangeLow={typeof m.options.rangeLow==='number'?m.options.rangeLow:21} rangeHigh={typeof m.options.rangeHigh==='number'?m.options.rangeHigh:108}/></g>:m.kind==='notation'?<svg x={m.x} y={m.y} width={m.width} height={m.height} viewBox="0 0 360 225" preserveAspectRatio="xMidYMid meet" aria-label="Grand staff with example C major chord and harmony"><g fill="#e8e9ef" stroke="#e8e9ef">{[65,145].map(y=>Array.from({length:5},(_,j)=><line key={y+j} x1="28" x2="346" y1={y+j*10} y2={y+j*10} strokeWidth="1"/>))}<path d="M28 65v120M346 65v120" fill="none"/><text x="3" y="153" fontSize="92" stroke="none">&#123;</text><text x="35" y="105" fontSize="56" stroke="none">𝄞</text><text x="36" y="182" fontSize="48" stroke="none">𝄢</text>{[80,95,105,150,160,170].map(y=><ellipse key={y} cx="225" cy={y} rx="7" ry="4.5" transform={`rotate(-15 225 ${y})`} fill="#181921" strokeWidth="2"/>)}{m.options.harmonyEnabled!==false&&<text x="225" y={m.options.harmonyMode==='roman'?218:38} textAnchor="middle" fontSize="24" fontFamily="Arial, sans-serif" fontWeight="600" stroke="none">{m.options.harmonyMode==='roman'?'I':'C'}</text>}</g></svg>:m.kind==='harmonic'?<text x={m.x+m.width/2} y={m.y+m.height/2} fontSize={36} fill="#a8abb8" textAnchor="middle">Harmony</text>:m.kind==='text'?<text x={m.x+24} y={m.y+55} fontSize={34} fill="#e6e6e9">Concert information · demonstration</text>:<><text x={m.x+m.width/2} y={m.y+m.height/2} fontSize={36} fill={camera?'#d4d5dc':'#777984'} textAnchor="middle">{camera?(m.kind==='camera'?'Camera':'Overhead camera'):'Annotations / PDF'}</text>{camera&&<rect x={m.x+16} y={m.y+16} width={m.width-32} height={m.height-32} fill="none" stroke="#535662" strokeWidth={2}/>}</>}
 </g>;})}</svg>;
}

