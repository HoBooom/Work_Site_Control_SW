import { describe, expect, it } from 'vitest';
import { surfaceCorners, surfaceToSite, type SurfaceConfig } from './surface';

const H = Math.SQRT1_2;
const wall: SurfaceConfig = {
  id: 'side-shell',
  name: '외판',
  size_mm: [9600, 1500],
  // X축 90°: 면 Y → 사이트 +Z, 면 +Z(로봇 쪽) → 사이트 -Y
  pose: { position_m: [-4.8, 3.193, 0.32], orientation_xyzw: [H, 0, 0, H] },
};

describe('surfaceToSite', () => {
  it('수직 면: 면 X는 사이트 X, 면 Y는 위, 법선은 -Y', () => {
    const p = surfaceToSite(wall, [1000, 500], 20);
    expect(p[0]).toBeCloseTo(-3.8, 9);
    expect(p[1]).toBeCloseTo(3.193 - 0.02, 9);
    expect(p[2]).toBeCloseTo(0.82, 9);
  });

  it('네 모서리', () => {
    const c = surfaceCorners(wall);
    expect(c[2][0]).toBeCloseTo(4.8, 9);
    expect(c[2][2]).toBeCloseTo(1.82, 9);
    c.forEach((p) => expect(p[1]).toBeCloseTo(3.193, 9));
  });
});
