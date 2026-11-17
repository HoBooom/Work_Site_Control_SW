import { describe, expect, it } from 'vitest';
import { Euler, Vector3 } from 'three';
import { SITE_TO_SCENE_ROTATION_X, siteToScene } from './frame';

describe('siteToScene', () => {
  it('Z-up을 Y-up으로 바꾼다', () => {
    expect(siteToScene([1, 2, 3])).toEqual([1, 3, -2]);
  });

  it('사이트 그룹 회전과 같은 결과다', () => {
    for (const p of [
      [1, 2, 3],
      [-4, 0.5, 7],
      [0, 0, 1],
    ] as const) {
      const v = new Vector3(...p).applyEuler(new Euler(SITE_TO_SCENE_ROTATION_X, 0, 0));
      const [x, y, z] = siteToScene([...p]);
      expect(v.x).toBeCloseTo(x);
      expect(v.y).toBeCloseTo(y);
      expect(v.z).toBeCloseTo(z);
    }
  });
});
