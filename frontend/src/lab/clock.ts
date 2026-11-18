/** 랩의 시계. 픽스처 재생은 가상 시계, 실시간(MQTT)은 실제 경과 시간 */
export interface LabClock {
  readonly t: number;
  readonly frozen: boolean;
  advance(dtMs: number): void;
  set(t: number): void;
}

/** M5 실시간 모드: 랩을 연 뒤의 실제 경과 시간(ms). bus가 store에 넣는 수신 시각과 같은 시계다. 옮길 수 없다 */
export class LiveClock implements LabClock {
  private readonly start = performance.now();
  readonly frozen = false;
  get t(): number {
    return performance.now() - this.start;
  }
  advance(): void {}
  set(): void {
    throw new Error('실시간(MQTT) 모드에서는 시계를 옮길 수 없다. 픽스처 모드(source=fixture)에서 쓴다.');
  }
}

/** 트윈 랩의 가상 시계. 씬의 모든 시간 계산은 벽시계가 아니라 이 값을 쓴다(harness.md 결정성 규칙). */
export class VirtualClock implements LabClock {
  constructor(
    public t: number,
    public frozen: boolean,
  ) {}

  /** 실제 경과 시간만큼 진행. 멈춰 있으면 그대로. */
  advance(dtMs: number): void {
    if (!this.frozen) this.t += dtMs;
  }

  set(t: number): void {
    this.t = t;
  }
}
