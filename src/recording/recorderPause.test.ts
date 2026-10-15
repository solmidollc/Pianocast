import { beforeAll, afterEach, expect, it, vi } from 'vitest';
vi.mock('../audio/pianoEngine',()=>({pianoEngine:{}}));
vi.mock('../audio/audioInput',()=>({audioInput:{}}));
let recorder:typeof import('./recorder')['recorder'];
beforeAll(async()=>{vi.stubGlobal('BroadcastChannel',undefined);vi.stubGlobal('window',{addEventListener:vi.fn(),location:{search:'',hash:''},setTimeout:(...args:any[])=>setTimeout(args[0],args[1])});vi.stubGlobal('sessionStorage',{getItem:()=>null,setItem:vi.fn()});vi.stubGlobal('localStorage',{getItem:()=>null});recorder=(await import('./recorder')).recorder;});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();});
it('pauses video and audio together and excludes the pause from elapsed recording time',()=>{
 vi.useFakeTimers();let now=10000;vi.spyOn(performance,'now').mockImplementation(()=>now);
 const internal=recorder as any;
 const media={state:'recording',pause:vi.fn(()=>{media.state='paused';}),resume:vi.fn(()=>{media.state='recording';}),stop:vi.fn()};
 internal.mediaRecorder=media;internal.startedAt=5000;internal.state={...internal.state,status:'recording',elapsedMs:4800};
 recorder.pause();expect(media.pause).toHaveBeenCalledOnce();expect(recorder.getSnapshot()).toMatchObject({status:'paused',elapsedMs:5000});
 now=20000;vi.advanceTimersByTime(10000);expect(recorder.getSnapshot().elapsedMs).toBe(5000);
 const options=recorder.getSnapshot().options;recorder.setOptions({fps:30});expect(recorder.getSnapshot().options).toBe(options);
 recorder.resume();expect(media.resume).toHaveBeenCalledOnce();now=21000;vi.advanceTimersByTime(250);expect(recorder.getSnapshot()).toMatchObject({status:'recording',elapsedMs:6000});
 recorder.pause();expect(recorder.getSnapshot().status).toBe('paused');void recorder.stop();expect(media.stop).toHaveBeenCalledOnce();expect(recorder.getSnapshot().status).toBe('stopping');
});
it('ignores pause/resume requests outside their valid states',()=>{const internal=recorder as any;internal.state={...internal.state,status:'idle'};internal.mediaRecorder=null;expect(()=>{recorder.pause();recorder.resume();}).not.toThrow();expect(recorder.getSnapshot().status).toBe('idle');});
