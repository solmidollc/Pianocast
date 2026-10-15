import { useSyncExternalStore } from 'react';
const listeners=new Set<()=>void>(),owners=new Set<string>();
const id=crypto.randomUUID();let own=false;
const channel=typeof window!=='undefined'&&typeof BroadcastChannel!=='undefined'?new BroadcastChannel('pianocanva.annotation-input'):null;
const notify=()=>listeners.forEach(fn=>fn());
export function setTabletInput(active:boolean){if(typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('mode')==='annotation')return;own=active;if(active)owners.add(id);else owners.delete(id);channel?.postMessage({id,active});notify();}
export const tabletInputActive=()=>owners.size>0;
export function useTabletInputActive(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},tabletInputActive);}
channel?.addEventListener('message',e=>{if(e.data?.request){if(own)channel.postMessage({id,active:true});return;}if(typeof e.data?.id!=='string'||typeof e.data.active!=='boolean')return;if(e.data.active)owners.add(e.data.id);else owners.delete(e.data.id);notify();});
channel?.postMessage({request:true});
if(typeof window!=='undefined')window.addEventListener('pagehide',()=>{if(own)setTabletInput(false);});
