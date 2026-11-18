import type { FootContacts, RobotBase } from '../contracts/messages.gen';
import type { JointSample } from '../store/twin-store';

type Quat = [number, number, number, number];

/** renderAt 시각의 발 접촉(보간하지 않고 그 시각까지 받은 마지막 값). 없으면 null(고정 로봇) */
export function sampleContacts(samples: readonly JointSample[], renderAt: number): FootContacts | null {
  let out: FootContacts | null = null;
  for (const s of samples) {
    if (!s.contacts) continue;
    if (s.at <= renderAt || !out) out = s.contacts;
    if (s.at > renderAt) break;
  }
  return out;
}

/** 단위 쿼터니언 구면 보간(짧은 쪽으로) */
export function slerp(a: readonly number[], b: readonly number[], k: number): Quat {
  let [bx, by, bz, bw] = b;
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    [bx, by, bz, bw] = [-bx, -by, -bz, -bw];
    dot = -dot;
  }
  let wa: number;
  let wb: number;
  if (dot > 0.9995) {
    wa = 1 - k;
    wb = k;
  } else {
    const th = Math.acos(dot);
    const s = Math.sin(th);
    wa = Math.sin((1 - k) * th) / s;
    wb = Math.sin(k * th) / s;
  }
  const q: Quat = [wa * a[0] + wb * bx, wa * a[1] + wb * by, wa * a[2] + wb * bz, wa * a[3] + wb * bw];
  const n = Math.hypot(...q);
  return q.map((v) => v / n) as Quat;
}

/**
 * renderAt 시각의 몸통 자세(ADR 0003). 위치는 선형, 자세는 구면 보간. 붙은 면(surface)은 가까운 샘플을 따른다.
 * base가 있는 샘플만 본다. 하나도 없으면 null(고정 로봇).
 */
export function sampleBase(samples: readonly JointSample[], renderAt: number): RobotBase | null {
  const s = samples.filter((x): x is JointSample & { base: RobotBase } => !!x.base);
  if (!s.length) return null;
  if (renderAt <= s[0].at) return s[0].base;
  const last = s[s.length - 1];
  if (renderAt >= last.at) return last.base;
  let i = s.length - 2;
  while (i > 0 && s[i].at > renderAt) i--;
  const a = s[i];
  const b = s[i + 1];
  const span = b.at - a.at;
  if (span <= 0) return b.base;
  const k = (renderAt - a.at) / span;
  const pa = a.base.position_m;
  const pb = b.base.position_m;
  return {
    position_m: [pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k, pa[2] + (pb[2] - pa[2]) * k],
    orientation_xyzw: slerp(a.base.orientation_xyzw, b.base.orientation_xyzw, k),
    surface: k < 0.5 ? a.base.surface : b.base.surface,
  };
}
