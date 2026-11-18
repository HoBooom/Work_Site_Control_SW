import { describe, expect, it } from 'vitest';
import { sampleJoints } from './joints';

const s = (at: number, j1: number, extra: Record<string, number> = {}) => ({
  at,
  ts: at,
  joints: { joint_1: j1, ...extra },
});

describe('sampleJoints', () => {
  const samples = [s(0, 0), s(100, 10), s(200, 30)];

  it('샘플 사이를 선형 보간한다', () => {
    expect(sampleJoints(samples, 50)?.joint_1).toBeCloseTo(5);
    expect(sampleJoints(samples, 150)?.joint_1).toBeCloseTo(20);
    expect(sampleJoints(samples, 100)?.joint_1).toBeCloseTo(10);
  });

  it('범위 밖이면 가장 가까운 샘플을 쓴다', () => {
    expect(sampleJoints(samples, -10)?.joint_1).toBe(0);
    expect(sampleJoints(samples, 999)?.joint_1).toBe(30);
  });

  it('비어 있으면 null', () => {
    expect(sampleJoints([], 0)).toBeNull();
  });

  it('한쪽에만 있는 관절은 그 값을 쓴다', () => {
    const r = sampleJoints([s(0, 0, { joint_2: 5 }), s(100, 10, { joint_3: 7 })], 50);
    expect(r).toEqual({ joint_1: 5, joint_2: 5, joint_3: 7 });
  });

  it('같은 수신 시각이면 나중 샘플을 쓴다', () => {
    expect(sampleJoints([s(0, 0), s(100, 1), s(100, 2), s(200, 3)], 100)?.joint_1).toBe(2);
  });
});
