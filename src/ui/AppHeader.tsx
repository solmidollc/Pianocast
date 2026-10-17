import { useSyncExternalStore } from 'react';
import { recorder } from '../recording/recorder';
import { ThemePicker,type StudioTheme } from './StudioView';

export function AppHeader({theme,onTheme,onHome,disabled=false}:{theme:StudioTheme;onTheme:(theme:StudioTheme)=>void;onHome:()=>void;disabled?:boolean}) {
 const recording=useSyncExternalStore(cb=>recorder.subscribe(cb),()=>recorder.getSnapshot());
 const locked=disabled||['recording','paused','starting','stopping'].includes(recording.status);
 return <header className="app-header" data-theme={theme}><button className="app-wordmark" disabled={locked} onClick={onHome}>PianoCanva</button><ThemePicker theme={theme} onChange={onTheme}/></header>;
}
