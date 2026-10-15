import {it,expect,vi} from 'vitest';
import {SOFTWARE_INSTRUMENT_AVAILABLE} from './features';
it('keeps deferred software sound off even with a previous opt-in',async()=>{
 vi.stubGlobal('localStorage',{getItem:(key:string)=>key==='pk.audio.sound-opt-in.v1'?'true':null,setItem:vi.fn()});
 const {pianoEngine}=await import('./audio/pianoEngine');
 expect(SOFTWARE_INSTRUMENT_AVAILABLE).toBe(false);expect(pianoEngine.getSnapshot().enabled).toBe(false);
 pianoEngine.setEnabled(true);expect(pianoEngine.getSnapshot().enabled).toBe(false);vi.unstubAllGlobals();
});
