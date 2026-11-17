export interface RenderInfo {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

export interface StatsSnapshot extends RenderInfo {
  frames: number;
  fps_avg: number;
  frame_ms_p95: number;
}

/** 최근 프레임의 시간과 렌더 통계를 모은다. */
export class StatsCollector {
  private times: number[] = [];
  private info: RenderInfo = { calls: 0, triangles: 0, geometries: 0, textures: 0 };
  private frames = 0;

  constructor(private readonly capacity = 1200) {}

  push(frameMs: number, info: RenderInfo): void {
    this.frames++;
    this.info = info;
    this.times.push(frameMs);
    if (this.times.length > this.capacity) this.times.shift();
  }

  reset(): void {
    this.times = [];
    this.frames = 0;
  }

  snapshot(): StatsSnapshot {
    const n = this.times.length;
    const sum = this.times.reduce((a, b) => a + b, 0);
    const sorted = [...this.times].sort((a, b) => a - b);
    const p95 = n ? sorted[Math.min(n - 1, Math.ceil(n * 0.95) - 1)] : 0;
    return {
      ...this.info,
      frames: this.frames,
      fps_avg: sum > 0 ? (n * 1000) / sum : 0,
      frame_ms_p95: p95,
    };
  }
}
