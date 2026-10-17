import { describe,expect,it } from 'vitest';
import { formatProjectRecency,mostRecentFirst,projectRecency } from './projectRecency';

describe('project recency',()=>{
 it('puts a reopened older project above a newer untouched project',()=>{
  const older={id:'reopened',updatedAt:'2026-10-01T10:00:00Z',lastOpenedAt:'2026-10-17T14:00:00Z'};
  const newer={id:'untouched',updatedAt:'2026-10-16T10:00:00Z'};
  expect([newer,older].sort(mostRecentFirst).map(p=>p.id)).toEqual(['reopened','untouched']);
 });
 it('retains the last opened time across later background saves',()=>{
  expect(projectRecency({updatedAt:'2026-10-17T20:00:00Z',lastOpenedAt:'2026-10-17T14:00:00Z'})).toBe('2026-10-17T14:00:00Z');
 });
 it('shows the local time including seconds for a project opened today',()=>{
  const opened=new Date(2026,9,17,14,7,35),now=new Date(2026,9,17,20,0);
  expect(formatProjectRecency(opened.toISOString(),now)).toBe('Today, '+opened.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit',second:'2-digit'}));
 });
 it('uses the local calendar day at midnight and includes the year for older years',()=>{
  const opened=new Date(2026,9,16,23,59),now=new Date(2026,9,17,0,1);
  expect(formatProjectRecency(opened.toISOString(),now)).not.toContain('Today');
  expect(formatProjectRecency(new Date(2025,9,17).toISOString(),now)).toContain('2025');
 });
});
