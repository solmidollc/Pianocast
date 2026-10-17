import { describe, expect, it } from 'vitest';
import { cameraName } from './elementNames';

describe('camera labels', () => {
  it('uses Camera for a single camera, including a previously numbered camera', () => {
    const camera = {kind: 'camera' as const, name: 'Camera 2'};
    expect(cameraName(camera, [camera, {kind: 'overhead'}])).toBe('Camera');
  });
  it('numbers multiple cameras in scene order and resolves cloned modules by id', () => {
    const cameras = [{id: 'a', kind: 'camera' as const}, {id: 'b', kind: 'camera' as const}];
    expect(cameraName({...cameras[0]}, cameras)).toBe('Camera 1');
    expect(cameraName({...cameras[1]}, cameras)).toBe('Camera 2');
  });
  it('keeps a custom camera name', () => {
    const camera = {kind: 'camera' as const, name: 'Pianist'};
    expect(cameraName(camera, [camera])).toBe('Pianist');
  });
});
