import { describe, expect, it } from 'vitest';
import type { JointSample } from '../store/twin-store';
import { sampleBase, sampleContacts } from './pose';

const H = Math.SQRT1_2;
const s = (at: number, x: number, q: [number, number, number, number], surface: string | null = null): JointSample => ({
  at,
  ts: at,
  joints: {},
  base: { position_m: [x, 0, 0], orientation_xyzw: q, surface },
});

describe('sampleBase', () => {
  const samples = [s(0, 0, [0, 0, 0, 1]), s(100, 1, [0, 0, H, H], 'wall')];

  it('위치는 선형, 자세는 구면 보간한다', () => {
    const b = sampleBase(samples, 50)!;
    expect(b.position_m[0]).toBeCloseTo(0.5);
    // Z축 0° → 90°의 가운데 = 45°
    expect(b.orientation_xyzw[2]).toBeCloseTo(Math.sin(Math.PI / 8));
    expect(b.orientation_xyzw[3]).toBeCloseTo(Math.cos(Math.PI / 8));
  });

  it('붙은 면은 보간하지 않고 가까운 쪽 샘플을 따른다', () => {
    expect(sampleBase(samples, 40)!.surface).toBeNull();
    expect(sampleBase(samples, 60)!.surface).toBe('wall');
  });

  it('범위 밖이면 끝 샘플, base가 없으면 null', () => {
    expect(sampleBase(samples, -5)!.position_m[0]).toBe(0);
    expect(sampleBase(samples, 500)!.position_m[0]).toBe(1);
    expect(sampleBase([{ at: 0, ts: 0, joints: {} }], 0)).toBeNull();
  });
});

describe('sampleContacts', () => {
  const c = (at: number, on: boolean): JointSample => ({ at, ts: at, joints: {}, contacts: { fl_foot: on } });
  const samples = [c(0, true), c(100, false), c(200, true)];

  it('그 시각까지 받은 마지막 값(보간 없음)', () => {
    expect(sampleContacts(samples, 50)).toEqual({ fl_foot: true });
    expect(sampleContacts(samples, 150)).toEqual({ fl_foot: false });
    expect(sampleContacts(samples, 999)).toEqual({ fl_foot: true });
  });

  it('첫 샘플 전이면 첫 값, 접촉이 없으면 null', () => {
    expect(sampleContacts(samples, -5)).toEqual({ fl_foot: true });
    expect(sampleContacts([{ at: 0, ts: 0, joints: {} }], 0)).toBeNull();
  });
});
