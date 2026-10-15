import { setTabletInput } from './inputOwner';
import { useSyncExternalStore } from 'react';
const sizes=new Map<string,[number,number]>();
const listeners=new Set<()=>void>();
export function lockBoard(board:string,size:[number,number]|null) {
  if(size)sizes.set(board,size);else sizes.delete(board);setTabletInput(sizes.size>0);listeners.forEach(fn=>fn());
}
export function lockedBoardSize(board:string) {return sizes.get(board);}
export function useBoardLocked(board:string) {
  return useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},()=>sizes.has(board));
}


export function editsLocked(){return sizes.size>0;}
export function useEditsLocked(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},editsLocked);}
