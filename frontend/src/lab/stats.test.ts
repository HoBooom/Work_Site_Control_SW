import { describe, expect, it } from 'vitest';
import { StatsCollector } from './stats';

const info = { calls: 1, triangles: 2, geometries: 3, textures: 4 };

describe('StatsCollector', () => {
  it('평균 fps와 p95 프레임 시간을 계산한다', () => {
    const s = new StatsCollector();
    for (let i = 1; i <= 100; i++) s.push(i <= 95 ? 10 : 50, info);
    const snap = s.snapshot();
    expect(snap.frames).toBe(100);
    expect(snap.frame_ms_p95).toBe(10);
    expect(snap.fps_avg).toBeCloseTo(100_000 / (95 * 10 + 5 * 50));
    expect(snap.calls).toBe(1);
  });

  it('용량을 넘으면 오래된 프레임을 버린다', () => {
    const s = new StatsCollector(3);
    [100, 10, 10, 10].forEach((ms) => s.push(ms, info));
    expect(s.snapshot().fps_avg).toBeCloseTo(100);
  });

  it('reset 뒤에는 비어 있다', () => {
    const s = new StatsCollector();
    s.push(16, info);
    s.reset();
    expect(s.snapshot()).toMatchObject({ frames: 0, fps_avg: 0, frame_ms_p95: 0 });
  });
});
