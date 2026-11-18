/** 픽스처(JSONL) 읽기와 재생. 형식은 digital-twin/docs/harness.md "픽스처". */

export interface FixtureLine {
  /** 시나리오 시작부터의 ms */
  t: number;
  topic: string;
  payload: unknown;
}

export function parseFixture(text: string, name = 'fixture'): FixtureLine[] {
  const out: FixtureLine[] = [];
  let lastT = 0;
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      throw new Error(`${name}:${i + 1} JSON이 아니다`);
    }
    const o = obj as Partial<FixtureLine>;
    if (typeof o.t !== 'number' || typeof o.topic !== 'string' || !('payload' in (o as object))) {
      throw new Error(`${name}:${i + 1} t, topic, payload가 필요하다`);
    }
    if (o.t < lastT) throw new Error(`${name}:${i + 1} t가 줄어든다(${lastT} → ${o.t})`);
    lastT = o.t;
    out.push({ t: o.t, topic: o.topic, payload: o.payload });
  });
  return out;
}

export interface FixtureSink {
  /** at = 줄의 t(시나리오 ms). 랩의 가상 시계와 같은 기준이다 */
  apply: (topic: string, payload: unknown, at: number) => unknown;
  reset: () => void;
}

/**
 * 시나리오 시각을 옮기면 그 시각까지의 메시지를 sink에 반영한다.
 * 뒤로 가면 sink를 비우고 처음부터 다시 반영한다. 같은 시각이면 항상 같은 상태가 된다.
 */
export class FixturePlayer {
  private cursor = 0;
  private time = -1;

  constructor(
    private readonly lines: FixtureLine[],
    private readonly sink: FixtureSink,
  ) {}

  get duration(): number {
    return this.lines.length ? this.lines[this.lines.length - 1].t : 0;
  }

  get now(): number {
    return this.time;
  }

  seek(t: number): void {
    if (t === this.time) return;
    if (t < this.time) {
      this.sink.reset();
      this.cursor = 0;
    }
    while (this.cursor < this.lines.length && this.lines[this.cursor].t <= t) {
      const l = this.lines[this.cursor++];
      this.sink.apply(l.topic, l.payload, l.t);
    }
    this.time = t;
  }
}
