import { describe, expect, it } from 'vitest';
import { plateToSite, type CellConfig } from './plate';

const cell = (cellPos: [number, number, number], cellYaw: number, platePos: [number, number, number], plateYaw: number): CellConfig => ({
  id: 'c',
  name: 'c',
  pose: { position_m: cellPos, yaw_deg: cellYaw },
  plate: { size_mm: [1000, 500], pose: { position_m: platePos, yaw_deg: plateYaw } },
  robot: { urdf: null, pose: { position_m: [0, 0, 0], yaw_deg: 0 } },
});

/** 0.1mm 이내(spec SC-02) */
function expectNear(a: number[], b: number[]) {
  a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(0.0001));
}

describe('plateToSite', () => {
  it('회전이 없으면 이동만 더한다', () => {
    const c = cell([0, 4, 0], 0, [0.45, -0.25, 0.8], 0);
    expectNear(plateToSite(c, [0, 0]), [0.45, 3.75, 0.8]);
    expectNear(plateToSite(c, [1000, 500]), [1.45, 4.25, 0.8]);
    expectNear(plateToSite(c, [500, 250]), [0.95, 4.0, 0.8]);
  });

  it('셀과 판의 회전을 차례로 적용한다(네 모서리와 중심)', () => {
    // 셀 90° + 판 90° = 180°: 판 +X는 사이트 -X, 판 +Y는 사이트 -Y. 판 원점은 셀 90° 회전으로 (1,0)→(0,1)
    const c = cell([10, 0, 0], 90, [1, 0, 0.8], 90);
    expectNear(plateToSite(c, [0, 0]), [10, 1, 0.8]);
    expectNear(plateToSite(c, [1000, 0]), [9, 1, 0.8]);
    expectNear(plateToSite(c, [0, 500]), [10, 0.5, 0.8]);
    expectNear(plateToSite(c, [1000, 500]), [9, 0.5, 0.8]);
    expectNear(plateToSite(c, [500, 250]), [9.5, 0.75, 0.8]);
  });

  it('판 위 높이(mm)를 더한다', () => {
    expectNear(plateToSite(cell([0, 0, 0], 0, [0, 0, 1], 0), [0, 0], 5), [0, 0, 1.005]);
  });
});
