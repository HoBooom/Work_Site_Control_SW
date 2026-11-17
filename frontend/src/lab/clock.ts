/** 트윈 랩의 가상 시계. 씬의 모든 시간 계산은 벽시계가 아니라 이 값을 쓴다(harness.md 결정성 규칙). */
export class VirtualClock {
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
